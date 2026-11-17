import { all, get, logActivity, now, round2, run, today, uuid } from '../db'
import { hasPermission, requireUser } from './auth'

export interface Table {
  title: string
  columns: { key: string; label: string; money?: boolean }[]
  rows: Record<string, any>[]
  totals?: Record<string, any>
}

const DONE = `s.status = 'completed'`
const ON_DAY = `substr(s.completed_at, 1, 10)`

export function daily(day: string) {
  const showProfit = hasPermission('report.profit')
  const summary = get(
    `SELECT COUNT(*) AS sales, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount_total),0) AS discount,
            COALESCE(SUM(grand_total),0) AS total, COALESCE(SUM(cost_total),0) AS cost
     FROM sales s WHERE ${DONE} AND ${ON_DAY} = ?`,
    day
  )!
  const byMethod = all(
    `SELECT sp.method, COUNT(DISTINCT s.id) AS sales, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE ${DONE} AND ${ON_DAY} = ? GROUP BY sp.method ORDER BY amount DESC`,
    day
  )
  const voids = get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(grand_total),0) AS amount FROM sales s WHERE s.status = 'voided' AND substr(s.voided_at,1,10) = ?`,
    day
  )!
  const items = get(
    `SELECT COALESCE(SUM(si.qty),0) AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${DONE} AND ${ON_DAY} = ?`,
    day
  )!
  const cashCount = get('SELECT * FROM cash_counts WHERE day = ? ORDER BY created_at DESC LIMIT 1', day)
  const cash = byMethod.find((m) => m.method === 'cash')?.amount ?? 0
  const table: Table = {
    title: `Sales on ${day}`,
    columns: [
      { key: 'invoice_no', label: 'Invoice' },
      { key: 'time', label: 'Time' },
      { key: 'cashier', label: 'Cashier' },
      { key: 'items', label: 'Items' },
      { key: 'discount', label: 'Discount', money: true },
      { key: 'total', label: 'Total', money: true },
      { key: 'methods', label: 'Paid by' }
    ],
    rows: all(
      `SELECT s.invoice_no, substr(s.completed_at, 12, 5) AS time, u.name AS cashier,
              (SELECT SUM(qty) FROM sale_items WHERE sale_id = s.id) AS items, s.discount_total AS discount, s.grand_total AS total,
              (SELECT GROUP_CONCAT(DISTINCT method) FROM sale_payments WHERE sale_id = s.id) AS methods
       FROM sales s JOIN users u ON u.id = s.cashier_id WHERE ${DONE} AND ${ON_DAY} = ? ORDER BY s.completed_at`,
      day
    )
  }
  return {
    day,
    sales: summary.sales,
    subtotal: summary.subtotal,
    discount: summary.discount,
    total: summary.total,
    profit: showProfit ? round2(summary.total - summary.cost) : null,
    itemsSold: items.qty,
    byMethod,
    voids,
    expectedCash: round2(cash),
    cashCount: cashCount ?? null,
    table
  }
}

export function monthly(month: string) {
  const showProfit = hasPermission('report.profit')
  const rows = all(
    `SELECT ${ON_DAY} AS day, COUNT(*) AS sales, SUM(discount_total) AS discount, SUM(grand_total) AS total, SUM(cost_total) AS cost
     FROM sales s WHERE ${DONE} AND substr(s.completed_at, 1, 7) = ? GROUP BY day ORDER BY day`,
    month
  )
  const columns: Table['columns'] = [
    { key: 'day', label: 'Date' },
    { key: 'sales', label: 'Sales' },
    { key: 'discount', label: 'Discount', money: true },
    { key: 'total', label: 'Total', money: true }
  ]
  if (showProfit) columns.push({ key: 'profit', label: 'Profit', money: true })
  const out = rows.map((r) => ({ day: r.day, sales: r.sales, discount: round2(r.discount), total: round2(r.total), ...(showProfit ? { profit: round2(r.total - r.cost) } : {}) }))
  const totals: Record<string, any> = {
    day: 'Total',
    sales: out.reduce((s, r) => s + r.sales, 0),
    discount: round2(out.reduce((s, r) => s + r.discount, 0)),
    total: round2(out.reduce((s, r) => s + r.total, 0))
  }
  if (showProfit) totals.profit = round2(out.reduce((s, r: any) => s + r.profit, 0))
  return { title: `Monthly sales ${month}`, columns, rows: out, totals } as Table
}

export function profit(from: string, to: string) {
  const rows = all(
    `SELECT ${ON_DAY} AS day, COUNT(*) AS sales, SUM(subtotal) AS gross, SUM(discount_total) AS discount,
            SUM(grand_total) AS revenue, SUM(cost_total) AS cost
     FROM sales s WHERE ${DONE} AND ${ON_DAY} BETWEEN ? AND ? GROUP BY day ORDER BY day`,
    from,
    to
  ).map((r) => ({
    day: r.day,
    sales: r.sales,
    gross: round2(r.gross),
    discount: round2(r.discount),
    revenue: round2(r.revenue),
    cost: round2(r.cost),
    profit: round2(r.revenue - r.cost),
    margin: r.revenue > 0 ? `${round2(((r.revenue - r.cost) / r.revenue) * 100)}%` : '–'
  }))
  const sum = (k: string) => round2(rows.reduce((s, r: any) => s + r[k], 0))
  const revenue = sum('revenue')
  const cost = sum('cost')
  return {
    title: `Profit ${from} to ${to}`,
    columns: [
      { key: 'day', label: 'Date' },
      { key: 'sales', label: 'Sales' },
      { key: 'gross', label: 'Gross sales', money: true },
      { key: 'discount', label: 'Discounts', money: true },
      { key: 'revenue', label: 'Net sales', money: true },
      { key: 'cost', label: 'Cost of goods', money: true },
      { key: 'profit', label: 'Profit', money: true },
      { key: 'margin', label: 'Margin' }
    ],
    rows,
    totals: {
      day: 'Total',
      sales: rows.reduce((s, r) => s + r.sales, 0),
      gross: sum('gross'),
      discount: sum('discount'),
      revenue,
      cost,
      profit: round2(revenue - cost),
      margin: revenue > 0 ? `${round2(((revenue - cost) / revenue) * 100)}%` : '–'
    }
  } as Table
}

export function bestSellers(from: string, to: string, by: 'qty' | 'revenue') {
  const rows = all(
    `SELECT p.name AS product, cat.name AS category, SUM(si.qty) AS qty, SUM(si.line_total) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
     LEFT JOIN categories cat ON cat.id = p.category_id
     WHERE ${DONE} AND ${ON_DAY} BETWEEN ? AND ?
     GROUP BY p.id ORDER BY ${by === 'qty' ? 'qty' : 'revenue'} DESC LIMIT 50`,
    from,
    to
  ).map((r, i) => ({ rank: i + 1, ...r, revenue: round2(r.revenue) }))
  const variants = all(
    `SELECT p.name || ' – ' || COALESCE(sz.name,'') || ' ' || COALESCE(c.name,'') AS item, v.sku, SUM(si.qty) AS qty, SUM(si.line_total) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
     LEFT JOIN sizes sz ON sz.id = v.size_id LEFT JOIN colors c ON c.id = v.color_id
     WHERE ${DONE} AND ${ON_DAY} BETWEEN ? AND ? GROUP BY v.id ORDER BY qty DESC LIMIT 20`,
    from,
    to
  )
  return {
    table: {
      title: `Best-selling products ${from} to ${to}`,
      columns: [
        { key: 'rank', label: '#' },
        { key: 'product', label: 'Product' },
        { key: 'category', label: 'Category' },
        { key: 'qty', label: 'Qty sold' },
        { key: 'revenue', label: 'Revenue', money: true }
      ],
      rows
    } as Table,
    topVariants: variants
  }
}

export function stock() {
  const showCost = hasPermission('report.profit')
  const rows = all(
    `SELECT p.name AS product, COALESCE(sz.name,'') AS size, COALESCE(c.name,'') AS color, v.sku, v.stock_qty AS qty,
            v.reorder_level, v.cost_price, v.sell_price, v.stock_qty * v.cost_price AS cost_value, v.stock_qty * v.sell_price AS retail_value,
            cat.name AS category
     FROM product_variants v JOIN products p ON p.id = v.product_id
     LEFT JOIN sizes sz ON sz.id = v.size_id LEFT JOIN colors c ON c.id = v.color_id LEFT JOIN categories cat ON cat.id = p.category_id
     WHERE v.active = 1 AND p.active = 1 ORDER BY p.name, c.name, sz.sort_order`
  ).map((r) => ({ ...r, status: r.qty <= 0 ? 'Out' : r.qty <= r.reorder_level ? 'Low' : 'OK', cost_value: round2(r.cost_value), retail_value: round2(r.retail_value) }) as Record<string, any>)
  const columns: Table['columns'] = [
    { key: 'product', label: 'Product' },
    { key: 'size', label: 'Size' },
    { key: 'color', label: 'Colour' },
    { key: 'sku', label: 'SKU' },
    { key: 'qty', label: 'Stock' },
    { key: 'status', label: 'Status' },
    { key: 'sell_price', label: 'Price', money: true },
    { key: 'retail_value', label: 'Value at price', money: true }
  ]
  if (showCost) columns.push({ key: 'cost_value', label: 'Value at cost', money: true })
  if (!showCost) for (const r of rows) delete (r as any).cost_price, delete (r as any).cost_value
  const totals: Record<string, any> = {
    product: 'Total',
    qty: rows.reduce((s, r) => s + r.qty, 0),
    retail_value: round2(rows.reduce((s, r) => s + r.retail_value, 0))
  }
  if (showCost) totals.cost_value = round2(rows.reduce((s, r: any) => s + r.cost_value, 0))
  return { title: `Stock report ${today()}`, columns, rows, totals } as Table
}

export function cashiers(from: string, to: string) {
  const rows = all(
    `SELECT u.name AS cashier,
            SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS sales,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.grand_total END), 0) AS total,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.discount_total END), 0) AS discount,
            SUM(CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END) AS voids
     FROM sales s JOIN users u ON u.id = s.cashier_id
     WHERE s.status IN ('completed','voided') AND ${ON_DAY} BETWEEN ? AND ?
     GROUP BY u.id ORDER BY total DESC`,
    from,
    to
  ).map((r) => ({ ...r, total: round2(r.total), discount: round2(r.discount), average: r.sales ? round2(r.total / r.sales) : 0 }))
  return {
    title: `Cashier-wise sales ${from} to ${to}`,
    columns: [
      { key: 'cashier', label: 'Cashier' },
      { key: 'sales', label: 'Sales' },
      { key: 'total', label: 'Total', money: true },
      { key: 'average', label: 'Average bill', money: true },
      { key: 'discount', label: 'Discounts given', money: true },
      { key: 'voids', label: 'Voided' }
    ],
    rows
  } as Table
}

export function recordCashCount(input: { counted: number; note?: string | null }) {
  const me = requireUser()
  const day = today()
  const expected = get(
    `SELECT COALESCE(SUM(sp.amount),0) AS cash FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE ${DONE} AND ${ON_DAY} = ? AND sp.method = 'cash'`,
    day
  )!.cash
  const id = uuid()
  run(
    'INSERT INTO cash_counts (id, day, user_id, expected, counted, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    day,
    me.id,
    round2(expected),
    round2(input.counted),
    input.note ?? null,
    now()
  )
  const difference = round2(input.counted - expected)
  logActivity(me.id, 'cash.count', 'cash_count', id, { expected: round2(expected), counted: input.counted, difference })
  return { expected: round2(expected), counted: round2(input.counted), difference }
}

export function toCsv(t: Table): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [t.columns.map((c) => esc(c.label)).join(',')]
  for (const r of t.rows) lines.push(t.columns.map((c) => esc(r[c.key])).join(','))
  if (t.totals) lines.push(t.columns.map((c) => esc(t.totals![c.key] ?? '')).join(','))
  return '﻿' + lines.join('\r\n')
}
