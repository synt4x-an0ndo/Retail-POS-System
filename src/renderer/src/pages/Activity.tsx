import { useState } from 'react'
import { call } from '../api'
import { Icon, type IconName } from '../icons'
import { AsyncView, EmptyState, PageHeader, SkeletonRows, useAsync } from '../ui'
import { daysAgo, todayStr } from '../util'

const LABELS: Record<string, [string, IconName, string]> = {
  login: ['Logged in', 'user', 'info'],
  logout: ['Logged out', 'lock', 'info'],
  'login.failed': ['Wrong password or PIN', 'alert', 'bad'],
  'sale.void': ['Sale cancelled', 'ban', 'bad'],
  'sale.discount': ['Discount given', 'percent', 'info'],
  'sale.approved': ['Owner approved a sale', 'shield', 'good'],
  'sale.reprint': ['Receipt reprinted', 'printer', 'info'],
  'price.change': ['Price changed', 'tag', 'info'],
  'stock.adjust': ['Stock adjusted', 'edit', 'info'],
  'stock.receive': ['Stock received', 'truck', 'good'],
  'drawer.open': ['Drawer opened manually', 'drawer', 'bad'],
  'override.failed': ['Wrong approval PIN', 'alert', 'bad'],
  'override.approved': ['Owner approved', 'shield', 'good'],
  'backup.restore': ['Backup restored', 'history', 'bad'],
  'backup.copy': ['Backup copied to drive', 'usb', 'good'],
  'backup.manual': ['Manual backup', 'database', 'good'],
  'user.create': ['Team member added', 'users', 'good'],
  'user.update': ['Team member changed', 'users', 'info'],
  'settings.update': ['Settings changed', 'settings', 'info'],
  'cash.count': ['Cash counted', 'cash', 'info'],
  'labels.print': ['Labels printed', 'printer', 'info'],
  'cart.discard': ['Cart cleared', 'trash', 'info'],
  'product.create': ['Product created', 'tag', 'good'],
  'product.update': ['Product updated', 'tag', 'info'],
  'report.export': ['Report exported', 'download', 'info'],
  'ledger.mismatch': ['Stock check found a mismatch', 'alert', 'bad'],
  error: ['Error', 'alert', 'bad']
}

const FILTERS: [string, string][] = [
  ['', 'All'],
  ['sale.', 'Sales'],
  ['override', 'Approvals'],
  ['price', 'Prices'],
  ['stock', 'Stock'],
  ['login', 'Logins'],
  ['backup', 'Backups'],
  ['drawer', 'Drawer']
]

function details(json: string | null): string {
  if (!json) return ''
  try {
    const d = JSON.parse(json)
    if (Array.isArray(d)) return d.join(', ')
    return Object.entries(d)
      .filter(([k]) => !/Id$|^id$/.test(k) && k !== 'approvedBy')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' · ')
  } catch {
    return json
  }
}

export default function Activity() {
  const [from, setFrom] = useState(daysAgo(2))
  const [to, setTo] = useState(todayStr())
  const [action, setAction] = useState('')
  const list = useAsync<any[]>(() => call('log.list', { from, to, action: action || undefined }), [from, to, action])
  return (
    <div className="page">
      <PageHeader title="Activity log" subtitle="A permanent record of sensitive actions: cancellations, approvals, price and stock changes, logins and restores." />
      <div className="card">
        <div className="toolbar">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} aria-label="From" />
          <span className="subtle">to</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} aria-label="To" />
          <div className="row" style={{ gap: 6 }}>
            {FILTERS.map(([v, l]) => (
              <button key={v} className={'pickchip' + (action === v ? ' on' : '')} onClick={() => setAction(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <AsyncView state={list} skeleton={<SkeletonRows rows={8} cols={3} />} isEmpty={(d) => d.length === 0} empty={<EmptyState icon="activity" title="No activity in this period" />}>
          {(d) => (
            <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 250px)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Time</th>
                    <th>Event</th>
                    <th>By</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((a) => {
                    const [label, icon, tone] = LABELS[a.action] ?? [a.action, 'info' as IconName, 'info']
                    return (
                      <tr key={a.id}>
                        <td className="num">{a.created_at.slice(0, 19)}</td>
                        <td>
                          <span className="row nowrap" style={{ gap: 8 }}>
                            <span className={'badge ' + (tone === 'bad' ? 'bad' : tone === 'good' ? 'good' : 'info')} style={{ width: 24, padding: 0, justifyContent: 'center' }}>
                              <Icon name={icon} size={13} />
                            </span>
                            <span className="cell-title">{label}</span>
                          </span>
                        </td>
                        <td>{a.user_name ?? 'System'}</td>
                        <td className="subtle truncate" style={{ maxWidth: 480 }} title={a.details_json ?? ''}>
                          {details(a.details_json)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AsyncView>
      </div>
    </div>
  )
}
