import { useEffect, useState, type ReactNode } from 'react'
import { call } from '../api'
import { Icon, type IconName } from '../icons'
import { AsyncView, Button, Dialog, EmptyState, Field, IconButton, NumInput, PageHeader, Segmented, Switch, colorHex, errMsg, useApp, useAsync } from '../ui'
import { imgUrl } from '../util'
import { categoryLabel } from './Products'

type Tab = 'shop' | 'printers' | 'catalogue' | 'pos' | 'about'

const SECTIONS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'shop', label: 'Shop & receipt', icon: 'store' },
  { id: 'printers', label: 'Printers & drawer', icon: 'printer' },
  { id: 'catalogue', label: 'Catalogue', icon: 'tag' },
  { id: 'pos', label: 'Billing rules', icon: 'scan' },
  { id: 'about', label: 'Updates & about', icon: 'info' }
]

export default function Settings({ params }: { params?: Record<string, any> }) {
  const [tab, setTab] = useState<Tab>(params?.tab ?? 'shop')
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Shop details, hardware, catalogue and billing rules." />
      <div className="settings">
        <nav className="subnav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>
              <Icon name={s.icon} size={17} />
              {s.label}
            </button>
          ))}
        </nav>
        <div key={tab} style={{ animation: 'page-in 240ms var(--ease-out)' }}>
          {tab === 'shop' && <Shop />}
          {tab === 'printers' && <Printers />}
          {tab === 'catalogue' && <Catalogue />}
          {tab === 'pos' && <BillingRules />}
          {tab === 'about' && <About />}
        </div>
      </div>
    </div>
  )
}

function Section(props: { title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="form-section">
      <div className="desc">
        <h3>{props.title}</h3>
        <p>{props.desc}</p>
      </div>
      <div className="stack">{props.children}</div>
    </div>
  )
}

/** Holds a local copy of some settings and saves them together. */
function useSettingsForm(keys: string[]) {
  const { settings, reloadSettings, notify } = useApp()
  const [v, setV] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => setV(Object.fromEntries(keys.map((k) => [k, settings[k] ?? '']))), [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = keys.some((k) => (v[k] ?? '') !== (settings[k] ?? ''))
  const save = async (quiet = false) => {
    setBusy(true)
    try {
      await call('settings.update', v)
      await reloadSettings()
      if (!quiet) notify('Settings saved.', 'good')
      return true
    } catch (e) {
      notify(errMsg(e), 'bad')
      return false
    } finally {
      setBusy(false)
    }
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value })
  return { v, setV, set, save, busy, dirty }
}

function SaveBar({ dirty, busy, onSave }: { dirty: boolean; busy: boolean; onSave: () => void }) {
  return (
    <div className="row end" style={{ paddingTop: 16 }}>
      {dirty && <span className="subtle">Unsaved changes</span>}
      <Button variant="primary" icon="check" disabled={!dirty} loading={busy} onClick={onSave}>
        Save changes
      </Button>
    </div>
  )
}

function Shop() {
  const f = useSettingsForm(['shop_name', 'shop_address', 'shop_phone', 'receipt_footer', 'invoice_prefix'])
  const { settings, reloadSettings, notify } = useApp()
  const pickLogo = async () => {
    try {
      if (await call('settings.pickLogo')) await reloadSettings()
    } catch (e) {
      notify(errMsg(e), 'bad')
    }
  }
  return (
    <div className="card card-pad">
      <Section title="Shop details" desc="Printed at the top of every receipt and on barcode labels.">
        <Field label="Shop name">
          <input className="input" value={f.v.shop_name ?? ''} onChange={f.set('shop_name')} />
        </Field>
        <div className="grid cols-2">
          <Field label="Address" optional>
            <input className="input" value={f.v.shop_address ?? ''} onChange={f.set('shop_address')} />
          </Field>
          <Field label="Phone" optional>
            <input className="input" value={f.v.shop_phone ?? ''} onChange={f.set('shop_phone')} />
          </Field>
        </div>
      </Section>
      <Section title="Receipt" desc="The footer message and how invoice numbers look.">
        <Field label="Footer message">
          <input className="input" value={f.v.receipt_footer ?? ''} onChange={f.set('receipt_footer')} />
        </Field>
        <Field label="Invoice prefix" hint={`Invoices look like ${f.v.invoice_prefix || 'INV'}-20261118-0001`}>
          <input className="input" value={f.v.invoice_prefix ?? ''} onChange={f.set('invoice_prefix')} style={{ width: 160 }} maxLength={8} />
        </Field>
      </Section>
      <Section title="Receipt logo" desc="Black-and-white logos print best on thermal paper.">
        <div className="row">
          <div className="thumb lg" style={{ width: 160, height: 80, background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
            {settings.logo_path ? <img src={imgUrl(settings.logo_path)} alt="Logo" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} /> : <Icon name="image" size={24} />}
          </div>
          <Button icon="upload" onClick={pickLogo}>
            {settings.logo_path ? 'Change logo' : 'Upload logo'}
          </Button>
        </div>
      </Section>
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} />
    </div>
  )
}

function Printers() {
  const { notify } = useApp()
  const printers = useAsync<any[]>(() => call('settings.printers'), [])
  const f = useSettingsForm(['receipt_printer', 'receipt_width', 'receipt_mode', 'drawer_enabled', 'label_printer', 'label_width_mm', 'label_height_mm', 'label_show_shop'])
  const [testing, setTesting] = useState<string | false>(false)
  const test = async (ch: 'settings.testReceipt' | 'settings.testLabel' | 'settings.testDrawer', ok: string) => {
    setTesting(ch)
    try {
      if (f.dirty && !(await f.save(true))) return
      await call(ch)
      notify(ok, 'good')
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setTesting(false)
    }
  }
  const printerSelect = (k: string) => (
    <div className="row nowrap">
      <select className="select" value={f.v[k] ?? ''} onChange={f.set(k)}>
        <option value="">Choose a printer…</option>
        {printers.data?.map((p) => (
          <option key={p.name} value={p.name}>
            {p.displayName || p.name}
          </option>
        ))}
      </select>
      <IconButton icon="refresh" label="Refresh printer list" onClick={printers.reload} />
    </div>
  )
  return (
    <div className="card card-pad">
      <Section title="Receipt printer" desc="Install the printer's Windows driver first. It must not show as Offline in Windows.">
        <Field label="Printer">{printerSelect('receipt_printer')}</Field>
        <div className="grid cols-2">
          <Field label="Paper width" group>
            <Segmented
              value={(f.v.receipt_width as '80' | '58') || '80'}
              onChange={(x) => f.setV({ ...f.v, receipt_width: x })}
              options={[
                { value: '80', label: '80 mm' },
                { value: '58', label: '58 mm' }
              ]}
            />
          </Field>
          <Field label="Print mode" hint="Use Raw ESC/POS only if driver mode prints badly or does not cut.">
            <select className="select" value={f.v.receipt_mode ?? 'driver'} onChange={f.set('receipt_mode')}>
              <option value="driver">Windows driver (recommended)</option>
              <option value="raw">Raw ESC/POS</option>
            </select>
          </Field>
        </div>
        <Button icon="printer" loading={testing === 'settings.testReceipt'} disabled={!!testing || !f.v.receipt_printer} onClick={() => test('settings.testReceipt', 'Test receipt sent.')} style={{ alignSelf: 'flex-start' }}>
          Print test receipt
        </Button>
      </Section>
      <Section title="Cash drawer" desc="Plug the drawer's RJ11 cable into the receipt printer. It opens on cash sales.">
        <Switch checked={f.v.drawer_enabled === '1'} onChange={(x) => f.setV({ ...f.v, drawer_enabled: x ? '1' : '0' })} label="Cash drawer connected" />
        {f.v.drawer_enabled === '1' && (
          <Button icon="drawer" loading={testing === 'settings.testDrawer'} disabled={!!testing || !f.v.receipt_printer} onClick={() => test('settings.testDrawer', 'Drawer signal sent.')} style={{ alignSelf: 'flex-start' }}>
            Test drawer
          </Button>
        )}
      </Section>
      <Section title="Barcode label printer" desc="Set the same label size and gap in the printer's own driver, then calibrate it with its feed button.">
        <Field label="Printer">{printerSelect('label_printer')}</Field>
        <div className="grid cols-2">
          <Field label="Label width">
            <NumInput value={Number(f.v.label_width_mm) || 0} onChange={(n) => f.setV({ ...f.v, label_width_mm: String(n) })} suffix="mm" />
          </Field>
          <Field label="Label height">
            <NumInput value={Number(f.v.label_height_mm) || 0} onChange={(n) => f.setV({ ...f.v, label_height_mm: String(n) })} suffix="mm" />
          </Field>
        </div>
        <Switch checked={f.v.label_show_shop === '1'} onChange={(x) => f.setV({ ...f.v, label_show_shop: x ? '1' : '0' })} label="Print shop name on labels" />
        <Button icon="printer" loading={testing === 'settings.testLabel'} disabled={!!testing || !f.v.label_printer} onClick={() => test('settings.testLabel', 'Test label sent.')} style={{ alignSelf: 'flex-start' }}>
          Print test label
        </Button>
      </Section>
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} />
    </div>
  )
}

function BillingRules() {
  const f = useSettingsForm(['low_stock_default', 'auto_lock_minutes', 'receipt_copies'])
  return (
    <div className="card card-pad">
      <Section title="Stock alerts" desc="New items warn when their stock falls to this level. Each item can override it.">
        <Field label="Default low-stock level">
          <NumInput value={Number(f.v.low_stock_default) || 0} onChange={(n) => f.setV({ ...f.v, low_stock_default: String(Math.floor(n)) })} suffix="pcs" style={{ width: 160 }} />
        </Field>
      </Section>
      <Section title="Security" desc="Lock the screen when the counter is left unattended.">
        <Field label="Lock after inactivity" hint="0 = never lock">
          <NumInput value={Number(f.v.auto_lock_minutes) || 0} onChange={(n) => f.setV({ ...f.v, auto_lock_minutes: String(Math.floor(n)) })} suffix="min" style={{ width: 160 }} />
        </Field>
      </Section>
      <Section title="Receipts" desc="Print a second copy for the shop's own records.">
        <Segmented
          value={(f.v.receipt_copies as '1' | '2') || '1'}
          onChange={(x) => f.setV({ ...f.v, receipt_copies: x })}
          options={[
            { value: '1', label: '1 copy' },
            { value: '2', label: '2 copies' }
          ]}
        />
      </Section>
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} />
    </div>
  )
}

function Catalogue() {
  const { notify } = useApp()
  const lk = useAsync<any>(() => call('catalog.lookups'), [])
  const [edit, setEdit] = useState<{ kind: 'category' | 'size' | 'color'; row: any } | null>(null)
  const [busy, setBusy] = useState(false)

  const quickSizes = async (list: string[]) => {
    try {
      let order = (lk.data?.sizes.length ?? 0) * 10
      let added = 0
      for (const name of list) {
        if (lk.data?.sizes.some((s: any) => s.name.toLowerCase() === name.toLowerCase())) continue
        await call('catalog.saveSize', { name, code: name.replace(/\s/g, '').slice(0, 4), sortOrder: (order += 10) })
        added++
      }
      notify(added ? `${added} size${added === 1 ? '' : 's'} added.` : 'Those sizes already exist.', added ? 'good' : 'info')
      lk.reload()
    } catch (e) {
      notify(errMsg(e), 'bad')
    }
  }

  const save = async () => {
    if (!edit || !edit.row.name?.trim()) return
    const r = edit.row
    setBusy(true)
    try {
      if (edit.kind === 'category') await call('catalog.saveCategory', { id: r.id ?? null, name: r.name.trim(), code: r.code || null, parentId: r.parent_id || null, active: r.active !== 0 })
      if (edit.kind === 'size') await call('catalog.saveSize', { id: r.id ?? null, name: r.name.trim(), code: r.code || null, sortOrder: Number(r.sort_order) || 0 })
      if (edit.kind === 'color') await call('catalog.saveColor', { id: r.id ?? null, name: r.name.trim(), code: r.code || null, sortOrder: Number(r.sort_order) || 0 })
      setEdit(null)
      lk.reload()
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AsyncView state={lk}>
      {({ categories, sizes, colors }) => (
        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h2>Categories <span className="subtle">· the code starts each SKU</span></h2>
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEdit({ kind: 'category', row: { name: '', code: '', parent_id: '', active: 1 } })}>
                Add category
              </Button>
            </div>
            {categories.length === 0 ? (
              <EmptyState icon="folder" title="No categories yet" text="For example: Men › Shirts, Women › Kurti, Kids › T-Shirts." />
            ) : (
              <table className="table">
                <tbody>
                  {categories.map((c: any) => (
                    <tr key={c.id} className="click" onClick={() => setEdit({ kind: 'category', row: { ...c } })}>
                      <td style={{ paddingLeft: c.parent_id ? 40 : 16 }}>
                        <span className="row nowrap" style={{ gap: 8 }}>
                          <Icon name={c.parent_id ? 'right' : 'folder'} size={15} style={{ color: 'var(--text-3)' }} />
                          <span className={c.parent_id ? '' : 'cell-title'}>{c.name}</span>
                          {!c.active && <span className="badge">Hidden</span>}
                        </span>
                      </td>
                      <td className="r mono subtle">{c.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="grid cols-2">
            <div className="card">
              <div className="card-head">
                <h2>Sizes</h2>
                <Button size="sm" icon="plus" onClick={() => setEdit({ kind: 'size', row: { name: '', code: '', sort_order: (sizes.length + 1) * 10 } })}>
                  Add
                </Button>
              </div>
              <div className="card-body stack">
                <div className="row" style={{ gap: 6 }}>
                  <span className="subtle">Quick add:</span>
                  <button className="pickchip" onClick={() => quickSizes(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'])}>XS – 3XL</button>
                  <button className="pickchip" onClick={() => quickSizes(['28', '30', '32', '34', '36', '38', '40'])}>Waist 28 – 40</button>
                  <button className="pickchip" onClick={() => quickSizes(['Free Size'])}>Free size</button>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {sizes.length === 0 && <span className="subtle">No sizes yet.</span>}
                  {sizes.map((s: any) => (
                    <button key={s.id} className="pickchip" onClick={() => setEdit({ kind: 'size', row: { ...s } })}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Colours</h2>
                <Button size="sm" icon="plus" onClick={() => setEdit({ kind: 'color', row: { name: '', code: '', sort_order: (colors.length + 1) * 10 } })}>
                  Add
                </Button>
              </div>
              <div className="card-body">
                <div className="row" style={{ gap: 6 }}>
                  {colors.length === 0 && <span className="subtle">No colours yet.</span>}
                  {colors.map((c: any) => (
                    <button key={c.id} className="pickchip" onClick={() => setEdit({ kind: 'color', row: { ...c } })}>
                      <span className="swatch" style={{ background: colorHex(c.name) }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {edit && (
            <Dialog
              title={`${edit.row.id ? 'Edit' : 'New'} ${edit.kind === 'color' ? 'colour' : edit.kind}`}
              icon={edit.kind === 'category' ? 'folder' : 'tag'}
              onClose={() => setEdit(null)}
              onSubmit={save}
              footer={(close) => (
                <>
                  <Button variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" loading={busy} disabled={!edit.row.name?.trim()}>
                    Save
                  </Button>
                </>
              )}
            >
              <div className="grid cols-2">
                <Field label="Name">
                  <input className="input" value={edit.row.name} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} autoFocus />
                </Field>
                <Field label="Short code" hint={edit.kind === 'color' ? 'Up to 3 letters, e.g. BLK' : 'Up to 4 letters, e.g. SHRT'}>
                  <input className="input mono" value={edit.row.code ?? ''} maxLength={edit.kind === 'color' ? 3 : 4} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, code: e.target.value.toUpperCase() } })} />
                </Field>
                {edit.kind === 'category' ? (
                  <>
                    <Field label="Parent category">
                      <select className="select" value={edit.row.parent_id ?? ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, parent_id: e.target.value } })}>
                        <option value="">Top level</option>
                        {categories
                          .filter((c: any) => !c.parent_id && c.id !== edit.row.id)
                          .map((c: any) => (
                            <option key={c.id} value={c.id}>
                              {categoryLabel(c)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Visibility" group>
                      <div style={{ height: 38, display: 'flex', alignItems: 'center' }}>
                        <Switch checked={edit.row.active !== 0} onChange={(v) => setEdit({ ...edit, row: { ...edit.row, active: v ? 1 : 0 } })} label="Active" />
                      </div>
                    </Field>
                  </>
                ) : (
                  <Field label="Sort order" hint="Lower numbers show first">
                    <NumInput value={Number(edit.row.sort_order) || 0} onChange={(n) => setEdit({ ...edit, row: { ...edit.row, sort_order: Math.floor(n) } })} />
                  </Field>
                )}
                {edit.kind === 'color' && edit.row.name && (
                  <div className="row" style={{ gridColumn: 'span 2' }}>
                    <span className="swatch" style={{ background: colorHex(edit.row.name), width: 22, height: 22 }} />
                    <span className="subtle">Preview swatch</span>
                  </div>
                )}
              </div>
            </Dialog>
          )}
        </div>
      )}
    </AsyncView>
  )
}

function About() {
  const { notify } = useApp()
  const info = useAsync<any>(() => call('app.info'), [])
  const [upd, setUpd] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true)
    try {
      setUpd(await call('update.check'))
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card card-pad">
      <Section title={`The Raw Bros POS ${info.data?.version ?? ''}`} desc="The Raw Bros – Retail POS Solutions">
        <div className="stack tight">
          <span className="subtle">Data file</span>
          <span className="mono">{info.data?.dbPath}</span>
          <span className="subtle" style={{ marginTop: 8 }}>Backups</span>
          <span className="mono">{info.data?.backupDir}</span>
        </div>
      </Section>
      <Section title="Software updates" desc="Updates download in the background and install only when you choose, outside billing hours.">
        <div className="row">
          <Button icon="refresh" onClick={check} loading={busy}>
            Check for updates
          </Button>
          {upd?.status === 'ready' && (
            <Button variant="primary" icon="download" onClick={() => call('update.install').catch((e) => notify(errMsg(e), 'bad'))}>
              Restart and install {upd.version}
            </Button>
          )}
        </div>
        {upd && (
          <div className={'banner ' + (upd.status === 'error' ? 'bad' : upd.status === 'ready' ? 'good' : 'info')}>
            <Icon name={upd.status === 'error' ? 'alert' : 'info'} />
            <span>
              {upd.status === 'dev' && upd.message}
              {upd.status === 'up-to-date' && 'You have the latest version.'}
              {upd.status === 'downloading' && `Downloading ${upd.version ?? ''} ${upd.percent ? upd.percent + '%' : ''}… check again in a minute.`}
              {upd.status === 'ready' && `Version ${upd.version} is ready. A backup is made before installing.`}
              {upd.status === 'error' && `Update check failed: ${upd.message}`}
              {upd.status === 'checking' && 'Checking…'}
            </span>
          </div>
        )}
      </Section>
    </div>
  )
}
