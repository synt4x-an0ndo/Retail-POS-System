import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Permission } from '@shared/permissions'
import { call } from './api'
import { Icon, type IconName } from './icons'
import { AppContext, Avatar, IconButton, PinPrompt, type User } from './ui'
import { Login, Setup } from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Pos from './pages/Pos'
import Products from './pages/Products'
import Stock from './pages/Stock'
import Sales from './pages/Sales'
import Reports from './pages/Reports'
import Users from './pages/Users'
import Settings from './pages/Settings'
import Backup from './pages/Backup'
import Activity from './pages/Activity'

type NavItem = { id: string; label: string; icon: IconName; perm: Permission | null; key?: string }
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Sell',
    items: [
      { id: 'dashboard', label: 'Overview', icon: 'dashboard', perm: null },
      { id: 'pos', label: 'Checkout', icon: 'scan', perm: 'pos.sell', key: 'F1' },
      { id: 'sales', label: 'Transactions', icon: 'receipt', perm: 'sales.view' }
    ]
  },
  {
    section: 'Catalogue',
    items: [
      { id: 'products', label: 'Products', icon: 'tag', perm: 'product.view' },
      { id: 'stock', label: 'Inventory', icon: 'layers', perm: 'product.view' }
    ]
  },
  { section: 'Insights', items: [{ id: 'reports', label: 'Reports', icon: 'chart', perm: 'report.view' }] },
  {
    section: 'Admin',
    items: [
      { id: 'users', label: 'Team', icon: 'users', perm: 'user.manage' },
      { id: 'backup', label: 'Backup', icon: 'database', perm: 'backup.manage' },
      { id: 'activity', label: 'Activity log', icon: 'activity', perm: 'log.view' },
      { id: 'settings', label: 'Settings', icon: 'settings', perm: 'settings.manage' }
    ]
  }
]

type Toast = { id: number; msg: string; kind: string; leaving?: boolean }

export default function App() {
  const [status, setStatus] = useState<{ setupDone: boolean; user: User | null } | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [page, setPage] = useState<{ id: string; params?: Record<string, any>; n: number }>({ id: 'dashboard', n: 0 })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pinAsk, setPinAsk] = useState<{ message: string; resolve: (p: string | null) => void } | null>(null)
  const [lowCount, setLowCount] = useState(0)

  const reloadSettings = useCallback(async () => {
    setSettings(await call('settings.get'))
  }, [])

  useEffect(() => {
    call('auth.status').then(async (s) => {
      if (s.user) await reloadSettings()
      setStatus(s)
    })
  }, [reloadSettings])

  const notify = useCallback((msg: string, kind: 'good' | 'bad' | 'info' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), kind === 'bad' ? 6000 : 3200)
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'bad' ? 6250 : 3450)
  }, [])

  const askPin = useCallback((message: string) => new Promise<string | null>((resolve) => setPinAsk({ message, resolve })), [])

  const onLoggedIn = useCallback(
    async (user: User) => {
      await reloadSettings()
      setStatus({ setupDone: true, user })
      setPage({ id: user.permissions.includes('pos.sell') && !user.permissions.includes('report.view') ? 'pos' : 'dashboard', n: Date.now() })
    },
    [reloadSettings]
  )

  const logout = useCallback(async () => {
    await call('auth.logout').catch(() => undefined)
    setStatus((s) => (s ? { ...s, user: null } : s))
  }, [])

  const user = status?.user ?? null
  const can = useCallback((p: Permission) => !!user?.permissions.includes(p), [user])
  const go = useCallback((id: string, params?: Record<string, any>) => setPage({ id, params, n: Date.now() }), [])

  // Low-stock count for the sidebar badge, refreshed on navigation.
  useEffect(() => {
    if (!user || !user.permissions.includes('product.view')) return
    call<any>('sales.dashboard').then((d) => setLowCount(d.lowStockCount)).catch(() => undefined)
  }, [user, page.n])

  // Auto-lock after inactivity.
  const lastActive = useRef(Date.now())
  useEffect(() => {
    const touch = () => (lastActive.current = Date.now())
    window.addEventListener('keydown', touch)
    window.addEventListener('mousedown', touch)
    const t = setInterval(() => {
      const mins = Number(settings.auto_lock_minutes) || 0
      if (user && mins > 0 && Date.now() - lastActive.current > mins * 60000) {
        logout()
        notify('Locked after inactivity. Log in again.')
      }
    }, 15000)
    return () => {
      window.removeEventListener('keydown', touch)
      window.removeEventListener('mousedown', touch)
      clearInterval(t)
    }
  }, [settings.auto_lock_minutes, user, logout, notify])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F1' && user && can('pos.sell')) {
        e.preventDefault()
        go('pos')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [user, can, go])

  const ctx = useMemo(() => (user ? { user, settings, reloadSettings, can, notify, askPin, go } : null), [user, settings, reloadSettings, can, notify, askPin, go])

  const toastsEl = (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind + (t.leaving ? ' leaving' : '')}>
          <span className="ti">
            <Icon name={t.kind === 'good' ? 'check' : t.kind === 'bad' ? 'x' : 'info'} size={13} stroke={2.6} />
          </span>
          <span className="msg">{t.msg}</span>
        </div>
      ))}
    </div>
  )

  if (!status) return null
  if (!status.setupDone) return (<><Setup onDone={onLoggedIn} />{toastsEl}</>)
  if (!user || !ctx) return (<><Login onDone={onLoggedIn} />{toastsEl}</>)

  const visible = NAV.map((s) => ({ ...s, items: s.items.filter((n) => !n.perm || can(n.perm)) })).filter((s) => s.items.length)
  const allowed = visible.flatMap((s) => s.items.map((i) => i.id))
  const current = allowed.includes(page.id) ? page.id : 'dashboard'

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="brandmark">
            <span className="logo">RB</span>
            <div className="grow">
              <b className="truncate" style={{ display: 'block' }}>{settings.shop_name || 'The Raw Bros'}</b>
              <span>Retail POS</span>
            </div>
          </div>
          {visible.map((s) => (
            <div key={s.section}>
              <div className="nav-section">{s.section}</div>
              {s.items.map((n) => (
                <button key={n.id} className={'nav-item' + (current === n.id ? ' active' : '')} onClick={() => go(n.id)} aria-current={current === n.id ? 'page' : undefined} title={n.label}>
                  <Icon name={n.icon} size={18} />
                  <span className="nav-label">{n.label}</span>
                  {n.id === 'stock' && lowCount > 0 ? <span className="count">{lowCount}</span> : n.key ? <span className="kbd">{n.key}</span> : null}
                </button>
              ))}
            </div>
          ))}
          <div className="spacer" />
          <div className="usercard" title={user.name}>
            <span className="usercard-avatar">
              <Avatar name={user.name} />
            </span>
            <div className="grow">
              <b className="truncate">{user.name}</b>
              <span>{user.roleName}</span>
            </div>
            <IconButton icon="lock" label="Lock / log out" onClick={logout} />
          </div>
        </aside>
        <main className="main" key={current + page.n}>
          {current === 'dashboard' && <Dashboard />}
          {current === 'pos' && <Pos />}
          {current === 'products' && <Products params={page.params} />}
          {current === 'stock' && <Stock params={page.params} />}
          {current === 'sales' && <Sales />}
          {current === 'reports' && <Reports />}
          {current === 'users' && <Users />}
          {current === 'settings' && <Settings params={page.params} />}
          {current === 'backup' && <Backup />}
          {current === 'activity' && <Activity />}
        </main>
      </div>
      {pinAsk && (
        <PinPrompt
          message={pinAsk.message}
          onDone={(p) => {
            pinAsk.resolve(p)
            setPinAsk(null)
          }}
        />
      )}
      {toastsEl}
    </AppContext.Provider>
  )
}
