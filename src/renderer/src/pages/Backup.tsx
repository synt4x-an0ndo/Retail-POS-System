import { useState } from 'react'
import { call } from '../api'
import { Icon } from '../icons'
import { AsyncView, Button, EmptyState, PageHeader, SkeletonRows, errMsg, useApp, useAsync } from '../ui'

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`)
const KIND: Record<string, string> = { hourly: 'Hourly', daily: 'Daily', manual: 'Manual', safety: 'Safety copy', usb: 'Pen drive' }

export default function Backup() {
  const { notify, settings, reloadSettings } = useApp()
  const st = useAsync<any>(() => call('backup.status'), [])
  const [busy, setBusy] = useState<string | false>(false)
  // Restores are confirmed by the main process, which shows what the backup contains before replacing anything.
  const restore = (target: string | null) => act('restore', () => call('backup.restore', target ? { fromList: target } : {}), () => 'Restoring… the POS will restart.')

  const act = async (key: string, fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(key)
    try {
      const r = await fn()
      if (r) notify(ok(r), 'good')
      st.reload()
      await reloadSettings()
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  const usbAge = settings.last_usb_copy ? (Date.now() - new Date(settings.last_usb_copy.replace(' ', 'T')).getTime()) / 86400000 : Infinity
  const healthy = usbAge <= 3

  return (
    <div className="page">
      <PageHeader title="Backup & restore" subtitle="Your sales and stock live on this computer. Keep a copy somewhere else, every day." />
      <div className="stack" style={{ gap: 20 }}>
        <div className="card card-pad health">
          <span className={'ring ' + (healthy ? 'good' : 'warn')}>
            <Icon name={healthy ? 'shield' : 'alert'} size={22} />
          </span>
          <div className="grow">
            <h3>{healthy ? 'Protected' : settings.last_usb_copy ? `Last pen-drive copy was ${Math.floor(usbAge)} days ago` : 'No pen-drive copy yet'}</h3>
            <p className="subtle">
              Last pen-drive copy: <b>{settings.last_usb_copy || 'never'}</b>
              {settings.backup_folder && (
                <>
                  {' '}· <span className="mono">{settings.backup_folder}</span>
                </>
              )}
            </p>
          </div>
          {settings.backup_folder && (
            <Button variant="primary" icon="usb" loading={busy === 'usb'} disabled={!!busy} onClick={() => act('usb', () => call('backup.copyToFolder', { useSaved: true }), (r) => `Backup copied to ${r.path}`)}>
              Copy to same drive
            </Button>
          )}
          <Button variant={settings.backup_folder ? 'default' : 'primary'} icon="folder" loading={busy === 'usb2'} disabled={!!busy} onClick={() => act('usb2', () => call('backup.copyToFolder', { useSaved: false }), (r) => `Backup copied to ${r.path}`)}>
            Choose drive…
          </Button>
        </div>

        <div className="grid cols-3">
          <div className="card card-pad stack tight">
            <Icon name="clock" size={20} style={{ color: 'var(--brand-600)' }} />
            <h3>Every hour</h3>
            <p className="subtle">While the POS is open. The last 24 are kept.</p>
          </div>
          <div className="card card-pad stack tight">
            <Icon name="database" size={20} style={{ color: 'var(--brand-600)' }} />
            <h3>Every day at closing</h3>
            <p className="subtle">30 daily and 12 monthly copies are kept on this computer.</p>
          </div>
          <div className="card card-pad stack tight">
            <Icon name="shield" size={20} style={{ color: 'var(--brand-600)' }} />
            <h3>Before restores & updates</h3>
            <p className="subtle">A safety copy is taken automatically first.</p>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Backups on this computer</h2>
            <Button size="sm" icon="database" loading={busy === 'now'} disabled={!!busy} onClick={() => act('now', () => call('backup.run'), () => 'Backup made.')}>
              Back up now
            </Button>
            <Button size="sm" variant="danger" icon="upload" disabled={!!busy} onClick={() => restore(null)}>
              Restore from pen drive…
            </Button>
          </div>
          <AsyncView state={st} skeleton={<SkeletonRows rows={5} cols={4} />} isEmpty={(d) => d.files.length === 0} empty={<EmptyState icon="database" title="No backups yet" text="The first one is made automatically today." />}>
            {(d) => (
              <div className="table-wrap" style={{ maxHeight: 380 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th className="r">Size</th>
                      <th className="tight" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.files.map((f: any) => (
                      <tr key={f.name}>
                        <td className="mono">{f.name}</td>
                        <td>
                          <span className="badge">{KIND[f.name.split('-')[1]] ?? f.name.split('-')[1]}</span>
                        </td>
                        <td>{f.modified.slice(0, 16)}</td>
                        <td className="r num">{size(f.size)}</td>
                        <td>
                          <Button size="sm" variant="ghost" icon="history" disabled={!!busy} onClick={() => restore(f.name)}>
                            Restore
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AsyncView>
          {st.data && <div className="card-foot subtle mono">{st.data.dir}</div>}
        </div>

        {st.data?.log?.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h2>Backup log</h2>
            </div>
            <table className="table">
              <tbody>
                {st.data.log.slice(0, 12).map((l: any) => (
                  <tr key={l.id}>
                    <td style={{ width: 160 }}>{l.created_at.slice(0, 16)}</td>
                    <td style={{ width: 130 }}>{KIND[l.kind] ?? l.kind}</td>
                    <td style={{ width: 90 }}>{l.status === 'ok' ? <span className="badge good">OK</span> : <span className="badge bad">{l.status}</span>}</td>
                    <td className="subtle mono truncate" style={{ maxWidth: 520 }}>{l.message ?? l.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
