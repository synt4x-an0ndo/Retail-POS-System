import { useState, type ReactNode } from 'react'
import { call } from '../api'
import { Icon } from '../icons'
import { Button, Field, errMsg, type User } from '../ui'

function BrandPanel() {
  return (
    <div className="auth-brand">
      <div className="brandmark">
        <span className="logo">RB</span>
        <div>
          <b>The Raw Bros</b>
          <span>Retail POS Solutions</span>
        </div>
      </div>
      <h1>
        Sell faster. <em>Know every piece</em> on your shelf.
      </h1>
      <p>Barcode billing, size-and-colour stock and daily reports, all working fully offline on this computer.</p>
      <ul>
        <li><Icon name="scan" /> Scan, pay and print in seconds</li>
        <li><Icon name="layers" /> Live stock by size and colour</li>
        <li><Icon name="shield" /> Owner approvals and automatic backups</li>
      </ul>
      <div className="foot">The Raw Bros – Retail POS Solutions · Works without internet</div>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <BrandPanel />
      <div className="auth-panel">{children}</div>
    </div>
  )
}

export function Setup({ onDone }: { onDone: (u: User) => void }) {
  const [step, setStep] = useState(0)
  const [f, setF] = useState({
    shopName: '',
    address: '',
    phone: '',
    receiptFooter: 'Thank you for shopping with us! Exchange within 7 days with receipt.',
    ownerName: '',
    username: 'owner',
    password: '',
    password2: '',
    pin: ''
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  const finish = async () => {
    setErr('')
    if (f.password.length < 6) return setErr('Password must be at least 6 characters.')
    if (f.password !== f.password2) return setErr('The two passwords do not match.')
    if (!/^\d{4,6}$/.test(f.pin)) return setErr('PIN must be 4 to 6 digits.')
    setBusy(true)
    try {
      const { password2: _p, ...input } = f
      onDone(await call('setup.complete', input))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <form
        className="auth-form wide"
        key={step}
        onSubmit={(e) => {
          e.preventDefault()
          if (step === 0) f.shopName.trim() && setStep(1)
          else finish()
        }}
      >
        <div className="stepper">
          <div className={'st on'}>
            <i />
            1 · Your shop
          </div>
          <div className={'st' + (step >= 1 ? ' on' : '')}>
            <i />
            2 · Owner account
          </div>
        </div>
        {step === 0 ? (
          <>
            <h2>Welcome! Let's set up your shop</h2>
            <p>These details print on every receipt and barcode label. You can change them later.</p>
            <div className="stack">
              <Field label="Shop name">
                <input className="input lg" value={f.shopName} onChange={set('shopName')} autoFocus placeholder="e.g. Raw Threads, Dhanmondi" />
              </Field>
              <Field label="Address" optional>
                <input className="input" value={f.address} onChange={set('address')} />
              </Field>
              <Field label="Phone" optional>
                <input className="input" value={f.phone} onChange={set('phone')} />
              </Field>
              <Field label="Receipt footer message">
                <input className="input" value={f.receiptFooter} onChange={set('receiptFooter')} />
              </Field>
              <div className="row end">
                <Button variant="primary" size="lg" type="submit" iconRight="right" disabled={!f.shopName.trim()}>
                  Continue
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2>Create the owner account</h2>
            <p>The owner manages prices, staff, reports and backups, and approves discounts and cancellations with a PIN.</p>
            <div className="grid cols-2">
              <Field label="Your name">
                <input className="input" value={f.ownerName} onChange={set('ownerName')} autoFocus />
              </Field>
              <Field label="Username">
                <input className="input" value={f.username} onChange={set('username')} />
              </Field>
              <Field label="Password" hint="At least 6 characters">
                <input className="input" type="password" value={f.password} onChange={set('password')} />
              </Field>
              <Field label="Repeat password">
                <input className="input" type="password" value={f.password2} onChange={set('password2')} />
              </Field>
              <Field label="Owner PIN" hint="4–6 digits. Approves discounts, cancellations and the cash drawer.">
                <input className="input" type="password" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
              </Field>
            </div>
            {err && (
              <div className="banner bad" style={{ marginTop: 16 }}>
                <Icon name="alert" /> {err}
              </div>
            )}
            <div className="row between" style={{ marginTop: 24 }}>
              <Button icon="left" variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button variant="primary" size="lg" type="submit" loading={busy} disabled={!f.ownerName.trim()} icon="check">
                Finish setup
              </Button>
            </div>
          </>
        )}
      </form>
    </Shell>
  )
}

export function Login({ onDone }: { onDone: (u: User) => void }) {
  const [username, setUsername] = useState(() => storageGet('last_user'))
  const [secret, setSecret] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const u = await call<User>('auth.login', { username, secret })
      storageSet('last_user', username)
      onDone(u)
    } catch (e2) {
      setErr(errMsg(e2))
      setSecret('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <form className="auth-form" onSubmit={submit}>
        <h2>Welcome back</h2>
        <p>Log in with your password or quick PIN.</p>
        <div className="stack">
          <Field label="Username">
            <input className="input lg" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!username} autoComplete="username" />
          </Field>
          <Field label="Password or PIN">
            <input className={'input lg' + (err ? ' invalid' : '')} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus={!!username} autoComplete="current-password" />
          </Field>
          {err && (
            <div className="banner bad">
              <Icon name="alert" /> {err}
            </div>
          )}
          <Button variant="primary" size="lg" type="submit" block loading={busy} disabled={!username || !secret}>
            Log in
          </Button>
        </div>
      </form>
    </Shell>
  )
}

function storageGet(k: string): string {
  try {
    return localStorage.getItem('trb_' + k) ?? ''
  } catch {
    return ''
  }
}
function storageSet(k: string, v: string) {
  try {
    localStorage.setItem('trb_' + k, v)
  } catch {
    /* ignore */
  }
}
