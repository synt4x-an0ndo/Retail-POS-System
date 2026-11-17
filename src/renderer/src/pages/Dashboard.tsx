import { call } from '../api'
import { BarChart, HBars } from '../charts'
import { Icon, type IconName } from '../icons'
import { AsyncView, Button, Delta, EmptyState, Kpi, PageHeader, Skeleton, SkeletonKpis, VariantChips, useApp, useAsync } from '../ui'
import { METHOD_LABEL, num, tk } from '../util'

const PAY_COLOR: Record<string, string> = { cash: 'var(--pay-cash)', card: 'var(--pay-card)', bkash: 'var(--pay-bkash)', nagad: 'var(--pay-nagad)' }
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Dashboard() {
  const { can, go, user } = useApp()
  const d = useAsync<any>(() => call('sales.dashboard'), [])
  const low = useAsync<any[]>(() => (can('product.view') ? call('inventory.lowStock') : Promise.resolve([])), [])
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const actions: { label: string; icon: IconName; page: string; params?: any; show: boolean; primary?: boolean }[] = [
    { label: 'New sale', icon: 'scan', page: 'pos', show: can('pos.sell'), primary: true },
    { label: 'Add product', icon: 'plus', page: 'products', params: { edit: 'new' }, show: can('product.manage') },
    { label: 'Receive stock', icon: 'truck', page: 'stock', params: { tab: 'receive' }, show: can('stock.manage') },
    { label: 'Daily report', icon: 'chart', page: 'reports', show: can('report.view') }
  ]

  return (
    <div className="page">
      <PageHeader
        eyebrow={today}
        title={`${greet}, ${user.name.split(' ')[0]}`}
        subtitle="Here's how the shop is doing today."
        actions={actions
          .filter((a) => a.show)
          .map((a) => (
            <Button key={a.label} icon={a.icon} variant={a.primary ? 'primary' : 'default'} onClick={() => go(a.page, a.params)}>
              {a.label}
            </Button>
          ))}
      />

      <AsyncView
        state={d}
        skeleton={
          <div className="stack">
            <SkeletonKpis n={4} />
            <div className="card card-pad"><Skeleton h={220} /></div>
          </div>
        }
      >
        {(x) => {
          const avg = x.sales ? x.total / x.sales : 0
          const usbAge = x.lastUsbCopy ? (Date.now() - new Date(x.lastUsbCopy.replace(' ', 'T')).getTime()) / 86400000 : Infinity
          const backupAge = x.lastBackup ? (Date.now() - new Date(x.lastBackup.replace(' ', 'T')).getTime()) / 3600000 : Infinity
          const weekTotal = x.trend.slice(-7).reduce((s: number, t: any) => s + t.total, 0)
          const mixTotal = x.byMethod.reduce((s: number, m: any) => s + m.amount, 0)
          return (
            <div className="stack" style={{ gap: 20 }}>
              {can('backup.manage') && usbAge > 3 && (
                <div className="banner warn">
                  <Icon name="usb" />
                  <span className="grow">{x.lastUsbCopy ? `The last pen-drive backup was ${Math.floor(usbAge)} days ago.` : 'No pen-drive backup has been made yet.'} Copy today's backup to keep your data safe.</span>
                  <Button size="sm" variant="primary" onClick={() => go('backup')}>
                    Back up now
                  </Button>
                </div>
              )}

              <div className="grid cols-4">
                <Kpi icon="wallet" tone="brand" label="Revenue today" value={tk(x.total)} foot={<Delta now={x.total} before={x.yesterday.total} />} />
                <Kpi icon="receipt" label="Transactions" value={num(x.sales)} foot={<Delta now={x.sales} before={x.yesterday.sales} />} />
                <Kpi icon="tag" label="Average bill" value={tk(avg)} foot={<span>{num(x.itemsSold)} items sold today</span>} />
                <Kpi
                  icon="alert"
                  tone={x.lowStockCount > 0 ? 'warn' : 'good'}
                  label="Low / out of stock"
                  value={num(x.lowStockCount)}
                  foot={<span>{num(x.catalogue.out_of_stock)} sold out · {num(x.catalogue.units)} units on hand</span>}
                  onClick={can('product.view') ? () => go('stock', { filter: 'low' }) : undefined}
                />
              </div>

              <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
                <div className="card">
                  <div className="card-head">
                    <h2>
                      Revenue · last 14 days <span className="subtle">· {tk(weekTotal)} this week</span>
                    </h2>
                  </div>
                  <div className="card-body">
                    <BarChart
                      ariaLabel="Revenue for the last 14 days"
                      highlightLast
                      data={x.trend.map((t: any) => {
                        const dt = new Date(t.day + 'T00:00')
                        return {
                          key: t.day,
                          label: t.day === x.day ? 'Today' : `${DAY[dt.getDay()]} ${dt.getDate()}`,
                          value: t.total,
                          tip: (
                            <>
                              <b>{tk(t.total)}</b>
                              {t.sales} bills · {dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </>
                          )
                        }
                      })}
                    />
                  </div>
                </div>
                <div className="card">
                  <div className="card-head">
                    <h2>Payment mix today</h2>
                  </div>
                  <div className="card-body">
                    {x.byMethod.length === 0 ? (
                      <EmptyState icon="wallet" title="No payments yet" text="Today's cash, card, bKash and Nagad totals appear here." />
                    ) : (
                      <>
                        <div style={{ display: 'flex', height: 10, borderRadius: 10, overflow: 'hidden', marginBottom: 18, gap: 2 }}>
                          {x.byMethod.map((m: any) => (
                            <span key={m.method} style={{ width: `${(m.amount / mixTotal) * 100}%`, background: PAY_COLOR[m.method] }} />
                          ))}
                        </div>
                        <HBars
                          max={mixTotal}
                          items={x.byMethod.map((m: any) => ({
                            key: m.method,
                            label: (
                              <span className="row nowrap" style={{ gap: 8 }}>
                                <span className="swatch" style={{ background: PAY_COLOR[m.method] }} />
                                {METHOD_LABEL[m.method]}
                              </span>
                            ),
                            value: m.amount,
                            display: tk(m.amount),
                            color: PAY_COLOR[m.method]
                          }))}
                        />
                        {x.discount > 0 && <p className="subtle" style={{ marginTop: 16 }}>Discounts given today: {tk(x.discount)}</p>}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid cols-3">
                <div className="card">
                  <div className="card-head">
                    <h2>Recent transactions</h2>
                    {can('sales.view') && (
                      <button className="linkbtn" onClick={() => go('sales')}>
                        View all
                      </button>
                    )}
                  </div>
                  {x.recent.length === 0 ? (
                    <EmptyState icon="receipt" title="No sales yet" text="Completed sales show up here instantly." />
                  ) : (
                    <table className="table">
                      <tbody className="rows-in">
                        {x.recent.map((r: any) => (
                          <tr key={r.id}>
                            <td>
                              <div className="cell-title mono">{r.invoice_no}</div>
                              <div className="cell-sub">
                                {r.completed_at.slice(11, 16)} · {r.cashier_name} · {(r.methods ?? '').split(',').map((m: string) => METHOD_LABEL[m] ?? m).join(' + ')}
                              </div>
                            </td>
                            <td className="r">
                              <b className="num">{tk(r.grand_total)}</b>
                              <div className="cell-sub">{r.item_count} items</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="card">
                  <div className="card-head">
                    <h2>Top products today</h2>
                  </div>
                  <div className="card-body">
                    {x.topToday.length === 0 ? (
                      <EmptyState icon="sparkle" title="Nothing sold yet" text="Your best sellers for the day will be ranked here." />
                    ) : (
                      <HBars items={x.topToday.map((p: any) => ({ key: p.product, label: p.product, value: p.qty, display: `${p.qty} pcs · ${tk(p.revenue)}` }))} />
                    )}
                  </div>
                </div>
                <div className="card">
                  <div className="card-head">
                    <h2>Low stock</h2>
                    {can('product.view') && (low.data?.length ?? 0) > 0 && (
                      <button className="linkbtn" onClick={() => go('stock', { filter: 'low' })}>
                        View all
                      </button>
                    )}
                  </div>
                  {!low.data?.length ? (
                    <EmptyState icon="check" title="Stock looks healthy" text="Every item is above its low-stock level." />
                  ) : (
                    <table className="table">
                      <tbody className="rows-in">
                        {low.data.slice(0, 6).map((v) => (
                          <tr key={v.id}>
                            <td>
                              <div className="cell-title truncate" style={{ maxWidth: 220 }}>{v.product_name}</div>
                              <div className="row" style={{ gap: 4, marginTop: 4 }}>
                                <VariantChips size={v.size_name} color={v.color_name} />
                              </div>
                            </td>
                            <td className="r">
                              <span className={'badge ' + (v.stock_qty <= 0 ? 'bad' : 'warn')}>{v.stock_qty <= 0 ? 'Sold out' : `${v.stock_qty} left`}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="card card-pad health">
                <span className={'ring ' + (backupAge < 26 ? 'good' : 'warn')}>
                  <Icon name={backupAge < 26 ? 'shield' : 'alert'} size={22} />
                </span>
                <div className="grow">
                  <h3>{backupAge < 26 ? 'Data is backed up' : 'Backup needed'}</h3>
                  <p className="subtle">
                    Last automatic backup: {x.lastBackup ?? 'not yet'} · Last pen-drive copy: {x.lastUsbCopy ?? 'never'} · {num(x.catalogue.products)} products, {num(x.catalogue.variants)} sizes/colours
                  </p>
                </div>
                {can('backup.manage') && (
                  <Button icon="database" onClick={() => go('backup')}>
                    Manage backups
                  </Button>
                )}
              </div>
            </div>
          )
        }}
      </AsyncView>
    </div>
  )
}
