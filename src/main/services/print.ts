import { BrowserWindow, app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import bwipjs from 'bwip-js/node'
import { AppError, now } from '../db'
import { getSettings } from './settings'

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const money = (n: number) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let imagesDir = ''
export function setImagesDir(dir: string) {
  imagesDir = dir
}

// ---------- Driver printing (works with any printer that has a Windows driver) ----------

async function printHtml(html: string, deviceName: string, widthMm: number, heightMm: number | 'auto', copies = 1): Promise<void> {
  if (!deviceName) throw new AppError('PRINTER_NOT_SET', 'No printer selected. Choose one in Settings → Printers.')
  const win = new BrowserWindow({
    show: false,
    width: Math.round((widthMm / 25.4) * 96) + 40,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    let height = typeof heightMm === 'number' ? heightMm * 1000 : 0
    if (heightMm === 'auto') {
      const px = Number(await win.webContents.executeJavaScript('document.documentElement.scrollHeight'))
      height = Math.max(Math.ceil((px * 25400) / 96) + 2000, 30000)
    }
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          deviceName,
          printBackground: true,
          copies,
          margins: { marginType: 'none' },
          pageSize: { width: Math.round(widthMm * 1000), height: Math.round(height) }
        },
        (ok, reason) => (ok ? resolve() : reject(new AppError('PRINT_FAILED', `Printing failed: ${reason || 'printer not ready'}`)))
      )
    })
  } finally {
    win.destroy()
  }
}

function logoDataUrl(file: string): string | null {
  if (!file || !imagesDir) return null
  const p = join(imagesDir, file)
  if (!existsSync(p)) return null
  return 'data:image/png;base64,' + readFileSync(p).toString('base64')
}

export interface ReceiptData {
  invoice_no: string
  completed_at: string
  cashier_name: string
  status: string
  subtotal: number
  discount_total: number
  grand_total: number
  items: { description: string; sku: string; qty: number; unit_price: number; line_discount: number; line_total: number }[]
  payments: { method: string; amount: number; reference: string | null; tendered: number | null; change_given: number | null }[]
}

const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', bkash: 'bKash', nagad: 'Nagad' }

export function receiptHtml(sale: ReceiptData, reprint = false): string {
  const { css, body, width } = receiptParts(sale, reprint)
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>
  @page { size: ${width}mm auto; margin: 0 }
  html, body { overflow: hidden; margin: 0 }
  ${css}
</style></head><body>${body}</body></html>`
}

/** The receipt's scoped CSS and markup: printed as a page, and shown on screen as an exact preview. */
export function receiptParts(sale: ReceiptData, reprint = false): { css: string; body: string; width: number } {
  const s = getSettings()
  const width = s.receipt_width === '58' ? 58 : 80
  const content = width === 58 ? 48 : 72
  const logo = logoDataUrl(s.logo_path)
  const rows = sale.items
    .map(
      (it) => `
      <tr><td colspan="3" class="name">${esc(it.description)}</td></tr>
      <tr><td>${it.qty} × ${money(it.unit_price)}</td><td></td><td class="r">${money(it.qty * it.unit_price)}</td></tr>
      ${it.line_discount > 0 ? `<tr><td class="muted">Discount</td><td></td><td class="r">-${money(it.line_discount)}</td></tr>` : ''}`
    )
    .join('')
  const pays = sale.payments
    .map(
      (p) => `<tr><td>${METHOD[p.method] ?? esc(p.method)}${p.reference ? ` <span class="muted">(${esc(p.reference)})</span>` : ''}</td><td></td><td class="r">${money(p.amount)}</td></tr>
      ${p.method === 'cash' && p.tendered ? `<tr><td class="muted">Received</td><td></td><td class="r">${money(p.tendered)}</td></tr><tr><td class="muted">Change</td><td></td><td class="r">${money(p.change_given ?? 0)}</td></tr>` : ''}`
    )
    .join('')
  const billDiscount = sale.discount_total - sale.items.reduce((a, b) => a + b.line_discount, 0)
  const css = `
  .rcpt, .rcpt * { box-sizing: border-box }
  .rcpt { margin: 0; padding: 2mm ${(width - content) / 2}mm 4mm; width: ${width}mm; background: #fff; font-family: 'Segoe UI', 'Nirmala UI', Arial, sans-serif; font-size: ${width === 58 ? 10 : 11.5}px; color: #000 }
  .c { text-align: center } .r { text-align: right; white-space: nowrap } .muted { color: #333; font-size: 0.9em }
  h1 { font-size: 1.45em; margin: 0 0 1mm } .logo { max-width: 60%; max-height: 18mm; display: block; margin: 0 auto 1mm }
  table { width: 100%; border-collapse: collapse } td { padding: 0.3mm 0; vertical-align: top }
  .name { font-weight: 600; padding-top: 1mm } hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0 }
  .total td { font-size: 1.3em; font-weight: 700 } .void { font-size: 1.6em; font-weight: 800; border: 2px solid #000; padding: 1mm }`
  const body = `<div class="rcpt">
  ${logo ? `<img class="logo" src="${logo}">` : ''}
  <div class="c"><h1>${esc(s.shop_name)}</h1>
  ${s.shop_address ? `<div>${esc(s.shop_address)}</div>` : ''}${s.shop_phone ? `<div>Phone: ${esc(s.shop_phone)}</div>` : ''}</div>
  <hr>
  <table>
    <tr><td>Invoice</td><td></td><td class="r">${esc(sale.invoice_no)}</td></tr>
    <tr><td>Date</td><td></td><td class="r">${esc(sale.completed_at.slice(0, 16))}</td></tr>
    <tr><td>Cashier</td><td></td><td class="r">${esc(sale.cashier_name)}</td></tr>
  </table>
  ${sale.status === 'voided' ? '<div class="c void">CANCELLED</div>' : ''}
  ${reprint ? '<div class="c muted">*** REPRINT ***</div>' : ''}
  <hr><table>${rows}</table><hr>
  <table>
    <tr><td>Subtotal</td><td></td><td class="r">${money(sale.subtotal)}</td></tr>
    ${sale.discount_total > 0 ? `<tr><td>Discount</td><td></td><td class="r">-${money(sale.discount_total)}</td></tr>` : ''}
    ${billDiscount > 0.004 ? `<tr><td class="muted">incl. bill discount</td><td></td><td class="r muted">${money(billDiscount)}</td></tr>` : ''}
    <tr class="total"><td>TOTAL ৳</td><td></td><td class="r">${money(sale.grand_total)}</td></tr>
  </table><hr>
  <table>${pays}</table><hr>
  <div class="c">${esc(s.receipt_footer)}</div>
  <div class="c muted" style="margin-top:2mm">Items: ${sale.items.reduce((a, b) => a + b.qty, 0)} · The Raw Bros POS</div>
</div>`
  return { css, body, width }
}

// ---------- Raw ESC/POS (optional fast path; ASCII only) ----------

function escposReceipt(sale: ReceiptData, reprint: boolean): Buffer {
  const s = getSettings()
  const cols = s.receipt_width === '58' ? 32 : 48
  const ascii = (t: string) => t.replace(/৳/g, 'Tk').replace(/[^\x20-\x7E]/g, '?')
  const line = (l: string, r = '') => {
    const left = ascii(l)
    const right = ascii(r)
    const space = Math.max(1, cols - left.length - right.length)
    return (left + ' '.repeat(space) + right).slice(0, Math.max(cols, left.length + right.length + 1)) + '\n'
  }
  const parts: (string | number[])[] = []
  parts.push([0x1b, 0x40], [0x1b, 0x61, 1], [0x1b, 0x45, 1], ascii(s.shop_name) + '\n', [0x1b, 0x45, 0])
  if (s.shop_address) parts.push(ascii(s.shop_address) + '\n')
  if (s.shop_phone) parts.push('Phone: ' + ascii(s.shop_phone) + '\n')
  parts.push([0x1b, 0x61, 0], '-'.repeat(cols) + '\n')
  parts.push(line('Invoice', sale.invoice_no), line('Date', sale.completed_at.slice(0, 16)), line('Cashier', sale.cashier_name))
  if (sale.status === 'voided') parts.push('*** CANCELLED ***\n')
  if (reprint) parts.push('*** REPRINT ***\n')
  parts.push('-'.repeat(cols) + '\n')
  for (const it of sale.items) {
    parts.push(ascii(it.description).slice(0, cols) + '\n', line(`  ${it.qty} x ${money(it.unit_price)}`, money(it.qty * it.unit_price)))
    if (it.line_discount > 0) parts.push(line('  Discount', '-' + money(it.line_discount)))
  }
  parts.push('-'.repeat(cols) + '\n', line('Subtotal', money(sale.subtotal)))
  if (sale.discount_total > 0) parts.push(line('Discount', '-' + money(sale.discount_total)))
  parts.push([0x1b, 0x45, 1], line('TOTAL Tk', money(sale.grand_total)), [0x1b, 0x45, 0], '-'.repeat(cols) + '\n')
  for (const p of sale.payments) {
    parts.push(line(METHOD[p.method] + (p.reference ? ` (${p.reference})` : ''), money(p.amount)))
    if (p.method === 'cash' && p.tendered) parts.push(line('  Received', money(p.tendered)), line('  Change', money(p.change_given ?? 0)))
  }
  parts.push('-'.repeat(cols) + '\n', [0x1b, 0x61, 1], ascii(s.receipt_footer) + '\n\n\n\n', [0x1d, 0x56, 0x42, 0x00])
  return Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'ascii') : Buffer.from(p))))
}

const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

function rawScriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'raw-print.ps1') : join(app.getAppPath(), 'resources', 'raw-print.ps1')
}

/** Send raw bytes to a Windows printer queue through the bundled, fixed helper script. */
export function sendRaw(printerName: string, data: Buffer): Promise<void> {
  if (!printerName) return Promise.reject(new AppError('PRINTER_NOT_SET', 'No receipt printer selected.'))
  if (!/^[^"\r\n]{1,200}$/.test(printerName)) return Promise.reject(new AppError('BAD_PRINTER', 'Invalid printer name.'))
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', rawScriptPath(), printerName, data.toString('base64')],
      { windowsHide: true, timeout: 20000 },
      (err, _stdout, stderr) => (err ? reject(new AppError('PRINT_FAILED', `Raw print failed: ${stderr || err.message}`)) : resolve())
    )
  })
}

export async function printReceipt(sale: ReceiptData, opts: { reprint?: boolean; openDrawer?: boolean } = {}) {
  const s = getSettings()
  const copies = Math.max(1, Math.min(3, Number(s.receipt_copies) || 1))
  if (s.receipt_mode === 'raw') {
    let data = escposReceipt(sale, !!opts.reprint)
    if (opts.openDrawer && s.drawer_enabled === '1') data = Buffer.concat([DRAWER_KICK, data])
    for (let i = 0; i < copies; i++) await sendRaw(s.receipt_printer, data)
    return
  }
  await printHtml(receiptHtml(sale, opts.reprint), s.receipt_printer, s.receipt_width === '58' ? 58 : 80, 'auto', copies)
  if (opts.openDrawer && s.drawer_enabled === '1') {
    // Driver mode: send the drawer pulse separately. Failure here must not fail the sale.
    await sendRaw(s.receipt_printer, DRAWER_KICK).catch(() => undefined)
  }
}

export async function openDrawer() {
  const s = getSettings()
  if (s.drawer_enabled !== '1') throw new AppError('DRAWER_DISABLED', 'Cash drawer is turned off in Settings.')
  await sendRaw(s.receipt_printer, DRAWER_KICK)
}

// ---------- Barcode labels ----------

export interface LabelItem {
  barcode: string
  product_name: string
  size_name: string | null
  color_name: string | null
  sell_price: number
  qty: number
}

/**
 * Code 128 barcode sized for a 203 dpi thermal label printer: each bar module is a whole number
 * of printer dots (0.125 mm), and the code is centred so both quiet zones stay blank.
 */
export function barcodeSvg(text: string, availableMm: number): { svg: string; widthMm: number } {
  const raw = bwipjs.toSVG({ bcid: 'code128', text, scale: 1, height: 9, includetext: false, paddingwidth: 0, paddingheight: 0 })
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(raw)
  const modules = vb ? Number(vb[1]) : 100
  const dot = 0.125
  const dots = Math.max(1, Math.min(3, Math.floor(availableMm / modules / dot)))
  const widthMm = modules * dots * dot
  const svg = raw.replace('<svg ', `<svg preserveAspectRatio="none" style="width:${widthMm}mm;height:100%" `)
  return { svg, widthMm }
}

export function labelsHtml(items: LabelItem[]): string {
  const s = getSettings()
  const w = Number(s.label_width_mm) || 38
  const h = Number(s.label_height_mm) || 25
  const pages: string[] = []
  // Keep at least 2.5 mm blank on each side of the bars (quiet zone) inside the 1.5 mm label margin.
  const barSpace = w - 3 - 5
  for (const it of items) {
    const { svg } = barcodeSvg(it.barcode, barSpace)
    const variant = [it.size_name, it.color_name].filter(Boolean).join(' · ')
    const one = `<div class="label">
      ${s.label_show_shop === '1' ? `<div class="shop">${esc(s.shop_name)}</div>` : ''}
      <div class="name">${esc(it.product_name)}</div>
      ${variant ? `<div class="var">${esc(variant)}</div>` : ''}
      <div class="bc">${svg}</div>
      <div class="row"><span class="digits">${esc(it.barcode)}</span><span class="price">৳${money(it.sell_price).replace(/\.00$/, '')}</span></div>
    </div>`
    for (let i = 0; i < Math.max(0, Math.min(500, it.qty)); i++) pages.push(one)
  }
  const small = h < 22
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>
  @page { size: ${w}mm ${h}mm; margin: 0 }
  * { box-sizing: border-box; margin: 0 }
  html, body { overflow: hidden }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #000 }
  .label { width: ${w}mm; height: ${h}mm; padding: 1mm 1.5mm; overflow: hidden; display: flex; flex-direction: column; page-break-after: always; break-after: page }
  .label:last-child { page-break-after: auto; break-after: auto }
  .shop { font-size: 6px; text-transform: uppercase; letter-spacing: .5px; text-align: center }
  .name { font-size: ${small ? 6.5 : 7.5}px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center }
  .var { font-size: 7px; text-align: center }
  .bc { flex: 1; min-height: 0; display: flex; justify-content: center; padding: .5mm 0 }
  .bc svg { display: block; shape-rendering: crispEdges }
  .row { display: flex; justify-content: space-between; align-items: baseline }
  .digits { font-size: 7px; letter-spacing: .5px } .price { font-size: ${small ? 8 : 10}px; font-weight: 800 }
</style></head><body>${pages.join('')}</body></html>`
}

export async function printLabels(items: LabelItem[]) {
  const s = getSettings()
  const total = items.reduce((a, b) => a + b.qty, 0)
  if (total <= 0) throw new AppError('NO_LABELS', 'Nothing to print.')
  if (total > 2000) throw new AppError('TOO_MANY', 'Print at most 2,000 labels at a time.')
  await printHtml(labelsHtml(items), s.label_printer, Number(s.label_width_mm) || 38, Number(s.label_height_mm) || 25)
}

export async function listPrinters(win: BrowserWindow) {
  const list = await win.webContents.getPrintersAsync()
  return list.map((p) => ({ name: p.name, displayName: p.displayName, isDefault: (p as any).isDefault ?? false }))
}

export function testReceiptData(): ReceiptData {
  return {
    invoice_no: 'TEST-0001',
    completed_at: now(),
    cashier_name: 'Test',
    status: 'completed',
    subtotal: 1500,
    discount_total: 100,
    grand_total: 1400,
    items: [
      { description: 'Test Shirt – M / Black', sku: 'TEST', qty: 1, unit_price: 1000, line_discount: 100, line_total: 900 },
      { description: 'Test Socks', sku: 'TEST2', qty: 2, unit_price: 250, line_discount: 0, line_total: 500 }
    ],
    payments: [{ method: 'cash', amount: 1400, reference: null, tendered: 2000, change_given: 600 }]
  }
}
