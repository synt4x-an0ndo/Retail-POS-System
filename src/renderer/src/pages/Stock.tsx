import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { Icon, type IconName } from '../icons'
import {
  AsyncView,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Kpi,
  NumInput,
  PageHeader,
  SearchInput,
  Segmented,
  Sheet,
  SkeletonKpis,
  SkeletonRows,
  StockBar,
  StockPill,
  Switch,
  Tabs,
  VariantChips,
  errMsg,
  useApp,
  useAsync,
  useDebounced
} from '../ui'
import { num, tk, variantLabel } from '../util'
import { LabelPrinter } from './Products'

type Tab = 'stock' | 'receive' | 'receipts' | 'suppliers'

export default function Stock({ params }: { params?: Record<string, any> }) {
  const { can } = useApp()
  const [tab, setTab] = useState<Tab>(params?.tab ?? 'stock')
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'stock', label: 'Stock levels', icon: 'layers' },
    ...(can('stock.manage')
      ? ([
          { id: 'receive', label: 'Receive stock', icon: 'truck' },
          { id: 'receipts', label: 'Receiving history', icon: 'history' },
          { id: 'suppliers', label: 'Suppliers', icon: 'store' }
        ] as { id: Tab; label: string; icon: IconName }[])
      : [])
  ]
  return (
    <div className="page">
      <PageHeader title="Inventory" subtitle="Live stock for every size and colour, with a full history of each change." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'stock' && <StockLevels initialFilter={params?.filter === 'low' ? 'low' : 'all'} />}
      {tab === 'receive' && <Receive onDone={() => setTab('receipts')} />}
      {tab === 'receipts' && <Receipts />}
      {tab === 'suppliers' && <Suppliers />}
    </div>
  )
}

function StockLevels({ initialFilter }: { initialFilter: 'all' | 'low' }) {
  const { can } = useApp()
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>(initialFilter)
  const [adjusting, setAdjusting] = useState<any>(null)
  const [history, setHistory] = useState<any>(null)
  const list = useAsync<any[]>(() => call('inventory.stock', { search: q.trim() || undefined }), [q])
  const all = list.data ?? []
  const rows = useMemo(() => all.filter((v) => (filter === 'all' ? true : filter === 'out' ? v.stock_qty <= 0 : v.stock_qty <= v.reorder_level)), [all, filter])
  const units = all.reduce((s, v) => s + Math.max(0, v.stock_qty), 0)
  const value = all.reduce((s, v) => s + Math.max(0, v.stock_qty) * v.sell_price, 0)
  const low = all.filter((v) => v.stock_qty > 0 && v.stock_qty <= v.reorder_level).length
  const out = all.filter((v) => v.stock_qty <= 0).length

  return (
    <div className="stack" style={{ gap: 20 }}>
      {list.initial ? (
        <SkeletonKpis n={4} />
      ) : (
        <div className="grid cols-4">
          <Kpi icon="box" tone="brand" label="Units on hand" value={num(units)} foot={`${num(all.length)} sizes/colours${q ? ' matching' : ''}`} />
          <Kpi icon="wallet" label="Stock value (selling price)" value={tk(value)} />
          <Kpi icon="alert" tone={low ? 'warn' : 'good'} label="Running low" value={num(low)} onClick={() => setFilter('low')} />
          <Kpi icon="ban" tone={out ? 'bad' : 'good'} label="Sold out" value={num(out)} onClick={() => setFilter('out')} />
        </div>
      )}
      <div className="card">
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, SKU or barcode" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'low', label: 'Low & out' },
              { value: 'out', label: 'Sold out' }
            ]}
          />
          <span className="grow" />
          <span className="subtle">{rows.length} items</span>
        </div>
        <AsyncView
          state={list}
          skeleton={<SkeletonRows rows={8} cols={6} />}
          isEmpty={() => rows.length === 0}
          empty={filter !== 'all' && !q ? <EmptyState icon="check" title="Nothing here" text="No items are in this stock state right now." /> : <EmptyState icon="search" title="No items found" text="Try another name, SKU or barcode." />}
        >
          {() => (
            <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 330px)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>SKU</th>
                    <th className="r">Price</th>
                    <th>Stock</th>
                    <th className="tight" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <div className="cell-title truncate" style={{ maxWidth: 300 }}>{v.product_name}</div>
                        <div className="cell-sub">{v.category_name ?? 'No category'}</div>
                      </td>
                      <td>
                        <div className="row nowrap" style={{ gap: 4 }}>
                          <VariantChips size={v.size_name} color={v.color_name} />
                        </div>
                      </td>
                      <td>
                        <div className="mono">{v.sku}</div>
                        <div className="cell-sub mono">{v.barcode}</div>
                      </td>
                      <td className="r num">{tk(v.sell_price)}</td>
                      <td>
                        <div className="row nowrap" style={{ gap: 10 }}>
                          <StockPill qty={v.stock_qty} reorder={v.reorder_level} />
                          <StockBar qty={v.stock_qty} reorder={v.reorder_level} />
                        </div>
                      </td>
                      <td>
                        <div className="row nowrap" style={{ gap: 2 }}>
                          <IconButton icon="history" label="Stock history" onClick={() => setHistory(v)} />
                          {can('stock.manage') && <IconButton icon="edit" label="Adjust stock" onClick={() => setAdjusting(v)} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncView>
      </div>
      {adjusting && (
        <Adjust
          v={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null)
            list.reload()
          }}
        />
      )}
      {history && <History v={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

const REASONS = ['Damaged', 'Lost / stolen', 'Stock count correction', 'Returned by customer', 'Given as gift / sample', 'Other']

function Adjust({ v, onClose, onDone }: { v: any; onClose: () => void; onDone: () => void }) {
  const { notify } = useApp()
  const [dir, setDir] = useState<'remove' | 'add'>('remove')
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const change = dir === 'add' ? qty : -qty
  const after = v.stock_qty + change
  const save = async () => {
    if (qty <= 0 || after < 0) return
    setBusy(true)
    try {
      await call('inventory.adjust', { variantId: v.id, qtyChange: change, reason: note ? `${reason}: ${note}` : reason })
      notify(`Stock adjusted: ${v.product_name} ${change > 0 ? '+' : ''}${change}.`, 'good')
      onDone()
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Adjust stock"
      description={`${v.product_name} · ${variantLabel(v) || 'Standard'} · ${v.sku}`}
      icon="edit"
      onClose={onClose}
      onSubmit={save}
      footer={(close) => (
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={qty <= 0 || after < 0}>
            Save adjustment
          </Button>
        </>
      )}
    >
      <div className="stack">
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            { value: 'remove', label: 'Remove from stock' },
            { value: 'add', label: 'Add to stock' }
          ]}
        />
        <div className="grid cols-2">
          <Field label="Quantity">
            <NumInput value={qty} onChange={(n) => setQty(Math.max(0, Math.floor(n)))} autoFocus suffix="pcs" />
          </Field>
          <Field label="Reason">
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Note" optional style={{ gridColumn: 'span 2' }}>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="card card-pad row between" style={{ background: 'var(--surface-2)' }}>
          <div>
            <div className="subtle">Current</div>
            <b style={{ fontSize: 22 }}>{v.stock_qty}</b>
          </div>
          <Icon name="right" />
          <div style={{ textAlign: 'right' }}>
            <div className="subtle">After</div>
            <b style={{ fontSize: 22, color: after < 0 ? 'var(--danger-600)' : change > 0 ? 'var(--success-700)' : 'var(--text)' }}>{after}</b>
          </div>
        </div>
        {after < 0 && <div className="banner bad"><Icon name="alert" /> Only {v.stock_qty} in stock.</div>}
        <p className="subtle">Bought new stock? Use "Receive stock" so the supplier and cost are recorded.</p>
      </div>
    </Dialog>
  )
}

const MOVE: Record<string, { label: string; tone: string; icon: IconName }> = {
  opening: { label: 'Opening stock', tone: 'info', icon: 'box' },
  purchase: { label: 'Received', tone: 'good', icon: 'truck' },
  sale: { label: 'Sold', tone: 'bad', icon: 'receipt' },
  void: { label: 'Sale cancelled · returned', tone: 'good', icon: 'refresh' },
  adjustment: { label: 'Adjustment', tone: 'info', icon: 'edit' }
}

function History({ v, onClose }: { v: any; onClose: () => void }) {
  const rows = useAsync<any[]>(() => call('inventory.movements', { variantId: v.id }), [v.id])
  return (
    <Sheet title="Stock history" description={`${v.product_name} · ${variantLabel(v) || 'Standard'} · now ${v.stock_qty} in stock`} onClose={onClose}>
      <AsyncView state={rows} isEmpty={(d) => d.length === 0} empty={<EmptyState icon="history" title="No movements yet" />} skeleton={<SkeletonRows rows={6} cols={2} />}>
        {(d) => (
          <div className="timeline">
            {d.map((m, i) => {
              const t = MOVE[m.type] ?? { label: m.type, tone: 'info', icon: 'info' as IconName }
              return (
                <div key={m.id} className="tl-item" style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}>
                  <span className={'dot ' + t.tone}>
                    <Icon name={t.icon} size={11} stroke={2.4} />
                  </span>
                  <div className="row between nowrap">
                    <b>{t.label}</b>
                    <b className="num" style={{ color: m.qty_change < 0 ? 'var(--danger-600)' : 'var(--success-700)' }}>
                      {m.qty_change > 0 ? '+' : ''}
                      {m.qty_change}
                    </b>
                  </div>
                  <div className="subtle">
                    {m.created_at.slice(0, 16)} · {m.user_name ?? 'System'}
                    {(m.invoice_no || m.reason) && ` · ${m.invoice_no ?? m.reason}`}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </AsyncView>
    </Sheet>
  )
}

interface RecLine {
  variantId: string
  label: string
  size: string | null
  color: string | null
  sku: string
  barcode: string
  price: number
  qty: number
  unitCost: number
}

function Receive({ onDone }: { onDone: () => void }) {
  const { notify } = useApp()
  const suppliers = useAsync<any[]>(() => call('inventory.suppliers'), [])
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [updateCost, setUpdateCost] = useState(true)
  const [lines, setLines] = useState<RecLine[]>([])
  const [q, setQ] = useState('')
  const [found, setFound] = useState<any[]>([])
  const [labels, setLabels] = useState<any[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) return setFound([])
    const t = setTimeout(() => call<any[]>('catalog.searchVariants', { text: q.trim() }).then(setFound).catch(() => undefined), 220)
    return () => clearTimeout(t)
  }, [q])

  const add = (v: any) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { variantId: v.id, label: v.product_name, size: v.size_name, color: v.color_name, sku: v.sku, barcode: v.barcode, price: v.sell_price, qty: 1, unitCost: v.cost_price ?? 0 }]
    })
    setQ('')
    setFound([])
  }

  const onKey = async (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !q.trim()) return
    const v = await call('catalog.findBarcode', { code: q.trim() })
    if (v) add(v)
    else if (found[0]) add(found[0])
    else notify(`Nothing found for "${q.trim()}".`, 'bad')
  }

  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
  const pieces = lines.reduce((s, l) => s + l.qty, 0)

  const save = async () => {
    setBusy(true)
    try {
      await call('inventory.receive', {
        supplierId: supplierId || null,
        supplierInvoiceNo: invoiceNo.trim() || null,
        note: note.trim() || null,
        updateCost,
        items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitCost: l.unitCost }))
      })
      notify(`Stock received: ${pieces} pieces. Print their labels next.`, 'good')
      setLabels(lines.map((l) => ({ variant_id: l.variantId, qty: l.qty, label: `${l.label} – ${[l.size, l.color].filter(Boolean).join(' / ') || 'Standard'}`, barcode: l.barcode, price: l.price })))
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
      <div className="card">
        <div className="card-body" style={{ position: 'relative', paddingBottom: 12 }}>
          <div className="scan-box" style={{ height: 52 }}>
            <Icon name="scan" size={22} />
            <input placeholder="Scan a barcode or search the item you received" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoFocus aria-label="Scan or search" />
          </div>
          {found.length > 0 && (
            <div className="results" style={{ top: 78, left: 20, right: 20 }}>
              {found.map((v) => (
                <div key={v.id} className="result" onMouseDown={() => add(v)}>
                  <div className="grow">
                    <div className="cell-title">{v.product_name}</div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <VariantChips size={v.size_name} color={v.color_name} />
                      <span className="subtle mono">{v.sku}</span>
                    </div>
                  </div>
                  <span className="subtle">stock {v.stock_qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!lines.length ? (
          <EmptyState icon="truck" title="Add the items you received" text="Scan each tag or search by name. New styles are created in Products first." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit cost</th>
                <th className="r">Line total</th>
                <th className="tight" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.variantId}>
                  <td>
                    <div className="cell-title">{l.label}</div>
                    <div className="row" style={{ gap: 4, marginTop: 4 }}>
                      <VariantChips size={l.size} color={l.color} />
                      <span className="subtle mono">{l.sku}</span>
                    </div>
                  </td>
                  <td>
                    <NumInput value={l.qty} onChange={(n) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.floor(n)) } : x)))} style={{ width: 80 }} />
                  </td>
                  <td>
                    <NumInput value={l.unitCost} onChange={(n) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: n } : x)))} prefix="৳" style={{ width: 130 }} />
                  </td>
                  <td className="r num">{tk(l.qty * l.unitCost)}</td>
                  <td>
                    <IconButton icon="trash" label="Remove" danger onClick={() => setLines(lines.filter((_, j) => j !== i))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card card-pad stack">
        <h2>Receipt details</h2>
        <Field label="Supplier" optional>
          <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">No supplier</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier invoice no." optional>
          <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        </Field>
        <Field label="Note" optional>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Switch checked={updateCost} onChange={setUpdateCost} label="Update cost price to these costs" />
        <div className="summary" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div className="line">
            <span>Pieces</span>
            <b className="num">{num(pieces)}</b>
          </div>
          <div className="line">
            <span>Total cost</span>
            <b className="num">{tk(total)}</b>
          </div>
        </div>
        <Button variant="primary" size="lg" block icon="check" loading={busy} disabled={!lines.length} onClick={save}>
          Save & print labels
        </Button>
      </div>
      {labels && (
        <LabelPrinter
          purchaseItems={labels}
          onClose={() => {
            setLabels(null)
            setLines([])
            setInvoiceNo('')
            setNote('')
            onDone()
          }}
        />
      )}
    </div>
  )
}

function Receipts() {
  const list = useAsync<any[]>(() => call('inventory.purchases'), [])
  const [open, setOpen] = useState<string | null>(null)
  const [labels, setLabels] = useState<any[] | null>(null)
  return (
    <div className="card">
      <AsyncView state={list} isEmpty={(d) => d.length === 0} empty={<EmptyState icon="truck" title="No stock received yet" text="Every delivery you record appears here, with its supplier and cost." />}>
        {(d) => (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Invoice</th>
                <th className="r">Pieces</th>
                <th className="r">Cost</th>
                <th>Received by</th>
              </tr>
            </thead>
            <tbody className="rows-in">
              {d.map((p) => (
                <tr key={p.id} className="click" onClick={() => setOpen(p.id)}>
                  <td>{p.received_at.slice(0, 16)}</td>
                  <td className="cell-title">{p.supplier_name ?? '—'}</td>
                  <td className="mono">{p.supplier_invoice_no ?? ''}</td>
                  <td className="r num">{p.total_qty}</td>
                  <td className="r num">{tk(p.total_cost)}</td>
                  <td className="muted">{p.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AsyncView>
      {open && <ReceiptDetail id={open} onClose={() => setOpen(null)} onLabels={(l) => (setOpen(null), setLabels(l))} />}
      {labels && <LabelPrinter purchaseItems={labels} onClose={() => setLabels(null)} />}
    </div>
  )
}

function ReceiptDetail({ id, onClose, onLabels }: { id: string; onClose: () => void; onLabels: (l: any[]) => void }) {
  const r = useAsync<any>(() => call('inventory.purchase', { id }), [id])
  const d = r.data
  return (
    <Sheet
      title="Stock receipt"
      description={d ? `${d.received_at.slice(0, 16)} · ${d.supplier_name ?? 'No supplier'}${d.supplier_invoice_no ? ' · invoice ' + d.supplier_invoice_no : ''}` : undefined}
      onClose={onClose}
      footer={
        d && (
          <Button variant="primary" icon="printer" onClick={() => onLabels(d.items.map((it: any) => ({ variant_id: it.variant_id, qty: it.qty, label: `${it.product_name} – ${variantLabel(it) || 'Standard'}`, barcode: it.barcode })))}>
            Print labels for these items
          </Button>
        )
      }
    >
      <AsyncView state={r}>
        {(d) => (
          <div className="stack">
            <p className="subtle">Received by {d.user_name}{d.note ? ` · ${d.note}` : ''}</p>
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="r">Qty</th>
                    <th className="r">Unit cost</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it: any) => (
                    <tr key={it.id}>
                      <td>
                        <div className="cell-title">{it.product_name}</div>
                        <div className="row" style={{ gap: 4, marginTop: 4 }}>
                          <VariantChips size={it.size_name} color={it.color_name} />
                        </div>
                      </td>
                      <td className="r num">{it.qty}</td>
                      <td className="r num">{tk(it.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="r num">{d.items.reduce((s: number, i: any) => s + i.qty, 0)}</td>
                    <td className="r num">{tk(d.total_cost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </AsyncView>
    </Sheet>
  )
}

function Suppliers() {
  const { notify } = useApp()
  const list = useAsync<any[]>(() => call('inventory.suppliers'), [])
  const [edit, setEdit] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!edit.name?.trim()) return
    setBusy(true)
    try {
      await call('inventory.saveSupplier', { id: edit.id ?? null, name: edit.name.trim(), phone: edit.phone || null, address: edit.address || null })
      notify('Supplier saved.', 'good')
      setEdit(null)
      list.reload()
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2>Suppliers</h2>
        <Button size="sm" variant="primary" icon="plus" onClick={() => setEdit({ name: '', phone: '', address: '' })}>
          Add supplier
        </Button>
      </div>
      <AsyncView state={list} isEmpty={(d) => d.length === 0} empty={<EmptyState icon="store" title="No suppliers yet" text="Add the wholesalers and factories you buy from." />}>
        {(d) => (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody className="rows-in">
              {d.map((s) => (
                <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                  <td className="cell-title">{s.name}</td>
                  <td>{s.phone}</td>
                  <td className="muted">{s.address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AsyncView>
      {edit && (
        <Dialog
          title={edit.id ? 'Edit supplier' : 'New supplier'}
          icon="store"
          onClose={() => setEdit(null)}
          onSubmit={save}
          footer={(close) => (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={busy} disabled={!edit.name?.trim()}>
                Save supplier
              </Button>
            </>
          )}
        >
          <div className="stack">
            <Field label="Name">
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Phone" optional>
              <input className="input" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            <Field label="Address" optional>
              <input className="input" value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
          </div>
        </Dialog>
      )}
    </div>
  )
}
