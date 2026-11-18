import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { Permission } from '@shared/permissions'
import { ApiError, call, isOverride } from './api'
import { Icon, type IconName } from './icons'

// ==========================================================================
// App context
// ==========================================================================

export interface User {
  id: string
  name: string
  username: string
  roleId: string
  roleName: string
  permissions: Permission[]
  discountLimitPct: number
}

interface AppCtx {
  user: User
  settings: Record<string, string>
  reloadSettings: () => Promise<void>
  can: (p: Permission) => boolean
  notify: (msg: string, kind?: 'good' | 'bad' | 'info') => void
  askPin: (message: string) => Promise<string | null>
  go: (page: string, params?: Record<string, any>) => void
}

export const AppContext = createContext<AppCtx>(null as any)
export const useApp = () => useContext(AppContext)
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Runs an action; if it needs owner approval, asks for the PIN and retries with it. */
export function useGuarded() {
  const { askPin, notify } = useApp()
  return useCallback(
    async <T,>(fn: (pin: string | null) => Promise<T>): Promise<T | null> => {
      try {
        return await fn(null)
      } catch (e) {
        if (!isOverride(e)) {
          notify(errMsg(e), 'bad')
          return null
        }
        for (;;) {
          const pin = await askPin((e as ApiError).message)
          if (!pin) return null
          try {
            return await fn(pin)
          } catch (e2) {
            if (e2 instanceof ApiError && e2.code === 'OVERRIDE_FAILED') {
              notify(e2.message, 'bad')
              continue
            }
            notify(errMsg(e2), 'bad')
            return null
          }
        }
      }
    },
    [askPin, notify]
  )
}

/** Loads data; keeps showing the previous data while reloading, so lists never flash. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, reload, initial: loading && data === null }
}

export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// ==========================================================================
// Primitives
// ==========================================================================

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'success' | 'danger' | 'danger-solid' | 'ghost' | 'default'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
  block?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, iconRight, loading, block, className, children, ...rest }: BtnProps) {
  const v = variant === 'danger-solid' ? 'danger solid' : variant === 'default' ? '' : variant
  const cls = ['btn', v, size !== 'md' ? size : '', block ? 'block' : '', loading ? 'loading' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} disabled={rest.disabled || loading} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : size === 'xl' ? 22 : 17} />}
      {children}
      {iconRight && <Icon name={iconRight} size={16} />}
    </button>
  )
}

export function IconButton({ icon, label, danger, size = 18, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; danger?: boolean; size?: number }) {
  return (
    <button type="button" className={'iconbtn' + (danger ? ' danger' : '')} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  )
}

/** Labelled form row. Use `group` for non-text controls (switches, segmented, button groups) so clicks on the row don't trigger them. */
export function Field(props: { label?: string; hint?: ReactNode; error?: string | null; optional?: boolean; group?: boolean; children: ReactNode; style?: React.CSSProperties; className?: string }) {
  const Tag = props.group ? 'div' : 'label'
  return (
    <Tag className={'field ' + (props.className ?? '')} style={props.style} role={props.group ? 'group' : undefined} aria-label={props.group ? props.label : undefined}>
      {props.label && (
        <span className="lbl">
          {props.label}
          {props.optional && <span className="opt">optional</span>}
        </span>
      )}
      {props.children}
      {props.error ? <span className="err">{props.error}</span> : props.hint ? <span className="hint">{props.hint}</span> : null}
    </Tag>
  )
}

/** Number input that keeps the typed text while editing. */
export function NumInput(props: {
  value: number
  onChange: (n: number) => void
  min?: number
  step?: number
  prefix?: string
  suffix?: string
  className?: string
  style?: React.CSSProperties
  autoFocus?: boolean
  disabled?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  onEnter?: () => void
  ariaLabel?: string
}) {
  const [s, setS] = useState(String(props.value ?? 0))
  useEffect(() => {
    if (Number(s) !== props.value) setS(String(props.value ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value])
  const input = (
    <input
      ref={props.inputRef}
      type="number"
      inputMode="decimal"
      className={'input num ' + (props.prefix || props.suffix ? '' : props.className ?? '')}
      min={props.min ?? 0}
      step={props.step ?? 1}
      value={s}
      aria-label={props.ariaLabel}
      style={props.prefix || props.suffix ? undefined : props.style}
      autoFocus={props.autoFocus}
      disabled={props.disabled}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => e.key === 'Enter' && props.onEnter?.()}
      onChange={(e) => {
        setS(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value === '') props.onChange(0)
        else if (Number.isFinite(n)) props.onChange(n)
      }}
    />
  )
  if (!props.prefix && !props.suffix) return input
  return (
    <div className={'affix ' + (props.className ?? '')} style={props.style}>
      {props.prefix && <span className="pre">{props.prefix}</span>}
      {input}
      {props.suffix && <span className="suf">{props.suffix}</span>}
    </div>
  )
}

export function SearchInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; style?: React.CSSProperties }) {
  return (
    <div className="search" style={props.style}>
      <Icon name="search" size={16} />
      <input className="input" value={props.value} placeholder={props.placeholder} autoFocus={props.autoFocus} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  )
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <span className="switch">
        <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
        <span />
      </span>
      {props.label}
    </label>
  )
}

/** Segmented control with a sliding thumb. */
export function Segmented<T extends string>(props: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; ariaLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button.on')
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
  }, [props.value, props.options.length])
  return (
    <div className="seg" ref={ref} role="radiogroup" aria-label={props.ariaLabel}>
      {thumb && <span className="seg-thumb" style={{ left: thumb.left, width: thumb.width }} />}
      {props.options.map((o) => (
        <button key={o.value} role="radio" aria-checked={props.value === o.value} className={props.value === o.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Tabs with an animated underline. */
export function Tabs<T extends string>(props: { tabs: { id: T; label: string; icon?: IconName; count?: number }[]; value: T; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button.on')
    if (el) setInk({ left: el.offsetLeft, width: el.offsetWidth })
  }, [props.value, props.tabs.length])
  return (
    <div className="tabs" ref={ref} role="tablist">
      {props.tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={props.value === t.id} className={props.value === t.id ? 'on' : ''} onClick={() => props.onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="badge warn">{t.count}</span>}
        </button>
      ))}
      {ink && <span className="ink" style={{ left: ink.left, width: ink.width }} />}
    </div>
  )
}

export function PageHeader(props: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="titles">
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  )
}

export function Kpi(props: { icon: IconName; label: string; value: ReactNode; foot?: ReactNode; tone?: 'brand' | 'good' | 'warn' | 'bad'; onClick?: () => void }) {
  return (
    <div className={'card kpi ' + (props.tone ?? '') + (props.onClick ? ' interactive' : '')} onClick={props.onClick} role={props.onClick ? 'button' : undefined} tabIndex={props.onClick ? 0 : undefined}>
      <div className="label">
        <span className="ico">
          <Icon name={props.icon} size={15} />
        </span>
        {props.label}
      </div>
      <div className="value num">{typeof props.value === 'string' || typeof props.value === 'number' ? <CountUp text={String(props.value)} /> : props.value}</div>
      {props.foot && <div className="foot">{props.foot}</div>}
    </div>
  )
}

/** Animates the first number inside a formatted string (e.g. "৳12,345.50") from 0 up to its value. */
export function CountUp({ text, ms = 650 }: { text: string; ms?: number }) {
  const m = text.match(/-?\d[\d,]*(\.\d+)?/)
  const target = m ? Number(m[0].replace(/,/g, '')) : NaN
  const [shown, setShown] = useState(text)
  useEffect(() => {
    if (!m || !isFinite(target) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text)
      return
    }
    const decimals = m[1] ? m[1].length - 1 : 0
    const grouped = m[0].includes(',')
    const fmt = (v: number) => {
      const s = v.toFixed(decimals)
      if (!grouped) return s
      const [i, d] = s.split('.')
      return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '')
    }
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(text.replace(m[0], fmt(target * eased)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  return <>{shown}</>
}

export function Delta({ now, before, suffix = 'vs yesterday' }: { now: number; before: number; suffix?: string }) {
  if (!before && !now) return <span className="subtle">No sales yet</span>
  if (!before) return (<><span className="delta up">new</span> {suffix}</>)
  const pct = ((now - before) / before) * 100
  const cls = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down'
  return (
    <>
      <span className={'delta ' + cls}>
        {cls !== 'flat' && <Icon name={pct > 0 ? 'up' : 'down'} size={12} stroke={2.5} />}
        {Math.abs(pct).toFixed(0)}%
      </span>{' '}
      {suffix}
    </>
  )
}

// ---------- Retail-specific bits ----------

const COLOR_HEX: Record<string, string> = {
  black: '#1b1b1f', white: '#ffffff', 'off white': '#f4f1e8', cream: '#f3e9cf', beige: '#d9c4a0', grey: '#9097a1', gray: '#9097a1', silver: '#c0c4ca',
  navy: '#1e2a52', blue: '#2f5fd0', 'sky blue': '#7cc0ef', 'light blue': '#a9d3f5', teal: '#14808a', green: '#2e9a52', olive: '#6f7a32', 'bottle green': '#0f5a3a',
  red: '#d23a35', maroon: '#7a1f2b', pink: '#ec6ea6', purple: '#7346b8', lavender: '#b9a6e6', yellow: '#f2c230', mustard: '#d0a227', orange: '#ef7f2b',
  brown: '#7b4b2a', coffee: '#5a3b26', khaki: '#c2b280', gold: '#c99a2e', peach: '#f7b89a'
}
export function colorHex(name?: string | null): string {
  if (!name) return 'transparent'
  const k = name.trim().toLowerCase()
  if (COLOR_HEX[k]) return COLOR_HEX[k]
  let h = 0
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h} 55% 52%)`
}

export function VariantChips({ size, color }: { size?: string | null; color?: string | null }) {
  if (!size && !color) return <span className="chip">Standard</span>
  return (
    <>
      {size && <span className="chip size">{size}</span>}
      {color && (
        <span className="chip">
          <span className="swatch" style={{ background: colorHex(color) }} />
          {color}
        </span>
      )}
    </>
  )
}

export function StockPill({ qty, reorder }: { qty: number; reorder: number }) {
  if (qty <= 0) return (<span className="badge bad"><span className="dot" />Out · {qty}</span>)
  if (qty <= reorder) return (<span className="badge warn"><span className="dot" />Low · {qty}</span>)
  return (<span className="badge good"><span className="dot" />{qty} in stock</span>)
}

export function StockBar({ qty, reorder }: { qty: number; reorder: number }) {
  const full = Math.max(reorder * 4, 10)
  const pct = Math.max(4, Math.min(100, (qty / full) * 100))
  const color = qty <= 0 ? 'var(--danger-600)' : qty <= reorder ? 'var(--warning-600)' : 'var(--success-600)'
  return (
    <span className="stockbar" title={`${qty} in stock`}>
      <span style={{ width: qty <= 0 ? '100%' : pct + '%', background: qty <= 0 ? 'var(--danger-200)' : color }} />
    </span>
  )
}

export function Thumb({ src, name, size }: { src?: string | null; name?: string; size?: 'sm' | 'lg' }) {
  const [broken, setBroken] = useState(false)
  const initials = (name ?? '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  if (src && !broken) return <img className={'thumb ' + (size ?? '')} src={src} alt="" onError={() => setBroken(true)} />
  return <span className={'thumb ' + (size ?? '')}>{initials}</span>
}

export function Avatar({ name }: { name: string }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return <span className="avatar" style={{ background: `hsl(${h} 50% 34%)` }}>{initials}</span>
}

// ==========================================================================
// Overlays
// ==========================================================================

type Footer = ReactNode | ((close: () => void) => ReactNode)

function useClosable(onClose: () => void) {
  const [closing, setClosing] = useState(false)
  const close = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, 170)
  }, [onClose])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Only the top-most overlay closes.
      const all = document.querySelectorAll('.overlay')
      if (all[all.length - 1] === ref.current) {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [close])
  const ref = useRef<HTMLDivElement>(null)
  return { closing, close, ref }
}

export function Dialog(props: {
  title: ReactNode
  description?: ReactNode
  icon?: IconName
  tone?: 'danger' | 'warn' | 'brand'
  size?: 'sm' | 'md' | 'lg'
  onClose: () => void
  footer?: Footer
  children?: ReactNode
  onSubmit?: () => void
}) {
  const { closing, close, ref } = useClosable(props.onClose)
  const body = (
    <>
      <div className="dialog-head">
        {props.icon && (
          <span className={'tone ' + (props.tone ?? 'brand')}>
            <Icon name={props.icon} size={20} />
          </span>
        )}
        <div className="grow">
          <h2>{props.title}</h2>
          {props.description && <p>{props.description}</p>}
        </div>
        <IconButton icon="x" label="Close" onClick={close} />
      </div>
      {props.children && <div className="dialog-body">{props.children}</div>}
      {props.footer && <div className="dialog-foot">{typeof props.footer === 'function' ? props.footer(close) : props.footer}</div>}
    </>
  )
  return createPortal(
    <div ref={ref} className={'overlay' + (closing ? ' closing' : '')} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {props.onSubmit ? (
        <form
          className={'dialog ' + (props.size ?? '')}
          role="dialog"
          aria-modal="true"
          onSubmit={(e) => {
            e.preventDefault()
            props.onSubmit!()
          }}
        >
          {body}
        </form>
      ) : (
        <div className={'dialog ' + (props.size ?? '')} role="dialog" aria-modal="true">
          {body}
        </div>
      )}
    </div>,
    document.body
  )
}

/** Side sheet: the desktop counterpart of a mobile bottom sheet, for details and long forms. */
export function Sheet(props: { title: ReactNode; description?: ReactNode; onClose: () => void; footer?: Footer; children: ReactNode; wide?: boolean; headerExtra?: ReactNode }) {
  const { closing, close, ref } = useClosable(props.onClose)
  return createPortal(
    <div ref={ref} className={'overlay sheet-host' + (closing ? ' closing' : '')} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={'sheet' + (props.wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="dialog-head">
          <div className="grow">
            <h2>{props.title}</h2>
            {props.description && <p>{props.description}</p>}
          </div>
          {props.headerExtra}
          <IconButton icon="x" label="Close" onClick={close} />
        </div>
        <div className="dialog-body">{props.children}</div>
        {props.footer && <div className="dialog-foot">{typeof props.footer === 'function' ? props.footer(close) : props.footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Confirm(props: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onDone: (ok: boolean) => void }) {
  return (
    <Dialog
      title={props.title}
      description={props.message}
      icon={props.danger ? 'alert' : 'info'}
      tone={props.danger ? 'danger' : 'brand'}
      onClose={() => props.onDone(false)}
      footer={
        <>
          <Button onClick={() => props.onDone(false)}>Cancel</Button>
          <Button variant={props.danger ? 'danger-solid' : 'primary'} onClick={() => props.onDone(true)} autoFocus>
            {props.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  )
}

export function PinPrompt(props: { message: string; onDone: (pin: string | null) => void }) {
  const [pin, setPin] = useState('')
  return (
    <Dialog
      title="Owner approval needed"
      description={props.message}
      icon="shield"
      tone="warn"
      onClose={() => props.onDone(null)}
      onSubmit={() => pin.length >= 4 && props.onDone(pin)}
      footer={
        <>
          <Button onClick={() => props.onDone(null)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={pin.length < 4}>
            Approve
          </Button>
        </>
      }
    >
      <Field label="Owner PIN">
        <input className="input lg" type="password" inputMode="numeric" autoFocus maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: '0.4em', textAlign: 'center' }} />
      </Field>
    </Dialog>
  )
}

// ==========================================================================
// Loading, empty, error
// ==========================================================================

export function Skeleton({ w = '100%', h = 14, r, style }: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return <span className="skel" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: '8px 16px' }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)`, gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Skeleton w={36} h={36} r={8} />
            <div style={{ flex: 1 }}>
              <Skeleton w="70%" />
              <Skeleton w="40%" h={10} style={{ marginTop: 6 }} />
            </div>
          </div>
          {Array.from({ length: cols - 1 }, (_, j) => (
            <Skeleton key={j} w={`${50 + ((i + j) % 3) * 15}%`} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonKpis({ n = 4 }: { n?: number }) {
  return (
    <div className={`grid cols-${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card kpi">
          <Skeleton w={120} h={14} />
          <Skeleton w={150} h={28} style={{ marginTop: 4 }} />
          <Skeleton w={90} h={10} />
        </div>
      ))}
    </div>
  )
}

export function EmptyState(props: { icon: IconName; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <span className="ill">
        <Icon name={props.icon} size={26} />
      </span>
      <h3>{props.title}</h3>
      {props.text && <p>{props.text}</p>}
      {props.action && <div className="row">{props.action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error">
      <span className="ill">
        <Icon name="alert" size={26} />
      </span>
      <h3>Couldn't load this</h3>
      <p>{message}</p>
      {onRetry && (
        <div className="row">
          <Button icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

/** Standard loading → error → empty → content flow for a data view. */
export function AsyncView<T>(props: { state: { data: T | null; initial: boolean; error: string | null; reload: () => void }; skeleton?: ReactNode; isEmpty?: (d: T) => boolean; empty?: ReactNode; children: (d: T) => ReactNode }) {
  const { state } = props
  if (state.initial) return <>{props.skeleton ?? <SkeletonRows />}</>
  if (state.error && state.data === null) return <ErrorState message={state.error} onRetry={state.reload} />
  if (state.data === null) return null
  if (props.isEmpty?.(state.data)) return <>{props.empty}</>
  return <>{props.children(state.data)}</>
}

// ==========================================================================
// Barcode and receipt previews (rendered by the main process, identical to print)
// ==========================================================================

const barcodeCache = new Map<string, string>()

export function Barcode({ code, caption }: { code: string; caption?: ReactNode }) {
  const [svg, setSvg] = useState(barcodeCache.get(code) ?? '')
  useEffect(() => {
    if (barcodeCache.has(code)) return setSvg(barcodeCache.get(code)!)
    call<string>('labels.barcodeSvg', { code })
      .then((s) => {
        barcodeCache.set(code, s)
        setSvg(s)
      })
      .catch(() => setSvg(''))
  }, [code])
  return (
    <div className="barcode">
      {svg ? <span style={{ width: '100%', display: 'flex', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton h={54} />}
      <span className="digits">{code}</span>
      {caption}
    </div>
  )
}

/** Shows the exact receipt markup the printer receives, isolated in a shadow root. */
export function ReceiptPreview({ saleId, zoom = 1.15 }: { saleId: string; zoom?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  useEffect(() => {
    let alive = true
    setState('loading')
    call<{ css: string; body: string }>('sales.receiptPreview', { id: saleId })
      .then((r) => {
        if (!alive || !host.current) return
        const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
        root.innerHTML = `<style>${r.css}</style>${r.body}`
        setState('ok')
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [saleId])
  return (
    <div className="receipt-paper">
      {state === 'loading' && (
        <div style={{ padding: 20, width: 300 }}>
          <Skeleton h={20} w="60%" style={{ margin: '0 auto 12px' }} />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} h={12} style={{ marginBottom: 10 }} />
          ))}
        </div>
      )}
      {state === 'error' && <div style={{ padding: 20 }} className="subtle">Preview unavailable.</div>}
      <div ref={host} style={{ zoom }} />
    </div>
  )
}
