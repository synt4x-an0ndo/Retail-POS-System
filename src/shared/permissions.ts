// Permissions are enforced in the main process. The UI only uses them to hide buttons.
export const PERMISSIONS = {
  'pos.sell': 'Sell at the counter',
  'sales.view': 'View sales history',
  'sale.void': 'Void (cancel) a completed sale',
  'discount.unlimited': 'Give discounts above the cashier limit',
  'stock.override': 'Sell items with no stock',
  'drawer.open': 'Open the cash drawer without a sale',
  'product.view': 'View products and stock',
  'product.manage': 'Create and edit products and prices',
  'stock.manage': 'Receive stock and make adjustments',
  'label.print': 'Print barcode labels',
  'report.view': 'View sales and stock reports',
  'report.profit': 'View profit and cost prices',
  'user.manage': 'Manage users',
  'settings.manage': 'Change shop and hardware settings',
  'backup.manage': 'Run, copy and restore backups',
  'log.view': 'View the activity log'
} as const

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export const DEFAULT_ROLES: { id: string; name: string; permissions: Permission[] }[] = [
  { id: 'role-owner', name: 'Owner / Admin', permissions: ALL_PERMISSIONS },
  {
    id: 'role-cashier',
    name: 'Cashier',
    permissions: ['pos.sell', 'sales.view', 'product.view', 'label.print']
  }
]
