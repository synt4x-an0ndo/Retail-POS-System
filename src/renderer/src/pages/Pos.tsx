import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call } from '../api'
import { Icon } from '../icons'
import { Button, Confirm, Dialog, EmptyState, Field, IconButton, NumInput, ReceiptPreview, Segmented, Sheet, Thumb, VariantChips, errMsg, useApp, useGuarded } from '../ui'
import { METHOD_LABEL, imgUrl, round2, tk, uuid } from '../util'

interface Variant {
  id: string
  sku: string
  barcode: string
  sell_price: number
  stock_qty: number
  product_name: string
  size_name: string | null
  color_name: string | null
  image_path?: string | null
}
interface Line {
  variant: Variant
  qty: number
  lineDiscount: number
}
type Method = 'cash' | 'card' | 'bkash' | 'nagad'
interface Pay {
  method: Exclude<Method, 'cash'>
  amount: number
  reference: string
}
interface Done {
  saleId: string
  invoiceNo: string
  change: number
  total: number
  items: number
  method: string
  printError: string | null
}

const PAY: { id: Method; label: string; color: string; mark: string }[] = [
  { id: 'cash', label: 'Cash', color: 'var(--pay-cash)', mark: '৳' },
  { id: 'card', label: 'Card', color: 'var(--pay-card)', mark: '▭' },
  { id: 'bkash', label: 'bKash', color: 'var(--pay-bkash)', mark: 'b' },
  { id: 'nagad', label: 'Nagad', color: 'var(--pay-nagad)', mark: 'N' }
]

// Physical key → character. Reading e.code (not e.key) keeps scans correct even when a Bangla keyboard layout is active.
function charFromCode(code: string): string | null {
  let m = /^Digit(\d)$/.exec(code) || /^Numpad(\d)$/.exec(code)
  if (m) return m[1]
  m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  if (code === 'Minus' || code === 'NumpadSubtract') return '-'
  return null
}

/** Quantity "tick": the number slides in from the direction of the change. */
function bump(button: HTMLElement, dir: 1 | -1) {
  const input = button.parentElement?.querySelector('input')
  input?.animate([{ transform: `translateY(${dir * 40}%)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' })
}

let audio: AudioContext | null = null
function beep(ok: boolean) {
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.frequency.value = ok ? 1400 : 300
    g.gain.value = 0.08
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + (ok ? 0.07 : 0.3))
  } catch {
    /* no sound device */
  }
}

export default function Pos() {
  const { user, notify, settings } = useApp()
  const guarded = useGuarded()
  const [saleId, setSaleId] = useState(uuid)
  const [lines, setLines] = useState<Line[]>([])
  const [billDisc, setBillDisc] = useState(0)
  const [billDiscMode, setBillDiscMode] = useState<'amt' | 'pct'>('amt')
  const [method, setMethod] = useState<Method | 'split'>('cash')
  const [tendered, setTendered] = useState(0)
  const [ref1, setRef1] = useState('')
  const [splits, setSplits] = useState<Pay[]>([{ method: 'card', amount: 0, reference: '' }])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Variant[]>([])
  const [sel, setSel] = useState(0)
  const [miss, setMiss] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [openCarts, setOpenCarts] = useState<any[] | null>(null)
  const [recovered, setRecovered] = useState<any[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [editDisc, setEditDisc] = useState<number | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const scanRef = useRef<HTMLInputElement>(null)
  const tenderRef = useRef<HTMLInputElement>(null)
  const burst = useRef({ chars: '', last: 0 })
  const dirty = useRef(false)

  // ----- Totals (the main process recalculates these from database prices) -----
  const subtotal = round2(lines.reduce((s, l) => s + l.variant.sell_price * l.qty, 0))
  const itemDisc = round2(lines.reduce((s, l) => s + l.lineDiscount, 0))
  const billDiscAmount = round2(billDiscMode === 'pct' ? ((subtotal - itemDisc) * Math.min(100, billDisc)) / 100 : Math.min(billDisc, subtotal - itemDisc))
  const discount = round2(itemDisc + billDiscAmount)
  const total = round2(Math.max(0, subtotal - discount))
  const discPct = subtotal > 0 ? (discount / subtotal) * 100 : 0
  const nonCash = method === 'split' ? round2(splits.reduce((s, p) => s + (p.amount || 0), 0)) : method === 'cash' ? 0 : total
  const cashDue = round2(Math.max(0, total - nonCash))
  const change = round2(Math.max(0, tendered - cashDue))
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)

  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0)

  useEffect(() => {
    call<any[]>('sales.openCarts').then((carts) => setRecovered(carts.filter((c) => c.status === 'draft' && c.lines.length)))
    focusScan()
  }, [])

  // Save the cart as a draft on every change (crash recovery).
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => {
      call('sales.saveDraft', {
        saleId,
        status: 'draft',
        items: lines.map((l) => ({ variantId: l.variant.id, qty: l.qty, lineDiscount: l.lineDiscount })),
        billDiscount: billDiscAmount
      }).catch(() => undefined)
    }, 300)
    return () => clearTimeout(t)
  }, [lines, billDiscAmount, saleId])

  const addVariant = useCallback(
    (v: Variant) => {
      dirty.current = true
      setDone(null)
      setLines((ls) => {
        const i = ls.findIndex((l) => l.variant.id === v.id)
        if (i >= 0) {
          const copy = [...ls]
          copy[i] = { ...copy[i], qty: copy[i].qty + 1 }
          return copy
        }
        return [...ls, { variant: v, qty: 1, lineDiscount: 0 }]
      })
      setFlashId(v.id)
      setTimeout(() => setFlashId((f) => (f === v.id ? null : f)), 650)
      const inCart = lines.find((l) => l.variant.id === v.id)?.qty ?? 0
      if (v.stock_qty - inCart <= 0) notify(`${v.product_name} shows no stock left. Owner approval will be needed.`, 'bad')
      beep(true)
    },
    [lines, notify]
  )

  const scanMiss = () => {
    beep(false)
    setMiss(true)
    setTimeout(() => setMiss(false), 400)
  }

  const handleCode = useCallback(
    async (code: string, isScan: boolean) => {
      code = code.trim()
      if (!code) return
      try {
        const v = await call<Variant | null>('catalog.findBarcode', { code })
        if (v) {
          addVariant(v)
          setQuery('')
          setResults([])
          return
        }
        if (isScan) {
          scanMiss()
          notify(`Barcode ${code} not found. Search by name instead.`, 'bad')
          setQuery('')
          return
        }
        const found = await call<Variant[]>('catalog.searchVariants', { text: code })
        setResults(found)
        setSel(0)
        if (!found.length) {
          scanMiss()
          notify(`Nothing found for "${code}".`, 'bad')
        }
      } catch (e) {
        notify(errMsg(e), 'bad')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addVariant, notify]
  )

  // Live search while typing (not for scanner bursts or long digit runs).
  useEffect(() => {
    if (query.trim().length < 2 || /^\d{6,}$/.test(query.trim())) {
      if (!query.trim()) setResults([])
      return
    }
    const t = setTimeout(() => {
      call<Variant[]>('catalog.searchVariants', { text: query.trim() })
        .then((r) => {
          setResults(r)
          setSel(0)
        })
        .catch(() => undefined)
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  const feedBurst = (e: KeyboardEvent | React.KeyboardEvent): { enter: boolean; code: string; isScan: boolean } | null => {
    const b = burst.current
    const t = performance.now()
    if (e.key === 'Enter') {
      const isScan = b.chars.length >= 4 && t - b.last < 100
      const code = b.chars
      burst.current = { chars: '', last: 0 }
      return { enter: true, code, isScan }
    }
    const ch = charFromCode(e.code)
    if (ch) {
      if (t - b.last > 80) b.chars = ch
      else b.chars += ch
      b.last = t
    }
    return null
  }

  // Scans while focus is not in a text box (e.g. after clicking a button).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el === scanRef.current) return
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || document.querySelector('.overlay')) return
      const r = feedBurst(e)
      if (r?.enter && r.isScan) {
        e.preventDefault()
        handleCode(r.code, true)
        focusScan()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [handleCode])

  const onScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault()
      setSel((s) => Math.min(results.length - 1, s + 1))
      return
    }
    if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
      return
    }
    const r = feedBurst(e)
    if (r?.enter) {
      e.preventDefault()
      if (r.isScan) return handleCode(r.code, true)
      if (results.length && query.trim() && !/^\d{6,}$/.test(query.trim())) {
        addVariant(results[sel])
        setQuery('')
        setResults([])
        return
      }
      handleCode(query, false)
    }
  }

  const setQty = (i: number, qty: number) => {
    dirty.current = true
    const q = Math.max(1, Math.floor(qty) || 1)
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, qty: q, lineDiscount: Math.min(l.lineDiscount, l.variant.sell_price * q) } : l)))
  }
  const removeLine = (id: string) => {
    dirty.current = true
    setLeaving((s) => new Set(s).add(id))
    setTimeout(() => {
      setLines((ls) => ls.filter((l) => l.variant.id !== id))
      setLeaving((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }, 170)
  }

  const resetSale = () => {
    dirty.current = false
    setSaleId(uuid())
    setLines([])
    setBillDisc(0)
    setBillDiscMode('amt')
    setMethod('cash')
    setTendered(0)
    setRef1('')
    setSplits([{ method: 'card', amount: 0, reference: '' }])
    setQuery('')
    setResults([])
    focusScan()
  }

  const loadCart = (c: any) => {
    dirty.current = false
    setSaleId(c.id)
    setLines(c.lines.map((l: any) => ({ variant: l.variant, qty: l.qty, lineDiscount: l.lineDiscount })))
    setBillDisc(c.billDiscount || 0)
    setBillDiscMode('amt')
    setDone(null)
    focusScan()
  }

  const clearCart = async () => {
    setConfirmClear(false)
    await call('sales.discardDraft', { saleId }).catch(() => undefined)
    resetSale()
  }

  const hold = async () => {
    if (!lines.length) return
    await call('sales.saveDraft', {
      saleId,
      status: 'held',
      items: lines.map((l) => ({ variantId: l.variant.id, qty: l.qty, lineDiscount: l.lineDiscount })),
      billDiscount: billDiscAmount
    })
    notify('Cart held. Resume it from "Held carts".', 'good')
    resetSale()
  }

  const showHeld = async () => setOpenCarts(await call<any[]>('sales.openCarts'))

  const validatePayment = (): string | null => {
    if (!lines.length) return 'The cart is empty.'
    if ((method === 'bkash' || method === 'nagad') && !ref1.trim()) return `Enter the ${METHOD_LABEL[method]} transaction ID.`
    if (method === 'split') {
      if (nonCash > total + 0.001) return 'Split amounts are more than the bill.'
      for (const p of splits) if ((p.method === 'bkash' || p.method === 'nagad') && p.amount > 0 && !p.reference.trim()) return `Enter the ${METHOD_LABEL[p.method]} transaction ID.`
    }
    if (cashDue > 0 && tendered + 0.001 < cashDue) return `Enter cash received (at least ${tk(cashDue)}).`
    return null
  }

  const complete = async () => {
    if (busy) return
    const problem = validatePayment()
    if (problem) {
      notify(problem, 'bad')
      if (cashDue > 0 && tendered < cashDue) tenderRef.current?.focus()
      return
    }
    setBusy(true)
    const payments =
      method === 'cash'
        ? []
        : method === 'split'
          ? splits.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: p.amount, reference: p.reference || null }))
          : [{ method, amount: total, reference: ref1 || null }]
    const snapshot = { total, items: itemCount, method: method === 'split' ? 'Split' : METHOD_LABEL[method] }
    const r = await guarded((pin) =>
      call('sales.complete', {
        saleId,
        items: lines.map((l) => ({ variantId: l.variant.id, qty: l.qty, lineDiscount: l.lineDiscount })),
        billDiscount: billDiscAmount,
        payments,
        cashTendered: cashDue > 0 ? tendered : null,
        overridePin: pin,
        print: true
      })
    )
    setBusy(false)
    if (!r) return
    setDone({ saleId: r.saleId, invoiceNo: r.invoiceNo, change: r.change, printError: r.printError, ...snapshot })
    resetSale()
  }

  const reprint = async (id: string) => {
    try {
      await call('sales.reprint', { id })
      notify('Receipt printed.', 'good')
      setDone((d) => (d && d.saleId === id ? { ...d, printError: null } : d))
    } catch (e) {
      notify(errMsg(e), 'bad')
    }
  }

  const openDrawer = async () => {
    const r = await guarded((pin) => call('sales.openDrawer', { overridePin: pin }))
    if (r) notify('Drawer opened.', 'good')
  }

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector('.overlay')) return
      if (e.key === 'F2') {
        e.preventDefault()
        scanRef.current?.focus()
        scanRef.current?.select()
      } else if (e.key === 'F4') {
        e.preventDefault()
        hold()
      } else if (e.key === 'F8') {
        e.preventDefault()
        complete()
      } else if (e.key === 'Escape' && results.length) {
        setResults([])
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const quickCash = useMemo(() => {
    const opts = new Set<number>([cashDue])
    for (const n of [100, 500, 1000]) opts.add(Math.ceil(cashDue / n) * n)
    return [...opts].filter((n) => n > 0).sort((a, b) => a - b).slice(0, 4)
  }, [cashDue])

  const overLimit = discPct > user.discountLimitPct + 1e-9
  const stockShort = lines.some((l) => l.qty > l.variant.stock_qty)

  return (
    <div className="page full">
      <div className="pos">
        <div className="pos-main">
          {recovered.length > 0 && (
            <div className="banner warn">
              <Icon name="history" />
              <span className="grow">
                Unfinished sale from {recovered[0].updatedAt.slice(11, 16)} found · {recovered[0].lines.length} item{recovered[0].lines.length > 1 ? 's' : ''}
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  loadCart(recovered[0])
                  setRecovered(recovered.slice(1))
                }}
              >
                Resume
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  await call('sales.discardDraft', { saleId: recovered[0].id })
                  setRecovered(recovered.slice(1))
                }}
              >
                Discard
              </Button>
            </div>
          )}

          <div className="scan">
            <div className={'scan-box' + (miss ? ' miss' : '')} onClick={() => scanRef.current?.focus()}>
              <Icon name="scan" size={24} />
              <input
                ref={scanRef}
                placeholder="Scan a barcode, or type a product name / SKU"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onScanKey}
                autoFocus
                aria-label="Scan or search"
              />
              <div className="hints">
                <span className="scan-live" title="Ready for scanner" />
                <span className="kbd">F2</span>
              </div>
            </div>
            {results.length > 0 && (
              <div className="results" role="listbox">
                {results.map((v, i) => (
                  <div
                    key={v.id}
                    role="option"
                    aria-selected={i === sel}
                    className={'result' + (i === sel ? ' sel' : '')}
                    onMouseEnter={() => setSel(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addVariant(v)
                      setQuery('')
                      setResults([])
                      focusScan()
                    }}
                  >
                    <Thumb src={v.image_path ? imgUrl(v.image_path) : null} name={v.product_name} size="sm" />
                    <div className="grow">
                      <div className="cell-title truncate">{v.product_name}</div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <VariantChips size={v.size_name} color={v.color_name} />
                        <span className="subtle mono">{v.sku}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="price num">{tk(v.sell_price)}</div>
                      <div className={'subtle'} style={{ color: v.stock_qty <= 0 ? 'var(--danger-600)' : undefined }}>
                        {v.stock_qty <= 0 ? 'Out of stock' : `${v.stock_qty} in stock`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card cart">
            {lines.length === 0 ? (
              <div className="cart-empty">
                {done ? (
                  <div className="done">
                    <div className="ok">
                      <span className="check-anim">
                        <svg width="40" height="40" viewBox="0 0 52 52" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="26" cy="26" r="24" />
                          <path d="M15 27l7 7 15-15" />
                        </svg>
                      </span>
                      <div>
                        <div className="subtle">Sale complete · {done.method}</div>
                        <h2 style={{ fontSize: 22, marginTop: 2 }}>{done.invoiceNo}</h2>
                      </div>
                      <div className="row" style={{ gap: 24 }}>
                        <div>
                          <div className="subtle">Total</div>
                          <b style={{ fontSize: 20 }} className="num">{tk(done.total)}</b>
                        </div>
                        <div>
                          <div className="subtle">Items</div>
                          <b style={{ fontSize: 20 }}>{done.items}</b>
                        </div>
                      </div>
                      {done.change > 0 && (
                        <div>
                          <div className="subtle">Give change</div>
                          <div className="big-change num">{tk(done.change)}</div>
                        </div>
                      )}
                      {done.printError ? (
                        <div className="banner warn">
                          <Icon name="printer" /> <span className="grow">Saved, but not printed: {done.printError}</span>
                        </div>
                      ) : (
                        <div className="subtle row" style={{ gap: 6 }}>
                          <Icon name="printer" size={15} /> Receipt sent to printer
                        </div>
                      )}
                      <div className="row">
                        <Button icon="printer" onClick={() => reprint(done.saleId)}>
                          {done.printError ? 'Try printing again' : 'Print again'}
                        </Button>
                        <Button variant="primary" icon="scan" onClick={() => (setDone(null), focusScan())}>
                          New sale
                        </Button>
                      </div>
                      <p className="subtle">Scan the next item at any time. This screen clears itself.</p>
                    </div>
                    <ReceiptPreview saleId={done.saleId} />
                  </div>
                ) : (
                  <div className="ready">
                    <span className="ring">
                      <Icon name="scan" size={40} stroke={1.6} />
                    </span>
                    <h2>Ready to scan</h2>
                    <p>Scan a tag, or type a product name or SKU.</p>
                    <div className="keys subtle">
                      <span><span className="kbd">F2</span> Search</span>
                      <span><span className="kbd">F4</span> Hold</span>
                      <span><span className="kbd">F8</span> Charge</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="cart-head">
                  <span>Item · {itemCount} pcs</span>
                  <span className="col-price" style={{ textAlign: 'right' }}>Price</span>
                  <span style={{ textAlign: 'center' }}>Qty</span>
                  <span className="col-disc" style={{ textAlign: 'right' }}>Discount</span>
                  <span style={{ textAlign: 'right' }}>Total</span>
                  <span />
                </div>
                {lines.map((l, i) => (
                  <div key={l.variant.id} className={'cart-line' + (flashId === l.variant.id ? ' flash' : '') + (leaving.has(l.variant.id) ? ' leaving' : '')}>
                    <div className="row nowrap" style={{ gap: 12, minWidth: 0 }}>
                      <Thumb src={l.variant.image_path ? imgUrl(l.variant.image_path) : null} name={l.variant.product_name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div className="name truncate">{l.variant.product_name}</div>
                        <div className="meta">
                          <VariantChips size={l.variant.size_name} color={l.variant.color_name} />
                          <span className="subtle mono">{l.variant.sku}</span>
                          <span className="narrow subtle num">{tk(l.variant.sell_price)} each</span>
                          <button className="linkbtn narrow" onClick={() => setEditDisc(i)} style={{ fontSize: 12.5, color: l.lineDiscount > 0 ? 'var(--danger-600)' : undefined }}>
                            {l.lineDiscount > 0 ? '−' + tk(l.lineDiscount) : '+ Discount'}
                          </button>
                          {l.qty > l.variant.stock_qty && (
                            <span className="lowstock-flag">
                              <Icon name="alert" size={13} /> only {l.variant.stock_qty} in stock
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="num col-price" style={{ textAlign: 'right' }}>{tk(l.variant.sell_price)}</span>
                    <span style={{ display: 'flex', justifyContent: 'center' }}>
                      <span className="stepper-q">
                        <button
                          aria-label="Decrease"
                          onClick={(e) => {
                            bump(e.currentTarget, 1)
                            l.qty > 1 ? setQty(i, l.qty - 1) : removeLine(l.variant.id)
                          }}
                        >
                          <Icon name="minus" size={15} />
                        </button>
                        <input
                          value={l.qty}
                          aria-label="Quantity"
                          inputMode="numeric"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/\D/g, ''))
                            if (n > 0) setQty(i, n)
                          }}
                        />
                        <button
                          aria-label="Increase"
                          onClick={(e) => {
                            bump(e.currentTarget, -1)
                            setQty(i, l.qty + 1)
                          }}
                        >
                          <Icon name="plus" size={15} />
                        </button>
                      </span>
                    </span>
                    <span className="col-disc" style={{ textAlign: 'right' }}>
                      <button className="linkbtn" onClick={() => setEditDisc(i)} style={{ color: l.lineDiscount > 0 ? 'var(--danger-600)' : undefined }}>
                        {l.lineDiscount > 0 ? '−' + tk(l.lineDiscount) : '+ Discount'}
                      </button>
                    </span>
                    <b className="num" style={{ textAlign: 'right' }}>{tk(l.variant.sell_price * l.qty - l.lineDiscount)}</b>
                    <IconButton icon="trash" label="Remove item" danger onClick={() => removeLine(l.variant.id)} />
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="row">
            <Button icon="pause" onClick={hold} disabled={!lines.length}>
              Hold <span className="kbd">F4</span>
            </Button>
            <Button icon="history" onClick={showHeld}>
              Held carts
            </Button>
            <Button icon="trash" variant="ghost" onClick={() => setConfirmClear(true)} disabled={!lines.length}>
              Clear
            </Button>
            <span className="grow" />
            {settings.drawer_enabled === '1' && (
              <Button icon="drawer" variant="ghost" onClick={openDrawer}>
                Open drawer
              </Button>
            )}
          </div>
        </div>

        <aside className="pos-side">
          <div className="card card-pad summary">
            <div className="row between" style={{ marginBottom: 8 }}>
              <h2>Order summary</h2>
              <span className="badge">{itemCount} items</span>
            </div>
            <div className="line">
              <span>Subtotal</span>
              <b className="num">{tk(subtotal)}</b>
            </div>
            {itemDisc > 0 && (
              <div className="line">
                <span>Item discounts</span>
                <b className="num" style={{ color: 'var(--danger-600)' }}>−{tk(itemDisc)}</b>
              </div>
            )}
            <div className="line" style={{ gap: 10 }}>
              <span>Bill discount</span>
              <span className="row nowrap" style={{ gap: 6 }}>
                <NumInput value={billDisc} onChange={(n) => ((dirty.current = true), setBillDisc(Math.max(0, n)))} style={{ width: 96, height: 32 }} ariaLabel="Bill discount" />
                <Segmented
                  value={billDiscMode}
                  onChange={(v) => ((dirty.current = true), setBillDiscMode(v))}
                  options={[
                    { value: 'amt', label: '৳' },
                    { value: 'pct', label: '%' }
                  ]}
                />
              </span>
            </div>
            {billDiscAmount > 0 && billDiscMode === 'pct' && (
              <div className="line">
                <span className="subtle">Bill discount amount</span>
                <span className="num" style={{ color: 'var(--danger-600)' }}>−{tk(billDiscAmount)}</span>
              </div>
            )}
            {(overLimit || stockShort) && (
              <div className="banner warn" style={{ marginTop: 8, padding: '8px 12px', fontSize: 13 }}>
                <Icon name="shield" size={16} />
                <span>{overLimit ? `Discount ${discPct.toFixed(1)}% is above your ${user.discountLimitPct}% limit.` : 'Some items exceed stock.'} Owner PIN needed.</span>
              </div>
            )}
            <div className="total">
              <span>Total</span>
              <b className="num">{tk(total)}</b>
            </div>
          </div>

          <div className="card card-pad stack" style={{ gap: 14 }}>
            <div className="row between">
              <h2>Payment</h2>
              <button className={'linkbtn'} onClick={() => setMethod(method === 'split' ? 'cash' : 'split')}>
                {method === 'split' ? 'Single payment' : 'Split payment'}
              </button>
            </div>
            {method !== 'split' && (
              <div className="paytiles" role="radiogroup" aria-label="Payment method">
                {PAY.map((p) => (
                  <button key={p.id} role="radio" aria-checked={method === p.id} className={'paytile' + (method === p.id ? ' on' : '')} style={{ ['--pc' as any]: p.color }} onClick={() => setMethod(p.id)}>
                    <span className="pi" style={{ background: p.color }}>{p.mark}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {(method === 'card' || method === 'bkash' || method === 'nagad') && (
              <Field label={method === 'card' ? 'Approval code / last 4 digits' : `${METHOD_LABEL[method]} transaction ID`} optional={method === 'card'}>
                <input className="input" value={ref1} onChange={(e) => setRef1(e.target.value)} placeholder={method === 'card' ? 'e.g. 4821' : 'e.g. 9F7K2L1Q'} />
              </Field>
            )}

            {method === 'split' && (
              <div className="stack tight">
                {splits.map((p, i) => (
                  <div key={i} className="row nowrap" style={{ gap: 6 }}>
                    <select className="select" value={p.method} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, method: e.target.value as Pay['method'] } : x)))} style={{ width: 96 }}>
                      <option value="card">Card</option>
                      <option value="bkash">bKash</option>
                      <option value="nagad">Nagad</option>
                    </select>
                    <NumInput value={p.amount} onChange={(n) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: n } : x)))} style={{ width: 96 }} ariaLabel="Amount" />
                    <input className="input" placeholder="Txn ID" value={p.reference} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
                    {splits.length > 1 && <IconButton icon="x" label="Remove" onClick={() => setSplits(splits.filter((_, j) => j !== i))} />}
                  </div>
                ))}
                <div className="row between">
                  {splits.length < 3 ? (
                    <button className="linkbtn" onClick={() => setSplits([...splits, { method: 'bkash', amount: 0, reference: '' }])}>
                      + Add payment
                    </button>
                  ) : (
                    <span />
                  )}
                  <span className="subtle">Rest in cash: <b className="num">{tk(cashDue)}</b></span>
                </div>
              </div>
            )}

            {cashDue > 0 && (method === 'cash' || method === 'split') && (
              <>
                <Field label={`Cash received · due ${tk(cashDue)}`}>
                  <NumInput value={tendered} onChange={setTendered} prefix="৳" className="input-xl" inputRef={tenderRef} onEnter={complete} ariaLabel="Cash received" />
                </Field>
                <div className="quick">
                  {quickCash.map((n) => (
                    <button key={n} onClick={() => setTendered(n)}>
                      {n === cashDue ? 'Exact' : tk(n).replace('.00', '')}
                    </button>
                  ))}
                </div>
                {tendered >= cashDue && tendered > 0 && (
                  <div className="change-box">
                    <span>Change</span>
                    <b className="num">{tk(change)}</b>
                  </div>
                )}
              </>
            )}
          </div>

          <Button variant="success" size="xl" block className="charge" onClick={complete} loading={busy} disabled={!lines.length}>
            <span>Charge</span>
            <span className="row nowrap" style={{ gap: 10 }}>
              <span className="amt num">{tk(total)}</span>
              <span className="kbd">F8</span>
            </span>
          </Button>
        </aside>
      </div>

      {editDisc !== null && lines[editDisc] && (
        <LineDiscount
          line={lines[editDisc]}
          onClose={() => {
            setEditDisc(null)
            focusScan()
          }}
          onSave={(amt) => {
            dirty.current = true
            setLines((ls) => ls.map((l, j) => (j === editDisc ? { ...l, lineDiscount: amt } : l)))
            setEditDisc(null)
            focusScan()
          }}
        />
      )}
      {confirmClear && <Confirm title="Clear this cart?" message="All items in the current cart will be removed." confirmLabel="Clear cart" danger onDone={(ok) => (ok ? clearCart() : setConfirmClear(false))} />}
      {openCarts && (
        <Sheet title="Held & unfinished carts" description="Resume a cart to continue the sale." onClose={() => (setOpenCarts(null), focusScan())}>
          {openCarts.filter((c) => c.id !== saleId).length === 0 ? (
            <EmptyState icon="pause" title="No held carts" text="Press F4 during a sale to park it here and serve the next customer." />
          ) : (
            <div className="stack">
              {lines.length > 0 && (
                <div className="banner info">
                  <Icon name="info" /> Hold or clear the current cart before resuming another.
                </div>
              )}
              {openCarts
                .filter((c) => c.id !== saleId)
                .map((c) => {
                  const amount = c.lines.reduce((s: number, l: any) => s + l.qty * l.variant.sell_price - l.lineDiscount, 0) - (c.billDiscount || 0)
                  return (
                    <div key={c.id} className="card card-pad stack tight">
                      <div className="row between">
                        <div className="row" style={{ gap: 8 }}>
                          <span className={'badge ' + (c.status === 'held' ? 'info' : 'warn')}>{c.status === 'held' ? 'Held' : 'Unfinished'}</span>
                          <span className="subtle">{c.updatedAt.slice(0, 16)} · {c.cashierName}</span>
                        </div>
                        <b className="num">{tk(amount)}</b>
                      </div>
                      <div className="subtle">{c.lines.map((l: any) => `${l.variant.product_name} ×${l.qty}`).join(', ') || 'Empty cart'}</div>
                      <div className="row end">
                        <Button
                          size="sm"
                          variant="danger"
                          icon="trash"
                          onClick={async () => {
                            await call('sales.discardDraft', { saleId: c.id })
                            showHeld()
                          }}
                        >
                          Discard
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={lines.length > 0}
                          onClick={() => {
                            loadCart(c)
                            setOpenCarts(null)
                          }}
                        >
                          Resume
                        </Button>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}

function LineDiscount({ line, onClose, onSave }: { line: Line; onClose: () => void; onSave: (amt: number) => void }) {
  const gross = line.variant.sell_price * line.qty
  const [v, setV] = useState(line.lineDiscount)
  const [mode, setMode] = useState<'amt' | 'pct'>('amt')
  const amount = round2(Math.min(gross, mode === 'pct' ? (gross * v) / 100 : v))
  return (
    <Dialog
      title="Item discount"
      description={`${line.variant.product_name} · ${line.qty} × ${tk(line.variant.sell_price)} = ${tk(gross)}`}
      icon="percent"
      onClose={onClose}
      onSubmit={() => onSave(amount)}
      footer={
        <>
          {line.lineDiscount > 0 && (
            <Button variant="ghost" onClick={() => onSave(0)} style={{ marginRight: 'auto' }}>
              Remove discount
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit">
            Apply −{tk(amount)}
          </Button>
        </>
      }
    >
      <div className="row nowrap">
        <NumInput value={v} onChange={setV} autoFocus prefix={mode === 'amt' ? '৳' : undefined} suffix={mode === 'pct' ? '%' : undefined} style={{ flex: 1 }} />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'amt', label: 'Amount' },
            { value: 'pct', label: 'Percent' }
          ]}
        />
      </div>
      <div className="row" style={{ marginTop: 12, gap: 6 }}>
        {[5, 10, 15, 20].map((p) => (
          <button key={p} type="button" className="pickchip" onClick={() => (setMode('pct'), setV(p))}>
            {p}%
          </button>
        ))}
      </div>
      <p className="subtle" style={{ marginTop: 12 }}>New line total: <b className="num">{tk(gross - amount)}</b></p>
    </Dialog>
  )
}
