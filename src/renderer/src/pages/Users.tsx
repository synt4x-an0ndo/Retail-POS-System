import { useState } from 'react'
import { call } from '../api'
import { Icon } from '../icons'
import { AsyncView, Avatar, Button, Dialog, Field, NumInput, PageHeader, Switch, errMsg, useApp, useAsync } from '../ui'

export default function Users() {
  const { notify, user } = useApp()
  const list = useAsync<any[]>(() => call('users.list'), [])
  const roles = useAsync<any[]>(() => call('users.roles'), [])
  const [edit, setEdit] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!edit.name?.trim() || !edit.username?.trim() || (!edit.id && !edit.password)) return
    setBusy(true)
    try {
      await call('users.save', {
        id: edit.id ?? null,
        name: edit.name.trim(),
        username: edit.username.trim(),
        password: edit.password || null,
        pin: edit.pin || null,
        roleId: edit.role_id,
        discountLimitPct: Number(edit.discount_limit_pct),
        active: !!edit.active
      })
      notify(edit.id ? 'Team member updated.' : `${edit.name} can now log in.`, 'good')
      setEdit(null)
      list.reload()
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Team"
        subtitle="Who can log in, what they can do, and how much discount they may give without approval."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEdit({ name: '', username: '', password: '', pin: '', role_id: 'role-cashier', discount_limit_pct: 10, active: 1 })}>
            Add cashier
          </Button>
        }
      />
      <div className="grid cols-3">
        <AsyncView state={list}>
          {(d) => (
            <>
              {d.map((u) => (
                <div key={u.id} className="card card-pad interactive stack tight" onClick={() => setEdit({ ...u, password: '', pin: '' })} style={{ opacity: u.active ? 1 : 0.6 }}>
                  <div className="row nowrap">
                    <Avatar name={u.name} />
                    <div className="grow">
                      <div className="cell-title truncate">
                        {u.name} {u.id === user.id && <span className="badge info">You</span>}
                      </div>
                      <div className="cell-sub">@{u.username}</div>
                    </div>
                    {u.active ? <span className="badge good"><span className="dot" />Active</span> : <span className="badge">Inactive</span>}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <span className={'badge ' + (u.role_id === 'role-owner' ? 'info' : '')}>
                      <Icon name={u.role_id === 'role-owner' ? 'shield' : 'user'} size={12} /> {u.role_name}
                    </span>
                    <span className="badge">Discount up to {u.discount_limit_pct}%</span>
                    <span className="badge">{u.has_pin ? 'PIN set' : 'No PIN'}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </AsyncView>
      </div>
      <div className="banner info" style={{ marginTop: 20 }}>
        <Icon name="shield" />
        <span>Cashiers can sell, see their own sales and print labels. Bigger discounts, selling without stock, cancelling sales and opening the drawer need the owner's PIN.</span>
      </div>
      {edit && (
        <Dialog
          size="md"
          title={edit.id ? 'Edit team member' : 'Add a cashier'}
          icon="user"
          onClose={() => setEdit(null)}
          onSubmit={save}
          footer={(close) => (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={busy} disabled={!edit.name?.trim() || !edit.username?.trim() || (!edit.id && !edit.password)}>
                {edit.id ? 'Save changes' : 'Add cashier'}
              </Button>
            </>
          )}
        >
          <div className="grid cols-2">
            <Field label="Full name">
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Username" hint="Letters, numbers, dot, dash">
              <input className="input" value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} />
            </Field>
            <Field label={edit.id ? 'New password' : 'Password'} hint={edit.id ? 'Leave blank to keep the current one' : 'At least 6 characters'}>
              <input className="input" type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
            <Field label={edit.id ? 'New PIN' : 'Quick-login PIN'} hint={edit.id ? 'Leave blank to keep' : '4–6 digits'}>
              <input className="input" type="password" inputMode="numeric" maxLength={6} value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="Role">
              <select className="select" value={edit.role_id} onChange={(e) => setEdit({ ...edit, role_id: e.target.value })}>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Max discount without approval">
              <NumInput value={Number(edit.discount_limit_pct)} onChange={(n) => setEdit({ ...edit, discount_limit_pct: Math.min(100, Math.max(0, n)) })} suffix="%" />
            </Field>
            <div style={{ gridColumn: 'span 2' }}>
              <Switch checked={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} label="Active – can log in" />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
