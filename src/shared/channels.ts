import type { Permission } from './permissions'

/**
 * The complete, fixed list of IPC channels the screens may call.
 * - 'public'  : callable without login (status, login, first-time setup)
 * - 'session' : any logged-in user
 * - Permission: the logged-in user must hold this permission
 * Anything not in this list is rejected by the main process.
 */
export const CHANNELS = {
  'app.info': 'public',
  'auth.status': 'public',
  'auth.login': 'public',
  'auth.logout': 'session',
  'setup.complete': 'public',

  'settings.get': 'session',
  'settings.update': 'settings.manage',
  'settings.printers': 'settings.manage',
  'settings.testReceipt': 'settings.manage',
  'settings.testLabel': 'settings.manage',
  'settings.testDrawer': 'settings.manage',
  'settings.pickLogo': 'settings.manage',

  'users.list': 'user.manage',
  'users.save': 'user.manage',
  'users.roles': 'user.manage',

  'catalog.lookups': 'session',
  'catalog.saveCategory': 'product.manage',
  'catalog.saveSize': 'product.manage',
  'catalog.saveColor': 'product.manage',
  'catalog.products': 'product.view',
  'catalog.product': 'product.view',
  'catalog.saveProduct': 'product.manage',
  'catalog.pickImage': 'product.manage',
  'catalog.searchVariants': 'session',
  'catalog.findBarcode': 'session',

  'inventory.stock': 'product.view',
  'inventory.lowStock': 'product.view',
  'inventory.movements': 'product.view',
  'inventory.adjust': 'stock.manage',
  'inventory.receive': 'stock.manage',
  'inventory.purchases': 'stock.manage',
  'inventory.purchase': 'stock.manage',
  'inventory.suppliers': 'stock.manage',
  'inventory.saveSupplier': 'stock.manage',

  'labels.print': 'label.print',
  'labels.barcodeSvg': 'session',

  'sales.saveDraft': 'pos.sell',
  'sales.openCarts': 'pos.sell',
  'sales.discardDraft': 'pos.sell',
  'sales.complete': 'pos.sell',
  'sales.void': 'session',
  'sales.list': 'sales.view',
  'sales.get': 'sales.view',
  'sales.reprint': 'sales.view',
  'sales.receiptPreview': 'sales.view',
  'sales.openDrawer': 'session',
  'sales.dashboard': 'session',

  'reports.daily': 'report.view',
  'reports.monthly': 'report.view',
  'reports.profit': 'report.profit',
  'reports.bestSellers': 'report.view',
  'reports.stock': 'report.view',
  'reports.cashiers': 'report.view',
  'reports.exportCsv': 'report.view',
  'reports.cashCount': 'pos.sell',

  'backup.status': 'backup.manage',
  'backup.run': 'backup.manage',
  'backup.copyToFolder': 'backup.manage',
  'backup.restore': 'backup.manage',

  'log.list': 'log.view',

  'update.check': 'settings.manage',
  'update.install': 'settings.manage'
} as const satisfies Record<string, 'public' | 'session' | Permission>

export type Channel = keyof typeof CHANNELS

export type IpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }
