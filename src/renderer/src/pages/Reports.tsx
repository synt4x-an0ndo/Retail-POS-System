import { useState } from 'react'
import { call } from '../api'
import { BarChart, HBars } from '../charts'
import { Icon } from '../icons'
import { AsyncView, Button, EmptyState, Kpi, NumInput, PageHeader, SkeletonKpis, SkeletonRows, Tabs, errMsg, useApp, useAsync } from '../ui'
import { METHOD_LABEL, daysAgo, monthStr, num, tk, todayStr } from '../util'
import { DateRange, rangeFor } from './Sales'

type Tab = 'daily' | 'monthly' | 'profit' | 'bestSellers' | 'stock' | 'cashiers'

interface Table {
  title: string
  columns: { key: string; label: string; money?: boolean }[]
  rows: Record<string, any>[]
  totals?: Record<string, any>
}

const PAY_COLOR: Record<string, string> = { cash: 'var(--pay-cash)', card: 'var(--pay-card)', bkash: 'var(--pay-bkash)', nagad: 'var(--pay-nagad)' }
const shortDay = (d: string) => {
  const dt = new Date(d + 'T00:00')
  return `${dt.getDate()} ${dt.toLocaleDateString('en-GB', { month: 'short' })}`
}

export function DataTable({ t, maxHeight }: { t: Table; maxHeight?: string }) {
  const cell = (c: Table['columns'][number], v: any) => {
    if (c.key === 'methods') return String(v ?? '').split(',').filter(Boolean).map((m) => METHOD_LABEL[m] ?? m).join(' + ')
    if (c.key === 'status') return <span className={'badge ' + (v === 'Out' ? 'bad' : v === 'Low' ? 'warn' : 'good')}>{v}</span>
    return c.money ? tk(v) : typeof v === 'number' ? num(v) : (v ?? '')
  }
  if (!t.rows.length) return <EmptyState icon="chart" title="No data for this period" text="Try a different date range." />
  return (
    <div className="table-wrap" style={{ maxHeight: maxHeight ?? 'calc(100vh - 360px)' }}>
      <table className="table">
        <thead>
          <tr>
            {t.columns.map((c) => (
              <th key={c.key} className={c.money ? 'r' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {t.columns.map((c, j) => (
                <td key={c.key} className={(c.money ? 'r num' : typeof r[c.key] === 'number' ? 'num' : '') + (j === 0 ? ' cell-title' : '')}>
                  {cell(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {t.totals && (
          <tfoot>
            <tr>
              {t.columns.map((c) => (
                <td key={c.key} className={c.money ? 'r num' : 'num'}>
                  {t.totals![c.key] !== undefined ? (c.money ? tk(t.totals![c.key]) : typeof t.totals![c.key] === 'number' ? num(t.totals![c.key]) : t.totals![c.key]) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export default function Reports() {
  const { can, notify } = useApp()
  const [tab, setTab] = useState<Tab>('daily')
  const [day, setDay] = useState(todayStr())
  const [month, setMonth] = useState(monthStr())
  const [preset, setPreset] = useState<'today' | '7d' | '30d' | 'month' | 'custom'>('month')
  const [custom, setCustom] = useState({ from: daysAgo(29), to: todayStr() })
  const [by, setBy] = useState<'qty' | 'revenue'>('qty')
  const [exporting, setExporting] = useState(false)
  const { from, to } = rangeFor(preset, custom)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const r: any = await call('reports.exportCsv', { report: tab, day, month, from, to, by })
      if (r) notify(`Saved for Excel: ${r.path}`, 'good')
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setExporting(false)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'daily', label: 'Daily' },
    { id: 'monthly', label: 'Monthly' },
    ...(can('report.profit') ? [{ id: 'profit' as Tab, label: 'Profit' }] : []),
    { id: 'bestSellers', label: 'Best sellers' },
    { id: 'stock', label: 'Stock' },
    { id: 'cashiers', label: 'Cashiers' }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle="Sales, profit and stock, ready to print or open in Excel."
        actions={
          <Button icon="download" onClick={exportCsv} loading={exporting}>
            Export to Excel
          </Button>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="row" style={{ marginBottom: 16 }}>
        {tab === 'daily' && <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 170 }} aria-label="Date" />}
        {tab === 'monthly' && <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 170 }} aria-label="Month" />}
        {['profit', 'bestSellers', 'cashiers'].includes(tab) && <DateRange preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />}
        {tab === 'bestSellers' && (
          <select className="select" value={by} onChange={(e) => setBy(e.target.value as any)} style={{ width: 190 }} aria-label="Rank by">
            <option value="qty">Rank by quantity</option>
            <option value="revenue">Rank by revenue</option>
          </select>
        )}
      </div>
      {tab === 'daily' && <Daily day={day} />}
      {tab === 'monthly' && <Monthly month={month} />}
      {tab === 'profit' && <Profit from={from} to={to} />}
      {tab === 'bestSellers' && <Best from={from} to={to} by={by} />}
      {tab === 'stock' && <StockReport />}
      {tab === 'cashiers' && <Cashiers from={from} to={to} />}
    </div>
  )
}

function Daily({ day }: { day: string }) {
  const { notify, can } = useApp()
  const r = useAsync<any>(() => call('reports.daily', { day }), [day])
  const [counted, setCounted] = useState(0)
  const [busy, setBusy] = useState(false)
  const saveCount = async () => {
    setBusy(true)
    try {
      const x: any = await call('reports.cashCount', { counted })
      notify(x.difference === 0 ? 'Cash matches the system.' : `Cash ${x.difference > 0 ? 'over' : 'short'} by ${tk(Math.abs(x.difference))}.`, x.difference === 0 ? 'good' : 'bad')
      r.reload()
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AsyncView state={r} skeleton={<SkeletonKpis n={4} />}>
      {(d) => {
        const mix = d.byMethod.reduce((s: number, m: any) => s + m.amount, 0)
        const diff = d.cashCount ? d.cashCount.counted - d.cashCount.expected : 0
        return (
          <div className="stack" style={{ gap: 20 }}>
            <div className={'grid ' + (d.profit !== null ? 'cols-4' : 'cols-3')}>
              <Kpi icon="wallet" tone="brand" label="Net sales" value={tk(d.total)} foot={`Gross ${tk(d.subtotal)}`} />
              <Kpi icon="receipt" label="Bills · items" value={`${num(d.sales)} · ${num(d.itemsSold)}`} foot={d.voids.n ? `${d.voids.n} cancelled (${tk(d.voids.amount)})` : 'No cancellations'} />
              <Kpi icon="percent" label="Discounts" value={tk(d.discount)} />
              {d.profit !== null && <Kpi icon="chart" tone="good" label="Profit" value={tk(d.profit)} foot={d.total ? `${((d.profit / d.total) * 100).toFixed(0)}% margin` : undefined} />}
            </div>
            <div className="grid cols-2">
              <div className="card">
                <div className="card-head">
                  <h2>By payment method</h2>
                </div>
                <div className="card-body">
                  {d.byMethod.length === 0 ? (
                    <EmptyState icon="wallet" title="No payments on this day" />
                  ) : (
                    <HBars
                      max={mix}
                      items={d.byMethod.map((m: any) => ({
                        key: m.method,
                        label: `${METHOD_LABEL[m.method]} · ${m.sales} bill${m.sales === 1 ? '' : 's'}`,
                        value: m.amount,
                        display: tk(m.amount),
                        color: PAY_COLOR[m.method]
                      }))}
                    />
                  )}
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <h2>End-of-day cash count</h2>
                </div>
                <div className="card-body stack">
                  <div className="row between">
                    <span className="muted">Cash expected in drawer</span>
                    <b className="num" style={{ fontSize: 22 }}>{tk(d.expectedCash)}</b>
                  </div>
                  <p className="subtle">Plus your opening float. Count the notes, enter the total, and the difference is recorded.</p>
                  {d.cashCount && (
                    <div className={'banner ' + (Math.abs(diff) < 0.01 ? 'good' : 'warn')}>
                      <Icon name={Math.abs(diff) < 0.01 ? 'check' : 'alert'} />
                      Counted {tk(d.cashCount.counted)} at {d.cashCount.created_at.slice(11, 16)} · {Math.abs(diff) < 0.01 ? 'matches' : `${diff > 0 ? 'over' : 'short'} by ${tk(Math.abs(diff))}`}
                    </div>
                  )}
                  {day === todayStr() && can('pos.sell') && (
                    <div className="row nowrap">
                      <NumInput value={counted} onChange={setCounted} prefix="৳" style={{ flex: 1 }} ariaLabel="Counted cash" onEnter={saveCount} />
                      <Button variant="primary" onClick={saveCount} loading={busy}>
                        Record count
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Sales on {d.day}</h2>
              </div>
              <DataTable t={d.table} />
            </div>
          </div>
        )
      }}
    </AsyncView>
  )
}

function Monthly({ month }: { month: string }) {
  const r = useAsync<Table>(() => call('reports.monthly', { month }), [month])
  return (
    <AsyncView state={r} skeleton={<SkeletonRows />}>
      {(t) => (
        <div className="stack" style={{ gap: 20 }}>
          {t.totals && (
            <div className="grid cols-3">
              <Kpi icon="wallet" tone="brand" label="Month total" value={tk(t.totals.total)} />
              <Kpi icon="receipt" label="Sales" value={num(t.totals.sales)} foot={t.rows.length ? `${tk(t.totals.total / t.rows.length)} per trading day` : undefined} />
              {t.totals.profit !== undefined ? <Kpi icon="chart" tone="good" label="Profit" value={tk(t.totals.profit)} /> : <Kpi icon="percent" label="Discounts" value={tk(t.totals.discount)} />}
            </div>
          )}
          {t.rows.length > 0 && (
            <div className="card card-pad">
              <BarChart ariaLabel="Daily sales this month" data={t.rows.map((r) => ({ key: r.day, label: String(Number(r.day.slice(8))), value: r.total, tip: (<><b>{tk(r.total)}</b>{r.sales} sales · {shortDay(r.day)}</>) }))} />
            </div>
          )}
          <div className="card">
            <DataTable t={t} />
          </div>
        </div>
      )}
    </AsyncView>
  )
}

function Profit({ from, to }: { from: string; to: string }) {
  const r = useAsync<Table>(() => call('reports.profit', { from, to }), [from, to])
  return (
    <AsyncView state={r} skeleton={<SkeletonKpis n={4} />}>
      {(t) => (
        <div className="stack" style={{ gap: 20 }}>
          <div className="grid cols-4">
            <Kpi icon="wallet" tone="brand" label="Net sales" value={tk(t.totals!.revenue)} />
            <Kpi icon="box" label="Cost of goods" value={tk(t.totals!.cost)} />
            <Kpi icon="chart" tone="good" label="Gross profit" value={tk(t.totals!.profit)} />
            <Kpi icon="percent" label="Margin" value={t.totals!.margin} foot={`Discounts ${tk(t.totals!.discount)}`} />
          </div>
          {t.rows.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h2>Revenue vs profit</h2>
                <div className="legend">
                  <span><i style={{ background: 'var(--brand-500)' }} />Net sales</span>
                  <span><i style={{ background: 'var(--success-600)' }} />Profit</span>
                </div>
              </div>
              <div className="card-body">
                <BarChart ariaLabel="Revenue and profit by day" data={t.rows.map((r) => ({ key: r.day, label: shortDay(r.day), value: r.revenue, value2: r.profit, tip: (<><b>{tk(r.revenue)}</b>profit {tk(r.profit)} · {r.margin}</>) }))} />
              </div>
            </div>
          )}
          <div className="card">
            <DataTable t={t} />
          </div>
        </div>
      )}
    </AsyncView>
  )
}

function Best({ from, to, by }: { from: string; to: string; by: 'qty' | 'revenue' }) {
  const r = useAsync<any>(() => call('reports.bestSellers', { from, to, by }), [from, to, by])
  return (
    <AsyncView state={r} skeleton={<SkeletonRows />}>
      {(d) =>
        d.table.rows.length === 0 ? (
          <div className="card"><EmptyState icon="sparkle" title="No sales in this period" /></div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', alignItems: 'start' }}>
            <div className="card">
              <div className="card-head">
                <h2>Top products by {by === 'qty' ? 'quantity' : 'revenue'}</h2>
              </div>
              <div className="card-body">
                <HBars items={d.table.rows.slice(0, 10).map((p: any) => ({ key: p.product, label: `${p.rank}. ${p.product}`, value: by === 'qty' ? p.qty : p.revenue, display: by === 'qty' ? `${p.qty} pcs` : tk(p.revenue) }))} />
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Top sizes & colours</h2>
              </div>
              <table className="table">
                <tbody className="rows-in">
                  {d.topVariants.map((v: any) => (
                    <tr key={v.sku}>
                      <td>
                        <div className="cell-title">{v.item}</div>
                        <div className="cell-sub mono">{v.sku}</div>
                      </td>
                      <td className="r">
                        <b className="num">{v.qty}</b> <span className="subtle">pcs</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card" style={{ gridColumn: 'span 2' }}>
              <DataTable t={d.table} maxHeight="none" />
            </div>
          </div>
        )
      }
    </AsyncView>
  )
}

function StockReport() {
  const r = useAsync<Table>(() => call('reports.stock'), [])
  return (
    <AsyncView state={r} skeleton={<SkeletonRows />}>
      {(t) => (
        <div className="stack" style={{ gap: 20 }}>
          <div className="grid cols-4">
            <Kpi icon="box" tone="brand" label="Units in stock" value={num(t.totals!.qty)} />
            <Kpi icon="wallet" label="Value at selling price" value={tk(t.totals!.retail_value)} />
            {t.totals!.cost_value !== undefined ? <Kpi icon="tag" label="Value at cost" value={tk(t.totals!.cost_value)} /> : <span />}
            <Kpi icon="alert" tone="warn" label="Low or sold out" value={num(t.rows.filter((r) => r.status !== 'OK').length)} />
          </div>
          <div className="card">
            <DataTable t={t} />
          </div>
        </div>
      )}
    </AsyncView>
  )
}

function Cashiers({ from, to }: { from: string; to: string }) {
  const r = useAsync<Table>(() => call('reports.cashiers', { from, to }), [from, to])
  return (
    <AsyncView state={r} skeleton={<SkeletonRows />}>
      {(t) =>
        t.rows.length === 0 ? (
          <div className="card"><EmptyState icon="users" title="No sales in this period" /></div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', alignItems: 'start' }}>
            <div className="card">
              <div className="card-head">
                <h2>Sales by cashier</h2>
              </div>
              <div className="card-body">
                <HBars items={t.rows.map((c) => ({ key: c.cashier, label: `${c.cashier} · ${c.sales} sales`, value: c.total, display: tk(c.total) }))} />
              </div>
            </div>
            <div className="card">
              <DataTable t={t} />
            </div>
          </div>
        )
      }
    </AsyncView>
  )
}
