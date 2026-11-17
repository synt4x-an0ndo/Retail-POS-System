/**
 * Adds demo categories, sizes, colours and 5 garment products with opening stock to an existing shop database.
 * Usage: npm run seed:demo -- "<path to pos.db>"
 * Safe to run while the app is open (SQLite WAL). Skips products that already exist by name.
 */
import { closeDatabase, get, openDatabase } from '../src/main/db'
import * as auth from '../src/main/services/auth'
import * as catalog from '../src/main/services/catalog'

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('Usage: seed-demo <path to pos.db>')
  process.exit(1)
}

openDatabase(dbPath)
const owner = get(`SELECT id, name FROM users WHERE role_id = 'role-owner' AND active = 1 ORDER BY created_at LIMIT 1`)
if (!owner) {
  console.error('Complete the first-time setup in the app first.')
  process.exit(1)
}
auth.actAsForScript(owner.id)

const lk = () => catalog.lookups()
const category = (name: string, code: string, parentId?: string) =>
  lk().categories.find((c: any) => c.name === name && (c.parent_id ?? null) === (parentId ?? null))?.id ?? catalog.saveCategory({ name, code, parentId, active: true }).id
const size = (name: string, order: number) => lk().sizes.find((s: any) => s.name === name)?.id ?? catalog.saveSize({ name, sortOrder: order }).id
const color = (name: string, code: string, order: number) => lk().colors.find((c: any) => c.name === name)?.id ?? catalog.saveColor({ name, code, sortOrder: order }).id

const men = category('Men', 'MEN')
const women = category('Women', 'WMN')
const kids = category('Kids', 'KID')
const shirts = category('Shirts', 'SHRT', men)
const jeans = category('Jeans', 'JNS', men)
const panjabi = category('Panjabi', 'PNJ', men)
const kurti = category('Kurti', 'KRT', women)
const kidsTee = category('T-Shirts', 'KTS', kids)

const S = size('S', 10), M = size('M', 20), L = size('L', 30), XL = size('XL', 40)
const W30 = size('30', 100), W32 = size('32', 110), W34 = size('34', 120), W36 = size('36', 130)

const white = color('White', 'WHT', 10), sky = color('Sky Blue', 'SKY', 20), blue = color('Blue', 'BLU', 30)
const maroon = color('Maroon', 'MRN', 40), pink = color('Pink', 'PNK', 50), green = color('Green', 'GRN', 60)
const red = color('Red', 'RED', 70), navy = color('Navy', 'NVY', 80)

type P = { name: string; brand: string; categoryId: string; sizes: string[]; colors: string[]; cost: number; price: number; qty: number }
const products: P[] = [
  { name: 'Oxford Cotton Shirt', brand: 'Raw Threads', categoryId: shirts, sizes: [S, M, L, XL], colors: [white, sky], cost: 650, price: 1250, qty: 5 },
  { name: 'Slim Fit Denim Jeans', brand: 'Raw Threads', categoryId: jeans, sizes: [W30, W32, W34, W36], colors: [blue], cost: 900, price: 1850, qty: 4 },
  { name: 'Cotton Panjabi', brand: 'Deshi Craft', categoryId: panjabi, sizes: [M, L, XL], colors: [white, maroon], cost: 1100, price: 2200, qty: 3 },
  { name: 'Printed Kurti', brand: 'Rangdhanu', categoryId: kurti, sizes: [S, M, L], colors: [pink, green], cost: 550, price: 1150, qty: 4 },
  { name: 'Kids Polo T-Shirt', brand: 'Little Bros', categoryId: kidsTee, sizes: [S, M, L], colors: [red, navy], cost: 250, price: 550, qty: 6 }
]

for (const p of products) {
  if (get('SELECT 1 FROM products WHERE name = ?', p.name)) {
    console.log(`skip (exists): ${p.name}`)
    continue
  }
  const variants = []
  for (const c of p.colors)
    for (const s of p.sizes) {
      // One low-stock and one sold-out variant per product, so low-stock alerts can be tested.
      const qty = s === p.sizes.at(-1) && c === p.colors[0] ? 1 : s === p.sizes.at(-1) && c === p.colors.at(-1) && p.colors.length > 1 ? 0 : p.qty
      variants.push({ sizeId: s, colorId: c, costPrice: p.cost, sellPrice: p.price, reorderLevel: 2, openingQty: qty, active: true })
    }
  const saved: any = catalog.saveProduct({ name: p.name, brand: p.brand, categoryId: p.categoryId, active: true, variants })
  console.log(`added: ${p.name} – ${saved.variants.length} variants, barcodes ${saved.variants[0].barcode}…${saved.variants.at(-1).barcode}`)
}
closeDatabase()
console.log('Done.')
