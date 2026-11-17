/**
 * Core business-logic test against a real SQLite file (no UI, no printers).
 * Build + run:  npm run test:core
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { closeDatabase, get, openDatabase } from '../src/main/db'
import * as auth from '../src/main/services/auth'
import * as users from '../src/main/services/users'
import * as catalog from '../src/main/services/catalog'
import * as inventory from '../src/main/services/inventory'
import * as sales from '../src/main/services/sales'
import * as reports from '../src/main/services/reports'
import * as backup from '../src/main/services/backup'

let passed = 0
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
    throw new Error(msg)
  }
  passed++
  console.log('  ok -', msg)
}
async function expectError(fn: () => unknown, code: string, msg: string) {
  try {
    await fn()
  } catch (e: any) {
    check(e.code === code, `${msg} (got ${e.code})`)
    return
  }
  check(false, `${msg} (no error thrown)`)
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'trb-pos-test-'))
  const dbFile = join(dir, 'pos.db')
  try {
    openDatabase(dbFile)
    auth.seedRoles()
    backup.initBackups(join(dir, 'backups'))

    console.log('Setup and login')
    check(!auth.isSetupDone(), 'fresh database needs setup')
    auth.completeSetup({ shopName: 'Test Shop', address: 'Dhaka', phone: '017', receiptFooter: 'Thanks', ownerName: 'Owner', username: 'owner', password: 'secret1', pin: '1234' })
    check(auth.isSetupDone(), 'setup completed')
    await expectError(() => auth.completeSetup({} as any), 'SETUP_DONE', 'setup cannot run twice')
    users.saveUser({ name: 'Rahim', username: 'rahim', password: 'cash123', pin: '5555', roleId: 'role-cashier', discountLimitPct: 10, active: true })

    console.log('Catalogue')
    const cat = catalog.saveCategory({ name: 'Shirts', code: 'SHRT', active: true })
    const sM = catalog.saveSize({ name: 'M', sortOrder: 10 })
    const sL = catalog.saveSize({ name: 'L', sortOrder: 20 })
    const cB = catalog.saveColor({ name: 'Black', code: 'BLK', sortOrder: 10 })
    const p: any = catalog.saveProduct({
      name: 'Oxford Shirt',
      categoryId: cat.id,
      active: true,
      variants: [
        { sizeId: sM.id, colorId: cB.id, costPrice: 600, sellPrice: 1000, reorderLevel: 2, openingQty: 5, active: true },
        { sizeId: sL.id, colorId: cB.id, costPrice: 600, sellPrice: 1100, reorderLevel: 2, openingQty: 1, active: true, extraBarcode: '8901234567890' }
      ]
    })
    const [vm, vl] = p.variants
    check(p.variants.length === 2, 'two variants created')
    check(/^20\d{8}$/.test(vm.barcode) && vm.barcode !== vl.barcode, `unique 10-digit barcodes (${vm.barcode}, ${vl.barcode})`)
    check(vm.sku === 'SHRT-0001-BLK-M', `SKU generated (${vm.sku})`)
    check(vm.stock_qty === 5, 'opening stock recorded')
    check(catalog.findBarcode(vm.barcode)?.id === vm.id, 'barcode lookup finds variant')
    check(catalog.findBarcode('8901234567890')?.id === vl.id, 'maker barcode lookup finds variant')
    check(catalog.searchVariants('oxford').length === 2, 'name search works')

    console.log('Selling as cashier')
    auth.logout()
    auth.login('rahim', '5555')
    check(auth.currentUser()?.roleId === 'role-cashier', 'cashier logged in with PIN')
    const saleId = randomUUID()
    sales.saveDraft({ saleId, status: 'draft', items: [{ variantId: vm.id, qty: 2, lineDiscount: 0 }], billDiscount: 0 })
    check(sales.openCarts().some((c) => c.id === saleId), 'draft saved for crash recovery')
    const r1 = sales.complete({ saleId, items: [{ variantId: vm.id, qty: 2, lineDiscount: 100 }], billDiscount: 0, payments: [], cashTendered: 2000 })
    check(/^INV-\d{8}-0001$/.test(r1.invoiceNo), `invoice number ${r1.invoiceNo}`)
    check(r1.change === 100, `change calculated (${r1.change})`)
    check(catalog.getVariant(vm.id)!.stock_qty === 3, 'stock deducted after sale')
    const again = sales.complete({ saleId, items: [{ variantId: vm.id, qty: 2, lineDiscount: 100 }], billDiscount: 0, payments: [], cashTendered: 2000 })
    check(again.alreadyCompleted && again.invoiceNo === r1.invoiceNo, 'duplicate submit returns same invoice')
    check(catalog.getVariant(vm.id)!.stock_qty === 3, 'duplicate submit did not deduct stock twice')

    await expectError(
      () => sales.complete({ saleId: randomUUID(), items: [{ variantId: vm.id, qty: 1, lineDiscount: 300 }], billDiscount: 0, payments: [], cashTendered: 1000 }),
      'OVERRIDE_REQUIRED',
      '30% discount needs owner approval'
    )
    await expectError(
      () => sales.complete({ saleId: randomUUID(), items: [{ variantId: vm.id, qty: 1, lineDiscount: 300 }], billDiscount: 0, payments: [], cashTendered: 1000, overridePin: '9999' }),
      'OVERRIDE_FAILED',
      'wrong owner PIN rejected'
    )
    const r2 = sales.complete({ saleId: randomUUID(), items: [{ variantId: vm.id, qty: 1, lineDiscount: 300 }], billDiscount: 0, payments: [], cashTendered: 700, overridePin: '1234' })
    check(get('SELECT approved_by FROM sales WHERE invoice_no = ?', r2.invoiceNo)?.approved_by, 'owner PIN approves discount')

    await expectError(
      () => sales.complete({ saleId: randomUUID(), items: [{ variantId: vl.id, qty: 2, lineDiscount: 0 }], billDiscount: 0, payments: [], cashTendered: 5000 }),
      'OVERRIDE_REQUIRED',
      'selling more than stock needs approval'
    )
    await expectError(
      () => sales.complete({ saleId: randomUUID(), items: [{ variantId: vl.id, qty: 1, lineDiscount: 0 }], billDiscount: 0, payments: [{ method: 'bkash', amount: 1100 }] }),
      'REFERENCE_REQUIRED',
      'bKash needs a transaction ID'
    )
    await expectError(
      () => sales.complete({ saleId: randomUUID(), items: [{ variantId: vl.id, qty: 1, lineDiscount: 0 }], billDiscount: 0, payments: [], cashTendered: 500 }),
      'UNDERPAID',
      'underpayment rejected'
    )
    const r3 = sales.complete({
      saleId: randomUUID(),
      items: [{ variantId: vl.id, qty: 1, lineDiscount: 0 }],
      billDiscount: 0,
      payments: [{ method: 'bkash', amount: 600, reference: 'TXN123' }],
      cashTendered: 500
    })
    check(!!r3.invoiceNo && r3.change === 0, 'split bKash + cash payment')

    console.log('Void')
    await expectError(() => sales.voidSale({ saleId, reason: 'Customer returned' }), 'OVERRIDE_REQUIRED', 'cashier cannot void without owner')
    sales.voidSale({ saleId, reason: 'Customer returned', overridePin: '1234' })
    check(catalog.getVariant(vm.id)!.stock_qty === 4, 'void returns items to stock')
    await expectError(() => sales.voidSale({ saleId, reason: 'again', overridePin: '1234' }), 'NOT_VOIDABLE', 'cannot void twice')

    console.log('Inventory')
    auth.logout()
    auth.login('owner', 'secret1')
    inventory.receive({ updateCost: true, items: [{ variantId: vl.id, qty: 10, unitCost: 650 }], supplierInvoiceNo: 'S-1' })
    check(catalog.getVariant(vl.id)!.stock_qty === 10, 'receiving adds stock')
    check(catalog.getVariant(vl.id)!.cost_price === 650, 'receiving updates cost')
    await expectError(() => inventory.adjust({ variantId: vm.id, qtyChange: -50, reason: 'Damaged' }), 'NEGATIVE_STOCK', 'cannot adjust below zero')
    inventory.adjust({ variantId: vm.id, qtyChange: -1, reason: 'Damaged' })
    check(inventory.verifyLedger().mismatches === 0, 'stock ledger matches cached stock')

    console.log('Reports')
    const today = new Date()
    const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const daily = reports.daily(d)
    check(daily.sales === 2, `daily count excludes voided sale (${daily.sales})`)
    check(daily.total === 700 + 1100, `daily total ${daily.total}`)
    check(daily.profit === 1800 - 1200, `daily profit ${daily.profit}`)
    check(daily.byMethod.find((m: any) => m.method === 'bkash')?.amount === 600, 'payment method totals')
    check(reports.cashiers(d, d).rows[0].voids === 1, 'cashier report counts voids')
    const best = reports.bestSellers(d, d, 'qty')
    check(best.table.rows[0].qty === 2 && best.table.rows[0].revenue === 1800, 'best sellers group sizes under one product')
    check(best.topVariants.length === 2, 'best sellers by size/colour')
    check(reports.stock().totals!.qty === 3 + 10, 'stock report total')
    check(reports.toCsv(reports.stock()).startsWith('﻿Product'), 'CSV export')

    console.log('Backup and restore')
    const b = await backup.runBackup('manual')
    const info = backup.validateBackupFile(b.path)
    check(info.sales === 2 && info.products === 1, `backup file is valid and complete (${info.sales} completed sales)`)
    closeDatabase()
    backup.replaceDatabaseFile(b.path, dbFile)
    openDatabase(dbFile)
    check(get(`SELECT COUNT(*) AS n FROM sales WHERE status IN ('completed','voided')`)!.n === 3, 'restored database opens with all sales (2 completed + 1 voided)')
    check(inventory.verifyLedger().mismatches === 0, 'restored stock ledger is consistent')

    console.log(`\nAll ${passed} checks passed.`)
  } finally {
    try {
      closeDatabase()
    } catch {
      /* ignore */
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
