import { AppError, all, get, getDeviceId, logActivity, now, round2, run, tx, uuid } from '../db'
import { requireUser } from './auth'

const STOCK_SELECT = `
  SELECT v.id, v.sku, v.barcode, v.stock_qty, v.reorder_level, v.cost_price, v.sell_price, v.active,
         p.id AS product_id, p.name AS product_name, p.brand, s.name AS size_name, c.name AS color_name,
         cat.name AS category_name
  FROM product_variants v
  JOIN products p ON p.id = v.product_id
  LEFT JOIN sizes s ON s.id = v.size_id
  LEFT JOIN colors c ON c.id = v.color_id
  LEFT JOIN categories cat ON cat.id = p.category_id`

export function stockList(filter: { search?: string; categoryId?: string | null; lowOnly?: boolean }) {
  const where = ['v.active = 1', 'p.active = 1']
  const params: any[] = []
  if (filter.search) {
    const s = `%${filter.search}%`
    where.push('(p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ? OR p.brand LIKE ?)')
    params.push(s, s, s, s)
  }
  if (filter.categoryId) {
    where.push('(p.category_id = ? OR cat.parent_id = ?)')
    params.push(filter.categoryId, filter.categoryId)
  }
  if (filter.lowOnly) where.push('v.stock_qty <= v.reorder_level')
  return all(`${STOCK_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.name, c.name, s.sort_order LIMIT 2000`, ...params)
}

export function lowStock() {
  return stockList({ lowOnly: true })
}

export function movements(variantId: string) {
  return all(
    `SELECT m.*, u.name AS user_name, s.invoice_no
     FROM stock_movements m
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN sales s ON m.ref_type = 'sale' AND s.id = m.ref_id
     WHERE m.variant_id = ? ORDER BY m.created_at DESC LIMIT 500`,
    variantId
  )
}

function addMovement(variantId: string, type: string, qty: number, refType: string | null, refId: string | null, userId: string, reason: string | null) {
  run('UPDATE product_variants SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?', qty, now(), variantId)
  run(
    `INSERT INTO stock_movements (id, variant_id, type, qty_change, ref_type, ref_id, user_id, reason, device_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uuid(),
    variantId,
    type,
    qty,
    refType,
    refId,
    userId,
    reason,
    getDeviceId(),
    now()
  )
}
export { addMovement }

export function adjust(input: { variantId: string; qtyChange: number; reason: string }) {
  const me = requireUser()
  if (!input.qtyChange) throw new AppError('ZERO_QTY', 'Enter a quantity to add or remove.')
  return tx(() => {
    const v = get('SELECT sku, stock_qty FROM product_variants WHERE id = ?', input.variantId)
    if (!v) throw new AppError('NOT_FOUND', 'Item not found.')
    if (v.stock_qty + input.qtyChange < 0) throw new AppError('NEGATIVE_STOCK', `Only ${v.stock_qty} in stock; cannot remove ${-input.qtyChange}.`)
    addMovement(input.variantId, 'adjustment', input.qtyChange, 'adjustment', null, me.id, input.reason)
    logActivity(me.id, 'stock.adjust', 'variant', input.variantId, { sku: v.sku, qtyChange: input.qtyChange, reason: input.reason })
    return { stock: v.stock_qty + input.qtyChange }
  })
}

export interface ReceiveInput {
  supplierId?: string | null
  supplierInvoiceNo?: string | null
  note?: string | null
  updateCost: boolean
  items: { variantId: string; qty: number; unitCost: number }[]
}

export function receive(input: ReceiveInput) {
  const me = requireUser()
  if (!input.items.length) throw new AppError('NO_ITEMS', 'Add at least one item.')
  return tx(() => {
    const id = uuid()
    const t = now()
    let total = 0
    for (const it of input.items) {
      if (!get('SELECT 1 FROM product_variants WHERE id = ?', it.variantId)) throw new AppError('NOT_FOUND', 'Item not found.')
      total += it.qty * it.unitCost
    }
    run(
      `INSERT INTO purchases (id, supplier_id, supplier_invoice_no, received_at, total_cost, user_id, note, device_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.supplierId ?? null,
      input.supplierInvoiceNo ?? null,
      t,
      round2(total),
      me.id,
      input.note ?? null,
      getDeviceId(),
      t,
      t
    )
    for (const it of input.items) {
      run(
        'INSERT INTO purchase_items (id, purchase_id, variant_id, qty, unit_cost) VALUES (?, ?, ?, ?, ?)',
        uuid(),
        id,
        it.variantId,
        it.qty,
        round2(it.unitCost)
      )
      addMovement(it.variantId, 'purchase', it.qty, 'purchase', id, me.id, input.supplierInvoiceNo ? `Supplier invoice ${input.supplierInvoiceNo}` : null)
      if (input.updateCost && it.unitCost > 0) {
        run('UPDATE product_variants SET cost_price = ? WHERE id = ?', round2(it.unitCost), it.variantId)
      }
    }
    logActivity(me.id, 'stock.receive', 'purchase', id, { items: input.items.length, total: round2(total) })
    return { id }
  })
}

export function purchases() {
  return all(
    `SELECT pu.*, s.name AS supplier_name, u.name AS user_name,
            (SELECT SUM(qty) FROM purchase_items WHERE purchase_id = pu.id) AS total_qty
     FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id LEFT JOIN users u ON u.id = pu.user_id
     ORDER BY pu.received_at DESC LIMIT 300`
  )
}

export function purchase(id: string) {
  const p = get(
    `SELECT pu.*, s.name AS supplier_name, u.name AS user_name FROM purchases pu
     LEFT JOIN suppliers s ON s.id = pu.supplier_id LEFT JOIN users u ON u.id = pu.user_id WHERE pu.id = ?`,
    id
  )
  if (!p) throw new AppError('NOT_FOUND', 'Stock receipt not found.')
  const items = all(
    `SELECT pi.*, v.sku, v.barcode, p.name AS product_name, sz.name AS size_name, c.name AS color_name
     FROM purchase_items pi JOIN product_variants v ON v.id = pi.variant_id JOIN products p ON p.id = v.product_id
     LEFT JOIN sizes sz ON sz.id = v.size_id LEFT JOIN colors c ON c.id = v.color_id WHERE pi.purchase_id = ?`,
    id
  )
  return { ...p, items }
}

export function suppliers() {
  return all('SELECT * FROM suppliers ORDER BY name')
}

export function saveSupplier(input: { id?: string | null; name: string; phone?: string | null; address?: string | null }) {
  const me = requireUser()
  const t = now()
  if (input.id) {
    run('UPDATE suppliers SET name = ?, phone = ?, address = ?, updated_at = ? WHERE id = ?', input.name, input.phone ?? null, input.address ?? null, t, input.id)
    return { id: input.id }
  }
  const id = uuid()
  run(
    'INSERT INTO suppliers (id, name, phone, address, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    input.name,
    input.phone ?? null,
    input.address ?? null,
    getDeviceId(),
    t,
    t
  )
  logActivity(me.id, 'supplier.create', 'supplier', id)
  return { id }
}

/** Nightly consistency check: cached stock must equal the sum of its movements. */
export function verifyLedger(): { mismatches: number } {
  const bad = all(
    `SELECT v.id, v.sku, v.stock_qty, COALESCE(SUM(m.qty_change), 0) AS ledger
     FROM product_variants v LEFT JOIN stock_movements m ON m.variant_id = v.id
     GROUP BY v.id HAVING v.stock_qty != ledger`
  )
  if (bad.length) logActivity(null, 'ledger.mismatch', 'variant', undefined, bad.slice(0, 50))
  return { mismatches: bad.length }
}
