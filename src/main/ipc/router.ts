import { BrowserWindow, dialog, ipcMain, nativeImage, type IpcMainInvokeEvent } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANNELS, type Channel, type IpcResult } from '@shared/channels'
import type { Permission } from '@shared/permissions'
import { AppError, all, getDbPath, logActivity, setSetting, uuid } from '../db'
import { SCHEMAS } from './schemas'
import * as auth from '../services/auth'
import * as users from '../services/users'
import * as settings from '../services/settings'
import * as catalog from '../services/catalog'
import * as inventory from '../services/inventory'
import * as sales from '../services/sales'
import * as reports from '../services/reports'
import * as backup from '../services/backup'
import * as print from '../services/print'
import * as updates from '../services/updates'

export interface RouterContext {
  getWindow: () => BrowserWindow | null
  imagesDir: string
  appVersion: string
  restoreAndRelaunch: (backupFile: string) => Promise<void>
  beforeQuit: () => Promise<void>
}

type Handler = (input: any, ctx: RouterContext) => unknown | Promise<unknown>

async function printSale(saleId: string, reprint: boolean, openDrawer: boolean) {
  const s = sales.getSale(saleId) as any
  await print.printReceipt(s, { reprint, openDrawer })
}

function reportTable(input: any): reports.Table {
  switch (input.report) {
    case 'daily':
      return reports.daily(input.day).table
    case 'monthly':
      return reports.monthly(input.month)
    case 'profit':
      if (!auth.hasPermission('report.profit')) throw new AppError('FORBIDDEN', 'You do not have permission for this.')
      return reports.profit(input.from, input.to)
    case 'bestSellers':
      return reports.bestSellers(input.from, input.to, input.by ?? 'qty').table
    case 'stock':
      return reports.stock()
    default:
      return reports.cashiers(input.from, input.to)
  }
}

const HANDLERS: Record<Channel, Handler> = {
  'app.info': (_i, ctx) => ({ version: ctx.appVersion, dbPath: getDbPath(), backupDir: backup.getBackupDir() }),
  'auth.status': () => ({ setupDone: auth.isSetupDone(), user: auth.currentUser() }),
  'auth.login': (i) => auth.login(i.username, i.secret),
  'auth.logout': () => auth.logout(),
  'setup.complete': (i) => auth.completeSetup(i),

  'settings.get': () => settings.getSettings(),
  'settings.update': (i) => settings.updateSettings(i),
  'settings.printers': (_i, ctx) => {
    const w = ctx.getWindow()
    return w ? print.listPrinters(w) : []
  },
  'settings.testReceipt': () => print.printReceipt(print.testReceiptData(), { openDrawer: false }),
  'settings.testLabel': () =>
    print.printLabels([{ barcode: '2000000000', product_name: 'Test Shirt', size_name: 'M', color_name: 'Black', sell_price: 1250, qty: 1 }]),
  'settings.testDrawer': () => print.openDrawer(),
  'settings.pickLogo': async (_i, ctx) => {
    const w = ctx.getWindow()
    const r = await dialog.showOpenDialog(w!, { title: 'Choose shop logo', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    const img = nativeImage.createFromPath(r.filePaths[0])
    if (img.isEmpty()) throw new AppError('BAD_IMAGE', 'That file is not a readable image.')
    const resized = img.getSize().width > 400 ? img.resize({ width: 400 }) : img
    const name = `logo-${uuid()}.png`
    writeFileSync(join(ctx.imagesDir, name), resized.toPNG())
    setSetting('logo_path', name)
    logActivity(auth.requireUser().id, 'settings.logo', 'settings')
    return name
  },

  'users.list': () => users.listUsers(),
  'users.roles': () => users.listRoles(),
  'users.save': (i) => users.saveUser({ ...i, password: i.password || null, pin: i.pin || null }),

  'catalog.lookups': () => catalog.lookups(),
  'catalog.saveCategory': (i) => catalog.saveCategory(i),
  'catalog.saveSize': (i) => catalog.saveSize(i),
  'catalog.saveColor': (i) => catalog.saveColor(i),
  'catalog.products': (i) => catalog.listProducts(i),
  'catalog.product': (i) => {
    const p: any = catalog.getProduct(i.id)
    if (!auth.hasPermission('report.profit') && !auth.hasPermission('product.manage')) for (const v of p.variants) delete v.cost_price
    return p
  },
  'catalog.saveProduct': (i) => catalog.saveProduct(i),
  'catalog.pickImage': async (_i, ctx) => {
    const w = ctx.getWindow()
    const r = await dialog.showOpenDialog(w!, { title: 'Choose product photo', filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    const img = nativeImage.createFromPath(r.filePaths[0])
    if (img.isEmpty()) throw new AppError('BAD_IMAGE', 'That file is not a readable image.')
    const resized = img.getSize().width > 600 ? img.resize({ width: 600, quality: 'good' }) : img
    const name = `${uuid()}.jpg`
    writeFileSync(join(ctx.imagesDir, name), resized.toJPEG(82))
    return name
  },
  'catalog.searchVariants': (i) => {
    const rows = catalog.searchVariants(i.text)
    if (!auth.hasPermission('report.profit') && !auth.hasPermission('product.manage')) for (const r of rows) delete r.cost_price
    return rows
  },
  'catalog.findBarcode': (i) => {
    const v = catalog.findBarcode(i.code)
    if (v && !auth.hasPermission('report.profit') && !auth.hasPermission('product.manage')) delete v.cost_price
    return v
  },

  'inventory.stock': (i) => {
    const rows = inventory.stockList(i)
    if (!auth.hasPermission('report.profit') && !auth.hasPermission('product.manage')) for (const r of rows) delete r.cost_price
    return rows
  },
  'inventory.lowStock': () => inventory.lowStock().map(({ cost_price: _c, ...r }) => r),
  'inventory.movements': (i) => inventory.movements(i.variantId),
  'inventory.adjust': (i) => inventory.adjust(i),
  'inventory.receive': (i) => inventory.receive(i),
  'inventory.purchases': () => inventory.purchases(),
  'inventory.purchase': (i) => inventory.purchase(i.id),
  'inventory.suppliers': () => inventory.suppliers(),
  'inventory.saveSupplier': (i) => inventory.saveSupplier(i),

  'labels.print': async (i) => {
    const items: print.LabelItem[] = []
    for (const it of i.items as { variantId: string; qty: number }[]) {
      if (it.qty <= 0) continue
      const v = catalog.getVariant(it.variantId)
      if (!v) throw new AppError('NOT_FOUND', 'Item not found.')
      items.push({ barcode: v.barcode, product_name: v.product_name, size_name: v.size_name, color_name: v.color_name, sell_price: v.sell_price, qty: it.qty })
    }
    await print.printLabels(items)
    logActivity(auth.requireUser().id, 'labels.print', 'label', undefined, { count: items.reduce((a, b) => a + b.qty, 0) })
    return { printed: items.reduce((a, b) => a + b.qty, 0) }
  },

  // Generated by bwip-js from a validated code: safe to insert as SVG on screen.
  'labels.barcodeSvg': (i) => print.barcodeSvg(i.code, 40).svg,

  'sales.saveDraft': (i) => sales.saveDraft(i),
  'sales.openCarts': () => sales.openCarts(),
  'sales.discardDraft': (i) => sales.discardDraft(i.saleId),
  'sales.complete': async (i) => {
    const { print: doPrint, ...input } = i
    const result: any = sales.complete(input)
    // The sale is committed. Printing happens after and can never undo it.
    let printError: string | null = null
    if (doPrint && !result.alreadyCompleted) {
      try {
        await printSale(result.saleId, false, !!result.hasCash)
      } catch (e: any) {
        printError = e?.message ?? String(e)
      }
    }
    return { ...result, printError }
  },
  'sales.void': (i) => sales.voidSale(i),
  'sales.list': (i) => sales.listSales(i),
  'sales.get': (i) => sales.getSale(i.id),
  'sales.reprint': async (i) => {
    await printSale(i.id, true, false)
    logActivity(auth.requireUser().id, 'sale.reprint', 'sale', i.id)
    return { printed: true }
  },
  'sales.receiptPreview': (i) => {
    const { css, body } = print.receiptParts(sales.getSale(i.id) as any)
    return { css, body }
  },
  'sales.openDrawer': async (i) => {
    const by = auth.authorise('drawer.open', i.overridePin)
    await print.openDrawer()
    logActivity(auth.requireUser().id, 'drawer.open', 'drawer', undefined, { approvedBy: by })
    return { opened: true }
  },
  'sales.dashboard': () => sales.dashboard(),

  'reports.daily': (i) => reports.daily(i.day),
  'reports.monthly': (i) => reports.monthly(i.month),
  'reports.profit': (i) => reports.profit(i.from, i.to),
  'reports.bestSellers': (i) => reports.bestSellers(i.from, i.to, i.by),
  'reports.stock': () => reports.stock(),
  'reports.cashiers': (i) => reports.cashiers(i.from, i.to),
  'reports.exportCsv': async (i, ctx) => {
    const t = reportTable(i)
    const w = ctx.getWindow()
    const name = t.title.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-') + '.csv'
    const r = await dialog.showSaveDialog(w!, { title: 'Save report for Excel', defaultPath: name, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, reports.toCsv(t), 'utf8')
    logActivity(auth.requireUser().id, 'report.export', 'report', i.report)
    return { path: r.filePath }
  },
  'reports.cashCount': (i) => reports.recordCashCount(i),

  'backup.status': () => backup.listBackups(),
  'backup.run': async () => {
    const r = await backup.runBackup('manual')
    logActivity(auth.requireUser().id, 'backup.manual', 'backup', undefined, { path: r.path })
    return r
  },
  'backup.copyToFolder': async (i, ctx) => {
    let folder = i.useSaved ? settings.setting('backup_folder') : ''
    if (!folder) {
      const r = await dialog.showOpenDialog(ctx.getWindow()!, { title: 'Choose the pen drive or backup folder', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      folder = r.filePaths[0]
    }
    return backup.copyToFolder(folder, auth.requireUser().id)
  },
  'backup.restore': async (i, ctx) => {
    let file: string
    if (i.fromList) {
      file = join(backup.getBackupDir(), i.fromList)
    } else {
      const r = await dialog.showOpenDialog(ctx.getWindow()!, {
        title: 'Choose a backup file to restore',
        filters: [{ name: 'POS backup', extensions: ['db'] }],
        properties: ['openFile']
      })
      if (r.canceled || !r.filePaths[0]) return null
      file = r.filePaths[0]
    }
    const info = backup.validateBackupFile(file)
    const confirm = await dialog.showMessageBox(ctx.getWindow()!, {
      type: 'warning',
      title: 'Restore backup',
      message: 'Replace all current data with this backup?',
      detail: `${file}\n\nIt contains ${info.products} products and ${info.sales} completed sales.\nA safety backup of the current data is made first. The POS will restart.`,
      buttons: ['Cancel', 'Restore and restart'],
      defaultId: 0,
      cancelId: 0
    })
    if (confirm.response !== 1) return null
    await backup.runBackup('safety')
    logActivity(auth.requireUser().id, 'backup.restore', 'backup', undefined, { file })
    await ctx.restoreAndRelaunch(file)
    return { restarting: true }
  },

  'log.list': (i) => {
    const params: any[] = [i.from, i.to]
    let extra = ''
    if (i.action) {
      extra = ' AND a.action LIKE ?'
      params.push(`%${i.action}%`)
    }
    return all(
      `SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE substr(a.created_at, 1, 10) BETWEEN ? AND ?${extra} ORDER BY a.created_at DESC LIMIT 1000`,
      ...params
    )
  },

  'update.check': () => updates.checkForUpdates(),
  'update.install': async (_i, ctx) => updates.installUpdate(ctx.beforeQuit)
}

function fail(code: string, message: string): IpcResult {
  return { ok: false, code, message }
}

export function registerIpc(ctx: RouterContext): void {
  for (const channel of Object.keys(CHANNELS) as Channel[]) {
    ipcMain.handle(`pos:${channel}`, async (event: IpcMainInvokeEvent, payload: unknown): Promise<IpcResult> => {
      // 1. Only our own main window's top frame may call.
      const win = ctx.getWindow()
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
        return fail('FORBIDDEN_SENDER', 'Request rejected.')
      }
      // 2. Login and permission.
      const rule = CHANNELS[channel]
      if (rule !== 'public') {
        const user = auth.currentUser()
        if (!user) return fail('NOT_LOGGED_IN', 'Please log in again.')
        if (rule !== 'session' && !user.permissions.includes(rule as Permission)) {
          return fail('FORBIDDEN', 'You do not have permission for this.')
        }
      }
      // 3. Input validation.
      const parsed = SCHEMAS[channel].safeParse(payload)
      if (!parsed.success) {
        const first = parsed.error.issues[0]
        return fail('INVALID_INPUT', first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input.')
      }
      try {
        const data = await HANDLERS[channel](parsed.data, ctx)
        return { ok: true, data: data === undefined ? null : data }
      } catch (e: any) {
        if (e instanceof AppError) return fail(e.code, e.message)
        const msg = String(e?.message ?? e)
        if (/UNIQUE constraint failed/i.test(msg)) return fail('DUPLICATE', 'That value is already used.')
        console.error(`[ipc ${channel}]`, e)
        try {
          logActivity(auth.currentUser()?.id ?? null, 'error', 'ipc', channel, { message: msg.slice(0, 500) })
        } catch {
          /* ignore */
        }
        return fail('INTERNAL', 'Something went wrong. Please try again.')
      }
    })
  }
}
