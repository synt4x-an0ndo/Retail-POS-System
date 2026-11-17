import { z } from 'zod'
import type { Channel } from '@shared/channels'

const id = z.string().min(1).max(64)
const optId = id.nullable().optional()
const text = (max = 200) => z.string().trim().max(max)
const money = z.number().finite().min(0).max(100_000_000)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits')
const none = z.undefined().or(z.null()).or(z.object({}).strict())

const cartLine = z.object({
  variantId: id,
  qty: z.number().int().min(1).max(10_000),
  lineDiscount: money
})

/** Input schema for every channel. A channel without a schema here is rejected. */
export const SCHEMAS: Record<Channel, z.ZodType> = {
  'app.info': none,
  'auth.status': none,
  'auth.login': z.object({ username: text(60).min(1), secret: z.string().min(1).max(200) }),
  'auth.logout': none,
  'setup.complete': z.object({
    shopName: text(120).min(1),
    address: text(300),
    phone: text(60),
    receiptFooter: text(300),
    ownerName: text(80).min(1),
    username: text(40).min(3).regex(/^[A-Za-z0-9._-]+$/, 'Username: letters, numbers, dot, dash, underscore'),
    password: z.string().min(6).max(200),
    pin: pin.or(z.literal(''))
  }),

  'settings.get': none,
  'settings.update': z.record(z.string().max(40), z.string().max(500)),
  'settings.printers': none,
  'settings.testReceipt': none,
  'settings.testLabel': none,
  'settings.testDrawer': none,
  'settings.pickLogo': none,

  'users.list': none,
  'users.roles': none,
  'users.save': z.object({
    id: optId,
    name: text(80).min(1),
    username: text(40).min(3).regex(/^[A-Za-z0-9._-]+$/),
    password: z.string().min(6).max(200).nullable().optional().or(z.literal('')),
    pin: pin.nullable().optional().or(z.literal('')),
    roleId: id,
    discountLimitPct: z.number().min(0).max(100),
    active: z.boolean()
  }),

  'catalog.lookups': none,
  'catalog.saveCategory': z.object({ id: optId, name: text(80).min(1), code: text(6).nullable().optional(), parentId: optId, active: z.boolean() }),
  'catalog.saveSize': z.object({ id: optId, name: text(20).min(1), code: text(4).nullable().optional(), sortOrder: z.number().int().min(0).max(9999) }),
  'catalog.saveColor': z.object({ id: optId, name: text(30).min(1), code: text(3).nullable().optional(), sortOrder: z.number().int().min(0).max(9999) }),
  'catalog.products': z.object({ search: text(100).optional(), categoryId: optId, includeArchived: z.boolean().optional() }),
  'catalog.product': z.object({ id }),
  'catalog.saveProduct': z.object({
    id: optId,
    name: text(120).min(1),
    brand: text(80).nullable().optional(),
    description: text(1000).nullable().optional(),
    categoryId: optId,
    imagePath: z.string().regex(/^[A-Za-z0-9-]+\.(jpg|png)$/).nullable().optional(),
    active: z.boolean(),
    variants: z
      .array(
        z.object({
          id: optId,
          sizeId: optId,
          colorId: optId,
          costPrice: money,
          sellPrice: money,
          reorderLevel: z.number().int().min(0).max(100_000),
          openingQty: z.number().int().min(0).max(100_000).optional(),
          extraBarcode: text(32).nullable().optional(),
          active: z.boolean()
        })
      )
      .min(1)
      .max(400)
  }),
  'catalog.pickImage': none,
  'catalog.searchVariants': z.object({ text: text(100).min(1) }),
  'catalog.findBarcode': z.object({ code: text(64).min(1) }),

  'inventory.stock': z.object({ search: text(100).optional(), categoryId: optId, lowOnly: z.boolean().optional() }),
  'inventory.lowStock': none,
  'inventory.movements': z.object({ variantId: id }),
  'inventory.adjust': z.object({ variantId: id, qtyChange: z.number().int().min(-100_000).max(100_000), reason: text(200).min(3) }),
  'inventory.receive': z.object({
    supplierId: optId,
    supplierInvoiceNo: text(60).nullable().optional(),
    note: text(300).nullable().optional(),
    updateCost: z.boolean(),
    items: z.array(z.object({ variantId: id, qty: z.number().int().min(1).max(100_000), unitCost: money })).min(1).max(1000)
  }),
  'inventory.purchases': none,
  'inventory.purchase': z.object({ id }),
  'inventory.suppliers': none,
  'inventory.saveSupplier': z.object({ id: optId, name: text(120).min(1), phone: text(60).nullable().optional(), address: text(300).nullable().optional() }),

  'labels.print': z.object({ items: z.array(z.object({ variantId: id, qty: z.number().int().min(0).max(2000) })).min(1).max(1000) }),
  'labels.barcodeSvg': z.object({ code: z.string().regex(/^[0-9A-Za-z-]{1,32}$/) }),

  'sales.saveDraft': z.object({
    saleId: z.string().uuid(),
    status: z.enum(['draft', 'held']),
    items: z.array(cartLine).max(500),
    billDiscount: money,
    note: text(200).nullable().optional()
  }),
  'sales.openCarts': none,
  'sales.discardDraft': z.object({ saleId: z.string().uuid() }),
  'sales.complete': z.object({
    saleId: z.string().uuid(),
    items: z.array(cartLine).min(1).max(500),
    billDiscount: money,
    payments: z.array(z.object({ method: z.enum(['cash', 'card', 'bkash', 'nagad']), amount: money, reference: text(60).nullable().optional() })).max(6),
    cashTendered: money.nullable().optional(),
    overridePin: pin.nullable().optional(),
    print: z.boolean()
  }),
  'sales.void': z.object({ saleId: id, reason: text(200).min(3), overridePin: pin.nullable().optional() }),
  'sales.list': z.object({ from: day, to: day, search: text(60).optional(), status: z.enum(['completed', 'voided']).nullable().optional() }),
  'sales.get': z.object({ id }),
  'sales.reprint': z.object({ id }),
  'sales.receiptPreview': z.object({ id }),
  'sales.openDrawer': z.object({ overridePin: pin.nullable().optional() }),
  'sales.dashboard': none,

  'reports.daily': z.object({ day }),
  'reports.monthly': z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
  'reports.profit': z.object({ from: day, to: day }),
  'reports.bestSellers': z.object({ from: day, to: day, by: z.enum(['qty', 'revenue']) }),
  'reports.stock': none,
  'reports.cashiers': z.object({ from: day, to: day }),
  'reports.exportCsv': z.object({
    report: z.enum(['daily', 'monthly', 'profit', 'bestSellers', 'stock', 'cashiers']),
    day: day.optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    from: day.optional(),
    to: day.optional(),
    by: z.enum(['qty', 'revenue']).optional()
  }),
  'reports.cashCount': z.object({ counted: money, note: text(200).nullable().optional() }),

  'backup.status': none,
  'backup.run': none,
  'backup.copyToFolder': z.object({ useSaved: z.boolean() }),
  'backup.restore': z.object({ fromList: z.string().regex(/^TRB-[a-z]+-\d{8}-\d{6}\.db$/).nullable().optional() }),

  'log.list': z.object({ from: day, to: day, action: text(60).optional() }),

  'update.check': none,
  'update.install': none
}
