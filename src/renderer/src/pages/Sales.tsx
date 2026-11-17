import { useState } from 'react'
import { call } from '../api'
import { Icon } from '../icons'
import { AsyncView, Button, Dialog, EmptyState, Field, PageHeader, ReceiptPreview, SearchInput, Segmented, Sheet, SkeletonRows, errMsg, useApp, useAsync, useDebounced, useGuarded } from '../ui'
import { METHOD_LABEL, daysAgo, firstOfMonth, num, tk, todayStr } from '../util'

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom'

export function rangeFor(p: Preset, custom: { from: string; to: string }) {
  if (p === 'today') return { from: todayStr(), to: todayStr() }
  if (p === '7d') return { from: daysAgo(6), to: todayStr() }
  if (p === '30d') return { from: daysAgo(29), to: todayStr() }
  if (p === 'month') return { from: firstOfMonth(), to: todayStr() }
  return custom
}

export function DateRange(props: { preset: Preset; onPreset: (p: Preset) => void; custom: { from: string; to: string }; onCustom: (c: { from: string; to: string }) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Segmented
        value={props.preset}
        onChange={props.onPreset}
        options={[
          { value: 'today', label: 'Today' },
          { value: '7d', label: '7 days' },
          { value: '30d', label: '30 days' },
          { value: 'month', label: 'This month' },
          { value: 'custom', label: 'Custom' }
        ]}
      />
      {props.preset === 'custom' && (
        <>
          <input className="input" type="date" value={props.custom.from} onChange={(e) => props.onCustom({ ...props.custom, from: e.target.value })} style={{ width: 150 }} aria-label="From" />
          <span className="subtle">to</span>
          <input className="input" type="date" value={props.custom.to} onChange={(e) => props.onCustom({ ...props.custom, to: e.target.value })} style={{ width: 150 }} aria-label="To" />
        </>
      )}
    </div>
  )
}

export default function Sales() {
  const [preset, setPreset] = useState<Preset>('7d')
  const [custom, setCustom] = useState({ from: daysAgo(6), to: todayStr() })
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [status, setStatus] = useState<'' | 'completed' | 'voided'>('')
  const [open, setOpen] = useState<string | null>(null)
  const { from, to } = rangeFor(preset, custom)
  const list = useAsync<any[]>(() => call('sales.list', { from, to, search: q.trim() || undefined, status: status || null }), [from, to, q, status])
  const done = (list.data ?? []).filter((s) => s.status === 'completed')
  const total = done.reduce((a, s) => a + s.grand_total, 0)

  return (
    <div className="page">
      <PageHeader title="Transactions" subtitle="Every completed and cancelled sale, with its receipt." />
      <div className="card">
        <div className="toolbar">
          <DateRange preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
          <SearchInput value={search} onChange={setSearch} placeholder="Invoice no. or transaction ID" style={{ width: 260 }} />
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ width: 150 }} aria-label="Status">
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="voided">Cancelled</option>
          </select>
          <span className="grow" />
          <div style={{ textAlign: 'right' }}>
            <div className="subtle">{num(done.length)} sales</div>
            <b className="num" style={{ fontSize: 18 }}>{tk(total)}</b>
          </div>
        </div>
        <AsyncView
          state={list}
          skeleton={<SkeletonRows rows={8} cols={6} />}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon="receipt" title="No transactions in this period" text="Pick a wider date range, or clear the search." />}
        >
          {(d) => (
            <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 230px)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date & time</th>
                    <th>Cashier</th>
                    <th className="r">Items</th>
                    <th>Paid by</th>
                    <th className="r">Discount</th>
                    <th className="r">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody className="rows-in">
                  {d.map((s) => (
                    <tr key={s.id} className="click" onClick={() => setOpen(s.id)}>
                      <td className="mono cell-title">{s.invoice_no}</td>
                      <td>{s.completed_at.slice(0, 16)}</td>
                      <td>{s.cashier_name}</td>
                      <td className="r num">{s.item_count}</td>
                      <td>{(s.methods ?? '').split(',').filter(Boolean).map((m: string) => METHOD_LABEL[m] ?? m).join(' + ')}</td>
                      <td className="r num" style={{ color: s.discount_total > 0 ? 'var(--danger-600)' : undefined }}>{s.discount_total > 0 ? '−' + tk(s.discount_total) : '—'}</td>
                      <td className="r">
                        <b className="num" style={{ textDecoration: s.status === 'voided' ? 'line-through' : undefined }}>{tk(s.grand_total)}</b>
                      </td>
                      <td>{s.status === 'voided' ? <span className="badge bad"><span className="dot" />Cancelled</span> : <span className="badge good"><span className="dot" />Paid</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncView>
      </div>
      {open && <SaleDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  )
}

function SaleDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { notify } = useApp()
  const guarded = useGuarded()
  const sale = useAsync<any>(() => call('sales.get', { id }), [id])
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<false | 'print' | 'void'>(false)
  const [previewKey, setPreviewKey] = useState(0)
  const s = sale.data

  const reprint = async () => {
    setBusy('print')
    try {
      await call('sales.reprint', { id })
      notify('Receipt printed.', 'good')
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  const doVoid = async () => {
    if (reason.trim().length < 3) return
    setBusy('void')
    const r = await guarded((pin) => call('sales.void', { saleId: id, reason: reason.trim(), overridePin: pin }))
    setBusy(false)
    if (r) {
      notify(`Sale ${s.invoice_no} cancelled. Items returned to stock.`, 'good')
      setVoiding(false)
      sale.reload()
      setPreviewKey((k) => k + 1)
      onChanged()
    }
  }

  return (
    <Sheet
      wide
      title={s ? s.invoice_no : 'Invoice'}
      description={s ? `${s.completed_at.slice(0, 16)} · ${s.cashier_name}${s.approved_by_name ? ' · approved by ' + s.approved_by_name : ''}` : undefined}
      onClose={onClose}
      headerExtra={s && (s.status === 'voided' ? <span className="badge bad">Cancelled</span> : <span className="badge good">Paid</span>)}
      footer={
        s && (
          <>
            {s.status === 'completed' && (
              <Button variant="danger" icon="ban" onClick={() => setVoiding(true)} style={{ marginRight: 'auto' }}>
                Cancel sale
              </Button>
            )}
            <Button variant="primary" icon="printer" onClick={reprint} loading={busy === 'print'}>
              Reprint receipt
            </Button>
          </>
        )
      }
    >
      <AsyncView state={sale} skeleton={<SkeletonRows rows={5} cols={3} />}>
        {(s) => (
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 24, alignItems: 'start' }}>
            <div className="stack">
              {s.status === 'voided' && (
                <div className="banner bad">
                  <Icon name="ban" />
                  <span>
                    Cancelled {s.voided_at?.slice(0, 16)} by {s.voided_by_name}: {s.void_reason}
                  </span>
                </div>
              )}
              <div className="card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="r">Qty</th>
                      <th className="r">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.items.map((it: any) => (
                      <tr key={it.id}>
                        <td>
                          <div className="cell-title">{it.description}</div>
                          <div className="cell-sub">
                            <span className="mono">{it.sku}</span> · {tk(it.unit_price)}
                            {it.line_discount > 0 && <span style={{ color: 'var(--danger-600)' }}> · −{tk(it.line_discount)}</span>}
                          </div>
                        </td>
                        <td className="r num">{it.qty}</td>
                        <td className="r num">{tk(it.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card card-pad summary">
                <div className="line">
                  <span>Subtotal</span>
                  <b className="num">{tk(s.subtotal)}</b>
                </div>
                {s.discount_total > 0 && (
                  <div className="line">
                    <span>Discounts</span>
                    <b className="num" style={{ color: 'var(--danger-600)' }}>−{tk(s.discount_total)}</b>
                  </div>
                )}
                {s.payments.map((p: any) => (
                  <div className="line" key={p.id}>
                    <span>
                      {METHOD_LABEL[p.method]}
                      {p.reference && <span className="subtle mono"> · {p.reference}</span>}
                      {p.method === 'cash' && p.tendered ? <span className="subtle"> · received {tk(p.tendered)}, change {tk(p.change_given)}</span> : null}
                    </span>
                    <b className="num">{tk(p.amount)}</b>
                  </div>
                ))}
                <div className="total">
                  <span>Total</span>
                  <b className="num" style={{ fontSize: 26 }}>{tk(s.grand_total)}</b>
                </div>
              </div>
            </div>
            <div>
              <div className="section-title">Receipt</div>
              <ReceiptPreview key={previewKey} saleId={id} zoom={1} />
            </div>
          </div>
        )}
      </AsyncView>
      {voiding && s && (
        <Dialog
          title="Cancel this sale?"
          description={`Items go back into stock and ${s.invoice_no} is marked cancelled. Refund ${tk(s.grand_total)} to the customer.`}
          icon="alert"
          tone="danger"
          onClose={() => setVoiding(false)}
          onSubmit={doVoid}
          footer={(close) => (
            <>
              <Button variant="ghost" onClick={close}>
                Keep sale
              </Button>
              <Button variant="danger-solid" type="submit" loading={busy === 'void'} disabled={reason.trim().length < 3}>
                Cancel sale
              </Button>
            </>
          )}
        >
          <Field label="Reason" hint="Required. The owner's PIN is needed if you are not the owner.">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Customer returned, wrong size" />
          </Field>
        </Dialog>
      )}
    </Sheet>
  )
}
