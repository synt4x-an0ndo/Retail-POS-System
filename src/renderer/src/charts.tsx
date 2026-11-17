import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface BarDatum {
  key: string
  label: string
  value: number
  value2?: number
  tip?: ReactNode
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

const short = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)))

/** Vertical bar chart (one or two series) that fills its container width. Bars grow in on mount. */
export function BarChart(props: {
  data: BarDatum[]
  height?: number
  color?: string
  color2?: string
  highlightLast?: boolean
  labelEvery?: number
  ariaLabel: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    if (!wrap.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  const H = props.height ?? 220
  const padL = 40, padB = 26, padT = 10
  const plotW = w - padL - 4
  const plotH = H - padB - padT
  const max = niceMax(Math.max(...props.data.map((d) => Math.max(d.value, d.value2 ?? 0)), 0))
  const n = props.data.length || 1
  const slot = plotW / n
  const two = props.data.some((d) => d.value2 !== undefined)
  const barW = Math.max(4, Math.min(36, slot * (two ? 0.34 : 0.58)))
  const every = props.labelEvery ?? Math.ceil(n / Math.max(1, Math.floor(plotW / 56)))
  const c1 = props.color ?? 'var(--brand-500)'
  const c2 = props.color2 ?? 'var(--success-600)'
  const y = (v: number) => padT + plotH - (v / max) * plotH
  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg className="chart" width={w} height={H} role="img" aria-label={props.ariaLabel}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className="gridline" x1={padL} x2={w - 4} y1={y(max * t)} y2={y(max * t)} strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text className="axis" x={padL - 8} y={y(max * t) + 4} textAnchor="end">
              {short(max * t)}
            </text>
          </g>
        ))}
        {props.data.map((d, i) => {
          const cx = padL + slot * i + slot / 2
          const last = props.highlightLast && i === n - 1
          const dim = hover !== null && hover !== i
          const h1 = Math.max(d.value > 0 ? 2 : 0, plotH - (y(d.value) - padT))
          const h2 = Math.max((d.value2 ?? 0) > 0 ? 2 : 0, plotH - (y(d.value2 ?? 0) - padT))
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ opacity: dim ? 0.55 : 1, transition: 'opacity 120ms' }}>
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill="transparent" />
              <rect className="bar" x={two ? cx - barW - 1 : cx - barW / 2} y={padT + plotH - h1} width={barW} height={h1} rx={Math.min(4, barW / 3)} fill={last || !props.highlightLast ? c1 : 'var(--brand-200)'} style={{ animationDelay: `${i * 18}ms` }} />
              {two && <rect className="bar" x={cx + 1} y={padT + plotH - h2} width={barW} height={h2} rx={Math.min(4, barW / 3)} fill={c2} style={{ animationDelay: `${i * 18 + 60}ms` }} />}
              {(i % every === 0 || i === n - 1) && (
                <text className="axis" x={cx} y={H - 8} textAnchor="middle" fontWeight={last ? 700 : 400}>
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && props.data[hover] && (
        <div className="chart-tip" style={{ left: padL + slot * hover + slot / 2, top: y(Math.max(props.data[hover].value, props.data[hover].value2 ?? 0)) }}>
          {props.data[hover].tip ?? props.data[hover].value}
        </div>
      )}
    </div>
  )
}

/** Ranked horizontal bars. */
export function HBars(props: { items: { key: string; label: ReactNode; value: number; display: ReactNode; color?: string }[]; max?: number }) {
  const max = props.max ?? Math.max(1, ...props.items.map((i) => i.value))
  return (
    <div className="hbars">
      {props.items.map((it, i) => (
        <div className="hbar" key={it.key}>
          <div className="top">
            <span className="truncate">{it.label}</span>
            <b className="num">{it.display}</b>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: it.color ?? 'var(--brand-500)', animationDelay: `${i * 50}ms` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
