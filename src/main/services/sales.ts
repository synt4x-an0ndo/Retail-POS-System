import { AppError, all, get, getDeviceId, logActivity, now, round2, run, today, tx } from '../db'
import { authorise, hasPermission, requireUser } from './auth'
import { addMovement } from './inventory'
import { setting } from './settings'

export type PaymentMethod = 'cash' | 'card' | 'bkash' | 'nagad'

export interface CartLine {
  variantId: string
  qty: number
  lineDiscount: number
}

export interface DraftInput {
  saleId: string
  status: 'draft' | 'held'
  items: CartLine[]
  billDiscount: number
  note?: string | null
}

export interface CompleteInput {
  saleId: string
  items: CartLine[]
  billDiscount: number
  payments: { method: PaymentMethod; amount: number; reference?: string | null }[]
  cashTendered?: number | null
  overridePin?: string | null
}

// ---------- Drafts and held carts (crash recovery) ----------

export function saveDraft(input: DraftInput) {
  const me = requireUser()
  const existing = get('SELECT status, cashier_id FROM sales WHERE id = ?', input.saleId)
  if (existing && !['draft', 'held'].includes(existing.status)) return { saved: false, status: existing.status }
  const t = now()
  const json = JSON.stringify({ items: input.items, billDiscount: input.billDiscount, note: input.note ?? null })
  if (existing) {
    run('UPDATE sales SET status = ?, draft_json = ?, updated_at = ? WHERE id = ?', input.status, json, t, input.saleId)
  } else {
    run(
      `INSERT INTO sales (id, status, cashier_id, draft_json, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.saleId,
      input.status,
      me.id,
      json,
      getDeviceId(),
      t,
      t
    )
  }
  return { saved: true, status: input.status }
}

export function openCarts() {
  const me = requireUser()
  const rows = all(
    `SELECT s.id, s.status, s.draft_json, s.updated_at, s.cashier_id, u.name AS cashier_name
     FROM sales s JOIN users u ON u.id = s.cashier_id
     WHERE s.status IN ('draft','held') AND (s.cashier_id = ? OR s.status = 'held')
     ORDER BY s.updated_at DESC`,
    me.id
  )
  return rows.map((r) => {
    const draft = r.draft_json ? JSON.parse(r.draft_json) : { items: [], billDiscount: 0 }
    const lines = (draft.items as CartLine[])
      .map((l) => {
        const v = get(
          `SELECT v.id, v.sku, v.barcode, v.sell_price, v.stock_qty, p.name AS product_name, s.name AS size_name, c.name AS color_name
           FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN sizes s ON s.id = v.size_id LEFT JOIN colors c ON c.id = v.color_id
           WHERE v.id = ?`,
          l.variantId
        )
        return v ? { ...l, variant: v } : null
      })
      .filter(Boolean)
    return { id: r.id, status: r.status, updatedAt: r.updated_at, cashierName: r.cashier_name, billDiscount: draft.billDiscount ?? 0, note: draft.note ?? null, lines }
  })
}

export function discardDraft(saleId: string) {
  const me = requireUser()
  const s = get('SELECT status, draft_json FROM sales WHERE id = ?', saleId)
  if (!s || !['draft', 'held'].includes(s.status)) return { discarded: false }
  run(`UPDATE sales SET status = 'discarded', updated_at = ? WHERE id = ?`, now(), saleId)
  const items = s.draft_json ? (JSON.parse(s.draft_json).items as CartLine[]) : []
  if (items.length) logActivity(me.id, 'cart.discard', 'sale', saleId, { items: items.length })
  return { discarded: true }
}

/** Remove abandoned drafts older than 24 hours (held carts are kept). */
export function cleanupDrafts() {
  const cutoff = now(new Date(Date.now() - 24 * 3600 * 1000))
  const r = run(`UPDATE sales SET status = 'discarded', updated_at = ? WHERE status = 'draft' AND updated_at < ?`, now(), cutoff)
  if (Number(r.changes) > 0) logActivity(null, 'cart.cleanup', 'sale', undefined, { count: Number(r.changes) })
}

// ---------- Completing a sale ----------

function nextInvoiceNo(): string {
  const day = today()
  const row = get('SELECT last_no FROM invoice_counters WHERE day = ?', day)
  const n = (row ? Number(row.last_no) : 0) + 1
  run('INSERT INTO invoice_counters (day, last_no) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET last_no = excluded.last_no', day, n)
  const prefix = setting('invoice_prefix') || 'INV'
  return `${prefix}-${day.replace(/-/g, '')}-${String(n).padStart(4, '0')}`
}

export function complete(input: CompleteInput) {
  const me = requireUser()
  return tx(() => {
    // Duplicate protection: the sale id is created when the cart opens. A repeat request returns the same invoice.
    const existing = get('SELECT status, invoice_no, cashier_id FROM sales WHERE id = ?', input.saleId)
    if (existing?.status === 'completed') {
      return { saleId: input.saleId, invoiceNo: existing.invoice_no as string, change: 0, alreadyCompleted: true }
    }
    if (existing && !['draft', 'held'].includes(existing.status)) {
      throw new AppError('SALE_CLOSED', 'This cart was already closed. Start a new sale.')
    }
    if (!input.items.length) throw new AppError('EMPTY_CART', 'The cart is empty.')

    // Merge repeated lines and load prices from the database (never trust prices from the screen).
    const merged = new Map<string, CartLine>()
    for (const l of input.items) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError('BAD_QTY', 'Quantities must be whole numbers above zero.')
      const m = merged.get(l.variantId)
      if (m) {
        m.qty += l.qty
        m.lineDiscount += l.lineDiscount
      } else merged.set(l.variantId, { ...l })
    }

    let subtotal = 0
    let itemDiscounts = 0
    let costTotal = 0
    let needsStockOverride = false
    const lines: { v: Record<string, any>; qty: number; disc: number; gross: number; total: number; desc: string }[] = []
    for (const l of merged.values()) {
      const v = get(
        `SELECT v.*, p.name AS product_name, s.name AS size_name, c.name AS color_name, p.active AS product_active
         FROM product_variants v JOIN products p ON p.id = v.product_id
         LEFT JOIN sizes s ON s.id = v.size_id LEFT JOIN colors c ON c.id = v.color_id WHERE v.id = ?`,
        l.variantId
      )
      if (!v || !v.active || !v.product_active) throw new AppError('ITEM_UNAVAILABLE', 'An item in the cart is no longer for sale.')
      const gross = round2(v.sell_price * l.qty)
      const disc = round2(Math.max(0, l.lineDiscount))
      if (disc > gross) throw new AppError('BAD_DISCOUNT', `Discount on ${v.product_name} is more than its price.`)
      if (v.stock_qty < l.qty) needsStockOverride = true
      subtotal += gross
      itemDiscounts += disc
      costTotal += v.cost_price * l.qty
      const desc = [v.product_name, [v.size_name, v.color_name].filter(Boolean).join(' / ')].filter(Boolean).join(' – ')
      lines.push({ v, qty: l.qty, disc, gross, total: round2(gross - disc), desc })
    }
    subtotal = round2(subtotal)
    const billDiscount = round2(Math.max(0, input.billDiscount))
    const discountTotal = round2(itemDiscounts + billDiscount)
    if (discountTotal > subtotal) throw new AppError('BAD_DISCOUNT', 'Discount is more than the bill.')
    const grandTotal = round2(subtotal - discountTotal)

    // Permission checks, with owner PIN override.
    let approvedBy: string | null = null
    const discountPct = subtotal > 0 ? (discountTotal / subtotal) * 100 : 0
    if (discountPct > me.discountLimitPct + 1e-9) approvedBy = authorise('discount.unlimited', input.overridePin)
    if (needsStockOverride) approvedBy = authorise('stock.override', input.overridePin)

    // Payments.
    const nonCash = input.payments.filter((p) => p.method !== 'cash' && p.amount > 0)
    const nonCashTotal = round2(nonCash.reduce((s, p) => s + p.amount, 0))
    for (const p of nonCash) {
      if ((p.method === 'bkash' || p.method === 'nagad') && !p.reference?.trim()) {
        throw new AppError('REFERENCE_REQUIRED', `Enter the ${p.method === 'bkash' ? 'bKash' : 'Nagad'} transaction ID.`)
      }
    }
    if (nonCashTotal > grandTotal + 0.001) throw new AppError('OVERPAID', 'Card/mobile payments are more than the bill.')
    const cashDue = round2(grandTotal - nonCashTotal)
    const tendered = round2(input.cashTendered ?? input.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0))
    if (cashDue > 0 && tendered + 0.001 < cashDue) throw new AppError('UNDERPAID', `Cash received is less than ৳${cashDue.toFixed(2)} due.`)
    const change = cashDue > 0 ? round2(tendered - cashDue) : 0

    // Write everything in this one transaction.
    const t = now()
    const invoiceNo = nextInvoiceNo()
    if (existing) {
      run(
        `UPDATE sales SET invoice_no = ?, status = 'completed', cashier_id = ?, draft_json = NULL, subtotal = ?, discount_total = ?,
         grand_total = ?, cost_total = ?, approved_by = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
        invoiceNo,
        me.id,
        subtotal,
        discountTotal,
        grandTotal,
        round2(costTotal),
        approvedBy,
        t,
        t,
        input.saleId
      )
    } else {
      run(
        `INSERT INTO sales (id, invoice_no, status, cashier_id, subtotal, discount_total, grand_total, cost_total, approved_by, device_id, created_at, updated_at, completed_at)
         VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.saleId,
        invoiceNo,
        me.id,
        subtotal,
        discountTotal,
        grandTotal,
        round2(costTotal),
        approvedBy,
        getDeviceId(),
        t,
        t,
        t
      )
    }
    let i = 0
    for (const l of lines) {
      run(
        `INSERT INTO sale_items (id, sale_id, variant_id, description, qty, unit_price, unit_cost, line_discount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `${input.saleId}-${++i}`,
        input.saleId,
        l.v.id,
        l.desc,
        l.qty,
        l.v.sell_price,
        l.v.cost_price,
        l.disc,
        l.total
      )
      addMovement(l.v.id, 'sale', -l.qty, 'sale', input.saleId, me.id, null)
    }
    let pi = 0
    for (const p of nonCash) {
      run(
        `INSERT INTO sale_payments (id, sale_id, method, amount, reference) VALUES (?, ?, ?, ?, ?)`,
        `${input.saleId}-p${++pi}`,
        input.saleId,
        p.method,
        round2(p.amount),
        p.reference?.trim() || null
      )
    }
    if (cashDue > 0) {
      run(
        `INSERT INTO sale_payments (id, sale_id, method, amount, reference, tendered, change_given) VALUES (?, ?, 'cash', ?, NULL, ?, ?)`,
        `${input.saleId}-p${++pi}`,
        input.saleId,
        cashDue,
        tendered,
        change
      )
    }
    if (approvedBy && approvedBy !== me.id) {
      logActivity(me.id, 'sale.approved', 'sale', input.saleId, { invoiceNo, approvedBy, discountTotal, stockOverride: needsStockOverride })
    }
    if (discountTotal > 0) logActivity(me.id, 'sale.discount', 'sale', input.saleId, { invoiceNo, discountTotal, pct: round2(discountPct) })
    return { saleId: input.saleId, invoiceNo, change, alreadyCompleted: false, hasCash: cashDue > 0 }
  })
}

// ---------- Void ----------

export function voidSale(input: { saleId: string; reason: string; overridePin?: string | null }) {
  const me = requireUser()
  if (!input.reason || input.reason.trim().length < 3) throw new AppError('REASON_REQUIRED', 'Enter a reason for cancelling the sale.')
  return tx(() => {
    const s = get('SELECT * FROM sales WHERE id = ?', input.saleId)
    if (!s) throw new AppError('NOT_FOUND', 'Sale not found.')
    if (s.status !== 'completed') throw new AppError('NOT_VOIDABLE', 'Only completed sales can be cancelled.')
    const by = authorise('sale.void', input.overridePin)
    const items = all('SELECT variant_id, qty FROM sale_items WHERE sale_id = ?', input.saleId)
    for (const it of items) addMovement(it.variant_id, 'void', it.qty, 'sale', input.saleId, by, input.reason.trim())
    const t = now()
    run(`UPDATE sales SET status = 'voided', voided_by = ?, void_reason = ?, voided_at = ?, updated_at = ? WHERE id = ?`, by, input.reason.trim(), t, t, input.saleId)
    logActivity(me.id, 'sale.void', 'sale', input.saleId, { invoiceNo: s.invoice_no, total: s.grand_total, reason: input.reason.trim(), approvedBy: by })
    return { voided: true }
  })
}

// ---------- History ----------

export function listSales(filter: { from: string; to: string; search?: string; status?: string | null }) {
  const me = requireUser()
  const where = [`s.status IN ('completed','voided')`, 'substr(s.completed_at, 1, 10) BETWEEN ? AND ?']
  const params: any[] = [filter.from, filter.to]
  if (filter.status) {
    where.push('s.status = ?')
    params.push(filter.status)
  }
  if (filter.search) {
    where.push('(s.invoice_no LIKE ? OR EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.reference LIKE ?))')
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }
  // Cashiers without report access see only their own sales.
  if (!hasPermission('report.view')) {
    where.push('s.cashier_id = ?')
    params.push(me.id)
  }
  return all(
    `SELECT s.id, s.invoice_no, s.status, s.subtotal, s.discount_total, s.grand_total, s.completed_at, s.void_reason,
            u.name AS cashier_name,
            (SELECT GROUP_CONCAT(DISTINCT method) FROM sale_payments WHERE sale_id = s.id) AS methods,
            (SELECT SUM(qty) FROM sale_items WHERE sale_id = s.id) AS item_count
     FROM sales s JOIN users u ON u.id = s.cashier_id
     WHERE ${where.join(' AND ')} ORDER BY s.completed_at DESC LIMIT 1000`,
    ...params
  )
}

export function getSale(id: string) {
  const s = get(
    `SELECT s.*, u.name AS cashier_name, vb.name AS voided_by_name, ab.name AS approved_by_name
     FROM sales s JOIN users u ON u.id = s.cashier_id
     LEFT JOIN users vb ON vb.id = s.voided_by LEFT JOIN users ab ON ab.id = s.approved_by WHERE s.id = ?`,
    id
  )
  if (!s || !['completed', 'voided'].includes(s.status)) throw new AppError('NOT_FOUND', 'Sale not found.')
  const items = all(
    `SELECT si.*, v.sku, v.barcode FROM sale_items si JOIN product_variants v ON v.id = si.variant_id WHERE si.sale_id = ? ORDER BY si.rowid`,
    id
  )
  const payments = all('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY rowid', id)
  if (!hasPermission('report.profit')) {
    delete s.cost_total
    for (const it of items) delete it.unit_cost
  }
  return { ...s, items, payments }
}

export function dashboard() {
  const day = today()
  const totals = get(
    `SELECT COUNT(*) AS sales, COALESCE(SUM(grand_total), 0) AS total, COALESCE(SUM(discount_total), 0) AS discount
     FROM sales WHERE status = 'completed' AND substr(completed_at, 1, 10) = ?`,
    day
  )!
  const byMethod = all(
    `SELECT sp.method, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE s.status = 'completed' AND substr(s.completed_at, 1, 10) = ? GROUP BY sp.method`,
    day
  )
  const items = get(
    `SELECT COALESCE(SUM(si.qty), 0) AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.status = 'completed' AND substr(s.completed_at, 1, 10) = ?`,
    day
  )!
  const low = get(
    `SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.active = 1 AND p.active = 1 AND v.stock_qty <= v.reorder_level`
  )!
  const lastBackup = get(`SELECT created_at FROM backup_log WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1`)
  const recent = all(
    `SELECT s.id, s.invoice_no, s.grand_total, s.completed_at, u.name AS cashier_name,
            (SELECT SUM(qty) FROM sale_items WHERE sale_id = s.id) AS item_count,
            (SELECT GROUP_CONCAT(DISTINCT method) FROM sale_payments WHERE sale_id = s.id) AS methods
     FROM sales s JOIN users u ON u.id = s.cashier_id
     WHERE s.status = 'completed' ORDER BY s.completed_at DESC LIMIT 8`
  )
  // Last 14 days, including days with no sales.
  const from = now(new Date(Date.now() - 13 * 86400000)).slice(0, 10)
  const byDay = new Map(
    all(
      `SELECT substr(completed_at, 1, 10) AS day, COUNT(*) AS sales, SUM(grand_total) AS total
       FROM sales WHERE status = 'completed' AND substr(completed_at, 1, 10) >= ? GROUP BY day`,
      from
    ).map((r) => [r.day as string, r])
  )
  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = now(new Date(Date.now() - (13 - i) * 86400000)).slice(0, 10)
    const r = byDay.get(d)
    return { day: d, sales: r?.sales ?? 0, total: round2(r?.total ?? 0) }
  })
  const yesterday = trend[12]
  const topToday = all(
    `SELECT p.name AS product, SUM(si.qty) AS qty, SUM(si.line_total) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
     WHERE s.status = 'completed' AND substr(s.completed_at, 1, 10) = ? GROUP BY p.id ORDER BY qty DESC LIMIT 5`,
    day
  )
  const catalogue = get(
    `SELECT (SELECT COUNT(*) FROM products WHERE active = 1) AS products,
            (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.active = 1 AND p.active = 1) AS variants,
            (SELECT COALESCE(SUM(stock_qty), 0) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.active = 1 AND p.active = 1 AND v.stock_qty > 0) AS units,
            (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.active = 1 AND p.active = 1 AND v.stock_qty <= 0) AS out_of_stock`
  )!
  return {
    day,
    sales: totals.sales,
    total: totals.total,
    discount: totals.discount,
    itemsSold: items.qty,
    byMethod,
    lowStockCount: low.n,
    lastBackup: lastBackup?.created_at ?? null,
    lastUsbCopy: setting('last_usb_copy') || null,
    recent,
    trend,
    yesterday: { sales: yesterday.sales, total: yesterday.total },
    topToday,
    catalogue
  }
}
