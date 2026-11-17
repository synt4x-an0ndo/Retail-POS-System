import { AppError, all, get, getDeviceId, logActivity, nextCounter, now, round2, run, tx, uuid } from '../db'
import { requireUser } from './auth'
import { setting } from './settings'

// ---------- Lookups: categories, sizes, colours ----------

export function lookups() {
  return {
    categories: all(
      `SELECT c.id, c.name, c.code, c.parent_id, c.active, p.name AS parent_name
       FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
       ORDER BY COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name`
    ),
    sizes: all('SELECT id, name, code, sort_order FROM sizes ORDER BY sort_order, name'),
    colors: all('SELECT id, name, code, sort_order FROM colors ORDER BY sort_order, name')
  }
}

const codeOf = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'X'

export function saveCategory(input: { id?: string | null; name: string; code?: string | null; parentId?: string | null; active: boolean }) {
  const me = requireUser()
  const t = now()
  const code = codeOf(input.code || input.name)
  if (input.parentId && input.parentId === input.id) throw new AppError('BAD_PARENT', 'A category cannot be its own parent.')
  if (input.parentId) {
    const parent = get('SELECT parent_id FROM categories WHERE id = ?', input.parentId)
    if (!parent) throw new AppError('BAD_PARENT', 'Parent category not found.')
    if (parent.parent_id) throw new AppError('BAD_PARENT', 'Only two levels are supported (category › subcategory).')
  }
  if (input.id) {
    run(
      'UPDATE categories SET name = ?, code = ?, parent_id = ?, active = ?, updated_at = ? WHERE id = ?',
      input.name,
      code,
      input.parentId ?? null,
      input.active ? 1 : 0,
      t,
      input.id
    )
    logActivity(me.id, 'category.update', 'category', input.id)
    return { id: input.id }
  }
  const id = uuid()
  run(
    'INSERT INTO categories (id, name, code, parent_id, active, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    input.name,
    code,
    input.parentId ?? null,
    input.active ? 1 : 0,
    getDeviceId(),
    t,
    t
  )
  logActivity(me.id, 'category.create', 'category', id)
  return { id }
}

function saveSimple(table: 'sizes' | 'colors', input: { id?: string | null; name: string; code?: string | null; sortOrder: number }) {
  const me = requireUser()
  const t = now()
  const code = codeOf(input.code || input.name).slice(0, table === 'colors' ? 3 : 4)
  const clash = get(`SELECT id FROM ${table} WHERE name = ? AND id != ?`, input.name.trim(), input.id ?? '')
  if (clash) throw new AppError('DUPLICATE', `"${input.name}" already exists.`)
  if (input.id) {
    run(`UPDATE ${table} SET name = ?, code = ?, sort_order = ?, updated_at = ? WHERE id = ?`, input.name.trim(), code, input.sortOrder, t, input.id)
    logActivity(me.id, `${table}.update`, table, input.id)
    return { id: input.id }
  }
  const id = uuid()
  run(
    `INSERT INTO ${table} (id, name, code, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.name.trim(),
    code,
    input.sortOrder,
    t,
    t
  )
  logActivity(me.id, `${table}.create`, table, id)
  return { id }
}

export const saveSize = (i: Parameters<typeof saveSimple>[1]) => saveSimple('sizes', i)
export const saveColor = (i: Parameters<typeof saveSimple>[1]) => saveSimple('colors', i)

// ---------- Products ----------

const VARIANT_SELECT = `
  SELECT v.id, v.product_id, v.sku, v.barcode, v.cost_price, v.sell_price, v.stock_qty, v.reorder_level, v.active,
         v.size_id, v.color_id, s.name AS size_name, c.name AS color_name,
         p.name AS product_name, p.brand, p.image_path, p.category_id, cat.name AS category_name
  FROM product_variants v
  JOIN products p ON p.id = v.product_id
  LEFT JOIN sizes s ON s.id = v.size_id
  LEFT JOIN colors c ON c.id = v.color_id
  LEFT JOIN categories cat ON cat.id = p.category_id`

export function listProducts(filter: { search?: string; categoryId?: string | null; includeArchived?: boolean }) {
  const where: string[] = []
  const params: any[] = []
  if (!filter.includeArchived) where.push('p.active = 1')
  if (filter.categoryId) {
    where.push('(p.category_id = ? OR cat.parent_id = ?)')
    params.push(filter.categoryId, filter.categoryId)
  }
  if (filter.search) {
    where.push(
      `(p.name LIKE ? OR p.brand LIKE ? OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku LIKE ? OR v.barcode LIKE ?)))`
    )
    const s = `%${filter.search}%`
    params.push(s, s, s, s)
  }
  return all(
    `SELECT p.id, p.product_no, p.name, p.brand, p.image_path, p.active, cat.name AS category_name,
            COUNT(v.id) AS variant_count, COALESCE(SUM(v.stock_qty), 0) AS total_stock,
            MIN(v.sell_price) AS min_price, MAX(v.sell_price) AS max_price,
            SUM(CASE WHEN v.active = 1 AND v.stock_qty <= v.reorder_level THEN 1 ELSE 0 END) AS low_count,
            GROUP_CONCAT(DISTINCT sz.name) AS size_names, GROUP_CONCAT(DISTINCT co.name) AS color_names
     FROM products p
     LEFT JOIN categories cat ON cat.id = p.category_id
     LEFT JOIN product_variants v ON v.product_id = p.id
     LEFT JOIN sizes sz ON sz.id = v.size_id
     LEFT JOIN colors co ON co.id = v.color_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 500`,
    ...params
  )
}

export function getProduct(id: string) {
  const p = get('SELECT * FROM products WHERE id = ?', id)
  if (!p) throw new AppError('NOT_FOUND', 'Product not found.')
  const variants = all(`${VARIANT_SELECT} WHERE v.product_id = ? ORDER BY c.sort_order, c.name, s.sort_order, s.name`, id)
  for (const v of variants) {
    v.extra_barcodes = all('SELECT barcode FROM variant_barcodes WHERE variant_id = ?', v.id).map((r) => r.barcode)
  }
  return { ...p, variants }
}

export interface VariantInput {
  id?: string | null
  sizeId?: string | null
  colorId?: string | null
  costPrice: number
  sellPrice: number
  reorderLevel: number
  openingQty?: number
  extraBarcode?: string | null
  active: boolean
}

export interface ProductInput {
  id?: string | null
  name: string
  brand?: string | null
  description?: string | null
  categoryId?: string | null
  imagePath?: string | null
  active: boolean
  variants: VariantInput[]
}

function newBarcode(): string {
  // '20' + 8-digit running number. Meaningless on purpose: prices and categories can change without relabelling.
  for (;;) {
    const code = '20' + String(nextCounter('barcode_seq')).padStart(8, '0')
    if (!barcodeTaken(code)) return code
  }
}

function barcodeTaken(code: string, exceptVariant?: string): boolean {
  const a = get('SELECT id FROM product_variants WHERE barcode = ? AND id != ?', code, exceptVariant ?? '')
  const b = get('SELECT variant_id FROM variant_barcodes WHERE barcode = ? AND variant_id != ?', code, exceptVariant ?? '')
  return !!(a || b)
}

function makeSku(productNo: number, categoryId: string | null | undefined, sizeId?: string | null, colorId?: string | null): string {
  const cat = categoryId ? get('SELECT code FROM categories WHERE id = ?', categoryId)?.code : null
  const color = colorId ? get('SELECT code FROM colors WHERE id = ?', colorId)?.code : null
  const size = sizeId ? get('SELECT code FROM sizes WHERE id = ?', sizeId)?.code : null
  const base = [cat || 'GEN', String(productNo).padStart(4, '0'), color, size].filter(Boolean).join('-')
  let sku = base
  let n = 2
  while (get('SELECT 1 FROM product_variants WHERE sku = ?', sku)) sku = `${base}-${n++}`
  return sku
}

export function saveProduct(input: ProductInput) {
  const me = requireUser()
  if (!input.variants.length) throw new AppError('NO_VARIANTS', 'Add at least one size/colour variant.')
  const keys = new Set<string>()
  for (const v of input.variants) {
    const k = `${v.sizeId ?? ''}|${v.colorId ?? ''}`
    if (keys.has(k)) throw new AppError('DUPLICATE_VARIANT', 'The same size and colour is listed twice.')
    keys.add(k)
    if (v.extraBarcode && !/^[0-9A-Za-z-]{4,32}$/.test(v.extraBarcode)) {
      throw new AppError('BAD_BARCODE', `Existing barcode "${v.extraBarcode}" is not valid.`)
    }
  }
  const defaultReorder = Number(setting('low_stock_default')) || 2
  return tx(() => {
    const t = now()
    let productId = input.id
    let productNo: number
    if (productId) {
      const existing = get('SELECT product_no FROM products WHERE id = ?', productId)
      if (!existing) throw new AppError('NOT_FOUND', 'Product not found.')
      productNo = existing.product_no
      run(
        `UPDATE products SET name = ?, brand = ?, description = ?, category_id = ?, image_path = ?, active = ?, updated_at = ? WHERE id = ?`,
        input.name,
        input.brand ?? null,
        input.description ?? null,
        input.categoryId ?? null,
        input.imagePath ?? null,
        input.active ? 1 : 0,
        t,
        productId
      )
    } else {
      productId = uuid()
      productNo = nextCounter('product_seq')
      run(
        `INSERT INTO products (id, product_no, name, brand, description, category_id, image_path, active, device_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        productId,
        productNo,
        input.name,
        input.brand ?? null,
        input.description ?? null,
        input.categoryId ?? null,
        input.imagePath ?? null,
        input.active ? 1 : 0,
        getDeviceId(),
        t,
        t
      )
    }

    for (const v of input.variants) {
      const cost = round2(v.costPrice)
      const price = round2(v.sellPrice)
      const reorder = Number.isFinite(v.reorderLevel) ? v.reorderLevel : defaultReorder
      let variantId = v.id
      if (variantId) {
        const old = get('SELECT * FROM product_variants WHERE id = ? AND product_id = ?', variantId, productId)
        if (!old) throw new AppError('NOT_FOUND', 'Variant not found.')
        run(
          `UPDATE product_variants SET cost_price = ?, sell_price = ?, reorder_level = ?, active = ?, updated_at = ? WHERE id = ?`,
          cost,
          price,
          reorder,
          v.active ? 1 : 0,
          t,
          variantId
        )
        if (old.sell_price !== price || old.cost_price !== cost) {
          logActivity(me.id, 'price.change', 'variant', variantId, {
            sku: old.sku,
            sellFrom: old.sell_price,
            sellTo: price,
            costFrom: old.cost_price,
            costTo: cost
          })
        }
      } else {
        variantId = uuid()
        const sku = makeSku(productNo, input.categoryId, v.sizeId, v.colorId)
        run(
          `INSERT INTO product_variants (id, product_id, size_id, color_id, sku, barcode, cost_price, sell_price, stock_qty, reorder_level, active, device_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          variantId,
          productId,
          v.sizeId ?? null,
          v.colorId ?? null,
          sku,
          newBarcode(),
          cost,
          price,
          reorder,
          v.active ? 1 : 0,
          getDeviceId(),
          t,
          t
        )
        const qty = Math.max(0, Math.floor(v.openingQty ?? 0))
        if (qty > 0) {
          run('UPDATE product_variants SET stock_qty = stock_qty + ? WHERE id = ?', qty, variantId)
          run(
            `INSERT INTO stock_movements (id, variant_id, type, qty_change, ref_type, ref_id, user_id, reason, device_id, created_at)
             VALUES (?, ?, 'opening', ?, 'product', ?, ?, 'Opening stock', ?, ?)`,
            uuid(),
            variantId,
            qty,
            productId,
            me.id,
            getDeviceId(),
            t
          )
        }
      }
      if (v.extraBarcode) {
        const code = v.extraBarcode.trim()
        if (barcodeTaken(code, variantId)) throw new AppError('BARCODE_TAKEN', `Barcode ${code} is already used by another item.`)
        run('INSERT OR IGNORE INTO variant_barcodes (barcode, variant_id, created_at) VALUES (?, ?, ?)', code, variantId, t)
      }
    }
    logActivity(me.id, input.id ? 'product.update' : 'product.create', 'product', productId, { name: input.name })
    return getProduct(productId)
  })
}

// ---------- Lookup for the POS ----------

export function findBarcode(code: string) {
  const c = code.trim()
  if (!c) return null
  let v = get(`${VARIANT_SELECT} WHERE v.barcode = ? AND v.active = 1 AND p.active = 1`, c)
  if (!v) {
    const alt = get('SELECT variant_id FROM variant_barcodes WHERE barcode = ?', c)
    if (alt) v = get(`${VARIANT_SELECT} WHERE v.id = ? AND v.active = 1 AND p.active = 1`, alt.variant_id)
  }
  if (!v) v = get(`${VARIANT_SELECT} WHERE v.sku = ? COLLATE NOCASE AND v.active = 1 AND p.active = 1`, c)
  return v ?? null
}

export function searchVariants(text: string, opts: { includeInactive?: boolean } = {}) {
  const s = `%${text.trim()}%`
  const active = opts.includeInactive ? '' : 'AND v.active = 1 AND p.active = 1'
  return all(
    `${VARIANT_SELECT}
     WHERE (p.name LIKE ? OR p.brand LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ? OR s.name LIKE ? OR c.name LIKE ?) ${active}
     ORDER BY p.name, c.name, s.sort_order LIMIT 60`,
    s,
    s,
    s,
    s,
    s,
    s
  )
}

export function getVariant(id: string) {
  return get(`${VARIANT_SELECT} WHERE v.id = ?`, id)
}
