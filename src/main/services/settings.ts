import { AppError, all, logActivity, setSetting, tx } from '../db'
import { requireUser } from './auth'

/** Settings the screens may read and the owner may change, with defaults. */
export const SETTING_DEFAULTS: Record<string, string> = {
  shop_name: 'My Clothing Shop',
  shop_address: '',
  shop_phone: '',
  receipt_footer: 'Thank you for shopping with us!',
  receipt_width: '80',
  receipt_mode: 'driver',
  receipt_printer: '',
  receipt_copies: '1',
  label_printer: '',
  label_width_mm: '38',
  label_height_mm: '25',
  label_show_shop: '1',
  drawer_enabled: '1',
  invoice_prefix: 'INV',
  low_stock_default: '2',
  auto_lock_minutes: '10',
  backup_folder: '',
  logo_path: '',
  last_usb_copy: ''
}

const EDITABLE = new Set(Object.keys(SETTING_DEFAULTS).filter((k) => k !== 'last_usb_copy' && k !== 'logo_path'))

export function getSettings(): Record<string, string> {
  const out: Record<string, string> = { ...SETTING_DEFAULTS }
  for (const r of all('SELECT key, value FROM settings')) {
    if (r.key in SETTING_DEFAULTS && r.value !== null) out[r.key] = r.value
  }
  return out
}

export function setting(key: keyof typeof SETTING_DEFAULTS | string): string {
  return getSettings()[key] ?? ''
}

export function updateSettings(values: Record<string, string>): Record<string, string> {
  const me = requireUser()
  for (const k of Object.keys(values)) {
    if (!EDITABLE.has(k)) throw new AppError('BAD_SETTING', `Unknown setting: ${k}`)
  }
  if (values.receipt_width && !['58', '80'].includes(values.receipt_width)) {
    throw new AppError('BAD_SETTING', 'Receipt width must be 58 or 80 mm.')
  }
  if (values.receipt_mode && !['driver', 'raw'].includes(values.receipt_mode)) {
    throw new AppError('BAD_SETTING', 'Receipt mode must be driver or raw.')
  }
  tx(() => {
    for (const [k, v] of Object.entries(values)) setSetting(k, v)
  })
  logActivity(me.id, 'settings.update', 'settings', undefined, Object.keys(values))
  return getSettings()
}
