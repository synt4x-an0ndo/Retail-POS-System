import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { Icon } from '../icons'
import {
  AsyncView,
  Barcode,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  NumInput,
  PageHeader,
  SearchInput,
  Segmented,
  Sheet,
  SkeletonRows,
  StockBar,
  StockPill,
  Switch,
  Tabs,
  Thumb,
  VariantChips,
  colorHex,
  errMsg,
  useApp,
  useAsync,
  useDebounced
} from '../ui'
import { imgUrl, num, tk, variantLabel } from '../util'

interface Lookups {
  categories: { id: string; name: string; code: string; parent_id: string | null; parent_name: string | null; active: number }[]
  sizes: { id: string; name: string; code: string }[]
  colors: { id: string; name: string; code: string }[]
}

export const categoryLabel = (c: Lookups['categories'][number]) => (c.parent_name ? `${c.parent_name} › ${c.name}` : c.name)

export default function Products({ params }: { params?: Record<string, any> }) {
  const { can } = useApp()
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState<'active' | 'all'>('active')
  const [lowOnly, setLowOnly] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(params?.edit ?? null)
  const [labelsFor, setLabelsFor] = useState<string | null>(null)
  const lookups = useAsync<Lookups>(() => call('catalog.lookups'), [])
  const list = useAsync<any[]>(() => call('catalog.products', { search: q.trim() || undefined, categoryId: categoryId || null, includeArchived: status === 'all' }), [q, categoryId, status])
  const rows = useMemo(() => (list.data ?? []).filter((p) => !lowOnly || p.low_count > 0), [list.data, lowOnly])

  return (
    <div className="page">
      <PageHeader
        title="Products"
        subtitle="Every style with its sizes, colours, prices and barcodes."
        actions={
          can('product.manage') && (
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              New product
            </Button>
          )
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, brand, SKU or barcode" />
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ width: 220 }} aria-label="Category">
            <option value="">All categories</option>
            {lookups.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'all', label: 'Incl. archived' }
            ]}
          />
          <Switch checked={lowOnly} onChange={setLowOnly} label="Low stock only" />
          <span className="grow" />
          <span className="subtle">{rows.length} products</span>
        </div>
        <AsyncView
          state={list}
          skeleton={<SkeletonRows rows={7} cols={6} />}
          isEmpty={() => rows.length === 0}
          empty={
            q || categoryId || lowOnly ? (
              <EmptyState icon="search" title="No matching products" text="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                icon="tag"
                title="Add your first product"
                text="Create a style, pick its sizes and colours, and the POS generates SKUs and barcodes for each."
                action={
                  can('product.manage') && (
                    <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
                      New product
                    </Button>
                  )
                }
              />
            )
          }
        >
          {() => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Sizes & colours</th>
                    <th className="r">Price</th>
                    <th>Stock</th>
                    <th className="tight" />
                  </tr>
                </thead>
                <tbody className="rows-in">
                  {rows.map((p) => {
                    const colors = (p.color_names ?? '').split(',').filter(Boolean)
                    const sizes = (p.size_names ?? '').split(',').filter(Boolean)
                    return (
                      <tr key={p.id} className="click" onClick={() => setViewing(p.id)}>
                        <td>
                          <div className="row nowrap" style={{ gap: 12 }}>
                            <Thumb src={p.image_path ? imgUrl(p.image_path) : null} name={p.name} />
                            <div style={{ minWidth: 0 }}>
                              <div className="cell-title truncate" style={{ maxWidth: 320 }}>
                                {p.name} {!p.active && <span className="badge">Archived</span>}
                              </div>
                              <div className="cell-sub">
                                #{String(p.product_no).padStart(4, '0')}
                                {p.brand && ` · ${p.brand}`}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="muted">{p.category_name ?? '—'}</td>
                        <td>
                          <div className="row nowrap" style={{ gap: 4 }}>
                            {colors.slice(0, 6).map((c: string) => (
                              <span key={c} className="swatch" title={c} style={{ background: colorHex(c), width: 14, height: 14 }} />
                            ))}
                            <span className="subtle" style={{ marginLeft: 6 }}>
                              {sizes.length ? sizes.slice(0, 5).join(' · ') : `${p.variant_count} variant${p.variant_count === 1 ? '' : 's'}`}
                              {sizes.length > 5 ? ' …' : ''}
                            </span>
                          </div>
                        </td>
                        <td className="r num">{p.min_price === p.max_price ? tk(p.min_price) : `${tk(p.min_price)} – ${tk(p.max_price)}`}</td>
                        <td>
                          <div className="row nowrap" style={{ gap: 10 }}>
                            <b className="num" style={{ width: 36 }}>{num(p.total_stock)}</b>
                            <StockBar qty={p.total_stock} reorder={p.variant_count * 2} />
                            {p.low_count > 0 && <span className="badge warn">{p.low_count} low</span>}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="row nowrap" style={{ gap: 2 }}>
                            {can('label.print') && <IconButton icon="printer" label="Print labels" onClick={() => setLabelsFor(p.id)} />}
                            {can('product.manage') && <IconButton icon="edit" label="Edit" onClick={() => setEditing(p.id)} />}
                          </div>
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

      {viewing && (
        <ProductDetail
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
          onLabels={() => {
            setLabelsFor(viewing)
            setViewing(null)
          }}
        />
      )}
      {editing && lookups.data && (
        <ProductEditor
          id={editing === 'new' ? null : editing}
          lookups={lookups.data}
          onClose={() => setEditing(null)}
          onSaved={(id, printLabels) => {
            setEditing(null)
            list.reload()
            if (printLabels) setLabelsFor(id)
          }}
        />
      )}
      {labelsFor && <LabelPrinter productId={labelsFor} onClose={() => setLabelsFor(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ProductDetail({ id, onClose, onEdit, onLabels }: { id: string; onClose: () => void; onEdit: () => void; onLabels: () => void }) {
  const { can } = useApp()
  const p = useAsync<any>(() => call('catalog.product', { id }), [id])
  const [tab, setTab] = useState<'variants' | 'barcodes'>('variants')
  const d = p.data
  return (
    <Sheet
      wide
      title={d?.name ?? 'Product'}
      description={d ? `#${String(d.product_no).padStart(4, '0')}${d.brand ? ' · ' + d.brand : ''}` : undefined}
      onClose={onClose}
      footer={
        <>
          {can('label.print') && (
            <Button icon="printer" onClick={onLabels}>
              Print labels
            </Button>
          )}
          {can('product.manage') && (
            <Button variant="primary" icon="edit" onClick={onEdit}>
              Edit product
            </Button>
          )}
        </>
      }
    >
      <AsyncView state={p} skeleton={<SkeletonRows rows={5} cols={4} />}>
        {(d) => {
          const stock = d.variants.reduce((s: number, v: any) => s + v.stock_qty, 0)
          const low = d.variants.filter((v: any) => v.stock_qty <= v.reorder_level).length
          return (
            <div className="stack" style={{ gap: 20 }}>
              <div className="row nowrap" style={{ gap: 20, alignItems: 'flex-start' }}>
                <Thumb src={d.image_path ? imgUrl(d.image_path) : null} name={d.name} size="lg" />
                <div className="grid cols-3 grow">
                  <div className="card kpi">
                    <div className="label">In stock</div>
                    <div className="value num">{num(stock)}</div>
                  </div>
                  <div className="card kpi">
                    <div className="label">Variants</div>
                    <div className="value num">{d.variants.length}</div>
                  </div>
                  <div className={'card kpi ' + (low ? 'warn' : '')}>
                    <div className="label">Low / out</div>
                    <div className="value num">{low}</div>
                  </div>
                  {d.description && <p className="muted span-2" style={{ gridColumn: 'span 3' }}>{d.description}</p>}
                  <div style={{ gridColumn: 'span 3' }}>
                    {d.active ? <span className="badge good"><span className="dot" />Active</span> : <span className="badge">Archived</span>}
                  </div>
                </div>
              </div>
              <div>
                <Tabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { id: 'variants', label: 'Sizes & colours', icon: 'layers' },
                    { id: 'barcodes', label: 'Barcodes', icon: 'scan' }
                  ]}
                />
                {tab === 'variants' ? (
                  <div className="card">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Variant</th>
                          <th>SKU</th>
                          <th className="r">Price</th>
                          <th>Stock</th>
                        </tr>
                      </thead>
                      <tbody className="rows-in">
                        {d.variants.map((v: any) => (
                          <tr key={v.id} style={{ opacity: v.active ? 1 : 0.5 }}>
                            <td>
                              <div className="row" style={{ gap: 6 }}>
                                <VariantChips size={v.size_name} color={v.color_name} />
                              </div>
                            </td>
                            <td className="mono">{v.sku}</td>
                            <td className="r num">{tk(v.sell_price)}</td>
                            <td>
                              <StockPill qty={v.stock_qty} reorder={v.reorder_level} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="variant-grid">
                    {d.variants.map((v: any) => (
                      <div key={v.id} className="card card-pad stack tight">
                        <div className="row" style={{ gap: 6 }}>
                          <VariantChips size={v.size_name} color={v.color_name} />
                          <span className="grow" />
                          <b className="num">{tk(v.sell_price)}</b>
                        </div>
                        <Barcode code={v.barcode} />
                        {v.extra_barcodes?.length > 0 && <span className="subtle">Maker code: <span className="mono">{v.extra_barcodes.join(', ')}</span></span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        }}
      </AsyncView>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

interface VRow {
  id?: string
  sizeId: string | null
  colorId: string | null
  costPrice: number
  sellPrice: number
  reorderLevel: number
  openingQty: number
  extraBarcode: string
  active: boolean
  sku?: string
  barcode?: string
  stock_qty?: number
}

function ProductEditor(props: { id: string | null; lookups: Lookups; onClose: () => void; onSaved: (id: string, printLabels: boolean) => void }) {
  const { notify, settings, go } = useApp()
  const { sizes, colors, categories } = props.lookups
  const [p, setP] = useState({ name: '', brand: '', description: '', categoryId: '', imagePath: '' as string | null, active: true })
  const [rows, setRows] = useState<VRow[]>([])
  const [pickSizes, setPickSizes] = useState<string[]>([])
  const [pickColors, setPickColors] = useState<string[]>([])
  const [bulk, setBulk] = useState({ cost: 0, price: 0, qty: 0 })
  const [busy, setBusy] = useState<false | 'save' | 'labels'>(false)
  const [loaded, setLoaded] = useState(!props.id)
  const [tried, setTried] = useState(false)
  const reorderDefault = Number(settings.low_stock_default) || 2

  useEffect(() => {
    if (!props.id) return
    call('catalog.product', { id: props.id }).then((d: any) => {
      setP({ name: d.name, brand: d.brand ?? '', description: d.description ?? '', categoryId: d.category_id ?? '', imagePath: d.image_path, active: !!d.active })
      setRows(
        d.variants.map((v: any) => ({
          id: v.id,
          sizeId: v.size_id,
          colorId: v.color_id,
          costPrice: v.cost_price ?? 0,
          sellPrice: v.sell_price,
          reorderLevel: v.reorder_level,
          openingQty: 0,
          extraBarcode: v.extra_barcodes?.[0] ?? '',
          active: !!v.active,
          sku: v.sku,
          barcode: v.barcode,
          stock_qty: v.stock_qty
        }))
      )
      setLoaded(true)
    })
  }, [props.id])

  const nameOf = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? null
  const combos = Math.max(1, pickSizes.length) * Math.max(1, pickColors.length)

  const addCombos = () => {
    const ss = pickSizes.length ? pickSizes : [null]
    const cs = pickColors.length ? pickColors : [null]
    const next = [...rows]
    let added = 0
    for (const c of cs)
      for (const s of ss) {
        if (next.some((r) => r.sizeId === s && r.colorId === c)) continue
        next.push({ sizeId: s, colorId: c, costPrice: bulk.cost, sellPrice: bulk.price, reorderLevel: reorderDefault, openingQty: bulk.qty, extraBarcode: '', active: true })
        added++
      }
    setRows(next)
    setPickSizes([])
    setPickColors([])
    if (!added) notify('Those size/colour combinations are already listed.', 'info')
  }

  const upd = (i: number, patch: Partial<VRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const applyAll = (patch: Partial<VRow>) => setRows(rows.map((r) => ({ ...r, ...patch })))

  const pickImage = async () => {
    try {
      const f = await call<string | null>('catalog.pickImage')
      if (f) setP({ ...p, imagePath: f })
    } catch (e) {
      notify(errMsg(e), 'bad')
    }
  }

  const nameError = tried && !p.name.trim() ? 'Enter a product name.' : null
  const save = async (printLabels: boolean) => {
    setTried(true)
    if (!p.name.trim()) return
    if (!rows.length) return notify('Add at least one size/colour variant.', 'bad')
    if (rows.some((r) => r.sellPrice <= 0)) return notify('Every variant needs a selling price.', 'bad')
    setBusy(printLabels ? 'labels' : 'save')
    try {
      const saved: any = await call('catalog.saveProduct', {
        id: props.id,
        name: p.name.trim(),
        brand: p.brand.trim() || null,
        description: p.description.trim() || null,
        categoryId: p.categoryId || null,
        imagePath: p.imagePath || null,
        active: p.active,
        variants: rows.map((r) => ({
          id: r.id ?? null,
          sizeId: r.sizeId,
          colorId: r.colorId,
          costPrice: r.costPrice,
          sellPrice: r.sellPrice,
          reorderLevel: r.reorderLevel,
          openingQty: r.id ? undefined : r.openingQty,
          extraBarcode: r.extraBarcode.trim() || null,
          active: r.active
        }))
      })
      notify(props.id ? 'Product updated.' : `Product created with ${saved.variants.length} barcodes.`, 'good')
      props.onSaved(saved.id, printLabels)
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      size="lg"
      title={props.id ? 'Edit product' : 'New product'}
      description={props.id ? 'Prices and details. Stock changes go through Inventory so every change is recorded.' : 'SKUs and barcodes are generated automatically for each size and colour.'}
      onClose={props.onClose}
      footer={(close) => (
        <>
          <Button variant="ghost" onClick={close} style={{ marginRight: 'auto' }}>
            Cancel
          </Button>
          <Button icon="printer" onClick={() => save(true)} loading={busy === 'labels'} disabled={!!busy || !loaded}>
            Save & print labels
          </Button>
          <Button variant="primary" icon="check" onClick={() => save(false)} loading={busy === 'save'} disabled={!!busy || !loaded}>
            Save product
          </Button>
        </>
      )}
    >
      {!loaded ? (
        <SkeletonRows rows={4} cols={3} />
      ) : (
        <div className="stack" style={{ gap: 24 }}>
          <div className="row nowrap" style={{ alignItems: 'flex-start', gap: 20 }}>
            <div className="stack tight" style={{ alignItems: 'center' }}>
              <button className="photo-drop" onClick={pickImage} aria-label="Choose photo">
                {p.imagePath ? (
                  <img src={imgUrl(p.imagePath)} alt="" />
                ) : (
                  <span className="stack tight" style={{ alignItems: 'center' }}>
                    <Icon name="image" size={26} />
                    Add photo
                  </span>
                )}
              </button>
              {p.imagePath && (
                <button className="linkbtn" style={{ fontSize: 13 }} onClick={() => setP({ ...p, imagePath: null })}>
                  Remove photo
                </button>
              )}
            </div>
            <div className="grid cols-2 grow">
              <Field label="Product name" error={nameError}>
                <input className={'input' + (nameError ? ' invalid' : '')} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} autoFocus placeholder="e.g. Oxford Cotton Shirt" />
              </Field>
              <Field label="Brand" optional>
                <input className="input" value={p.brand} onChange={(e) => setP({ ...p, brand: e.target.value })} />
              </Field>
              <Field
                label="Category"
                hint={
                  categories.length ? undefined : (
                    <button className="linkbtn" onClick={() => (props.onClose(), go('settings', { tab: 'catalogue' }))}>
                      Add categories in Settings → Catalogue
                    </button>
                  )
                }
              >
                <select className="select" value={p.categoryId} onChange={(e) => setP({ ...p, categoryId: e.target.value })}>
                  <option value="">No category</option>
                  {categories
                    .filter((c) => c.active || c.id === p.categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Status" group>
                <div style={{ height: 38, display: 'flex', alignItems: 'center' }}>
                  <Switch checked={p.active} onChange={(v) => setP({ ...p, active: v })} label={p.active ? 'Active – available for sale' : 'Archived – hidden from billing'} />
                </div>
              </Field>
              <Field label="Description" optional style={{ gridColumn: 'span 2' }}>
                <input className="input" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} placeholder="Fabric, fit, care notes…" />
              </Field>
            </div>
          </div>

          <div className="builder">
            <div className="section-title">Add sizes & colours</div>
            {!sizes.length && !colors.length ? (
              <div className="banner info">
                <Icon name="info" />
                <span className="grow">No sizes or colours yet. Add them once in Settings → Catalogue, or add a single standard variant now.</span>
                <Button size="sm" onClick={() => (props.onClose(), go('settings', { tab: 'catalogue' }))}>
                  Open catalogue
                </Button>
              </div>
            ) : (
              <div className="grid cols-2">
                <div>
                  <div className="subtle" style={{ marginBottom: 8 }}>Sizes</div>
                  <div className="row" style={{ gap: 6 }}>
                    {sizes.map((s) => (
                      <button key={s.id} className={'pickchip' + (pickSizes.includes(s.id) ? ' on' : '')} onClick={() => setPickSizes(pickSizes.includes(s.id) ? pickSizes.filter((x) => x !== s.id) : [...pickSizes, s.id])}>
                        {pickSizes.includes(s.id) && <Icon name="check" size={14} stroke={2.4} />}
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="subtle" style={{ marginBottom: 8 }}>Colours</div>
                  <div className="row" style={{ gap: 6 }}>
                    {colors.map((c) => (
                      <button key={c.id} className={'pickchip' + (pickColors.includes(c.id) ? ' on' : '')} onClick={() => setPickColors(pickColors.includes(c.id) ? pickColors.filter((x) => x !== c.id) : [...pickColors, c.id])}>
                        <span className="swatch" style={{ background: colorHex(c.name) }} />
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="row" style={{ marginTop: 16, alignItems: 'flex-end' }}>
              <Field label="Cost price">
                <NumInput value={bulk.cost} onChange={(n) => setBulk({ ...bulk, cost: n })} prefix="৳" style={{ width: 140 }} />
              </Field>
              <Field label="Selling price">
                <NumInput value={bulk.price} onChange={(n) => setBulk({ ...bulk, price: n })} prefix="৳" style={{ width: 140 }} />
              </Field>
              {!props.id && (
                <Field label="Opening stock each">
                  <NumInput value={bulk.qty} onChange={(n) => setBulk({ ...bulk, qty: Math.floor(n) })} suffix="pcs" style={{ width: 130 }} />
                </Field>
              )}
              <Button variant="primary" icon="plus" onClick={addCombos}>
                Add {combos} variant{combos === 1 ? '' : 's'}
              </Button>
              {bulk.price > 0 && bulk.cost > 0 && <span className="subtle">Margin {(((bulk.price - bulk.cost) / bulk.price) * 100).toFixed(0)}%</span>}
            </div>
          </div>

          <div>
            <div className="row between" style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ margin: 0 }}>Variants · {rows.length}</div>
              {rows.length > 1 && (
                <div className="row" style={{ gap: 6 }}>
                  <span className="subtle">Apply to all:</span>
                  <Button size="sm" onClick={() => rows[0] && applyAll({ sellPrice: rows[0].sellPrice })}>
                    First price
                  </Button>
                  <Button size="sm" onClick={() => rows[0] && applyAll({ costPrice: rows[0].costPrice })}>
                    First cost
                  </Button>
                </div>
              )}
            </div>
            {!rows.length ? (
              <EmptyState icon="layers" title="No variants yet" text="Pick sizes and colours above, set prices, then add them." />
            ) : (
              <div className="card table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Variant</th>
                      <th>SKU / barcode</th>
                      <th>Cost</th>
                      <th>Price</th>
                      <th>Low at</th>
                      <th>{props.id ? 'Stock' : 'Opening'}</th>
                      <th>Maker barcode</th>
                      <th className="tight" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id ?? `${r.sizeId}|${r.colorId}`} style={{ opacity: r.active ? 1 : 0.55 }}>
                        <td>
                          <div className="row nowrap" style={{ gap: 4 }}>
                            <VariantChips size={nameOf(sizes, r.sizeId)} color={nameOf(colors, r.colorId)} />
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {r.sku ? (
                            <>
                              {r.sku}
                              <div className="subtle">{r.barcode}</div>
                            </>
                          ) : (
                            <span className="badge info">Generated on save</span>
                          )}
                        </td>
                        <td>
                          <NumInput value={r.costPrice} onChange={(n) => upd(i, { costPrice: n })} style={{ width: 92 }} />
                        </td>
                        <td>
                          <NumInput value={r.sellPrice} onChange={(n) => upd(i, { sellPrice: n })} style={{ width: 92 }} className={r.sellPrice <= 0 && tried ? 'invalid' : ''} />
                        </td>
                        <td>
                          <NumInput value={r.reorderLevel} onChange={(n) => upd(i, { reorderLevel: Math.floor(n) })} style={{ width: 64 }} />
                        </td>
                        <td>{r.id ? <StockPill qty={r.stock_qty ?? 0} reorder={r.reorderLevel} /> : <NumInput value={r.openingQty} onChange={(n) => upd(i, { openingQty: Math.floor(n) })} style={{ width: 70 }} />}</td>
                        <td>
                          <input className="input" value={r.extraBarcode} onChange={(e) => upd(i, { extraBarcode: e.target.value })} placeholder="optional" style={{ width: 140 }} />
                        </td>
                        <td>
                          {r.id ? (
                            <Switch checked={r.active} onChange={(v) => upd(i, { active: v })} />
                          ) : (
                            <IconButton icon="trash" label="Remove" danger onClick={() => setRows(rows.filter((_, j) => j !== i))} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------

export function LabelPrinter({ productId, purchaseItems, onClose }: { productId?: string; purchaseItems?: { variant_id: string; qty: number; label: string; barcode: string; price?: number }[]; onClose: () => void }) {
  const { notify, settings, go } = useApp()
  const [items, setItems] = useState<{ variantId: string; label: string; barcode: string; price: number; qty: number }[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (purchaseItems) {
      setItems(purchaseItems.map((p) => ({ variantId: p.variant_id, label: p.label, barcode: p.barcode, price: p.price ?? 0, qty: p.qty })))
      return
    }
    if (productId)
      call('catalog.product', { id: productId }).then((d: any) =>
        setItems(
          d.variants
            .filter((v: any) => v.active)
            .map((v: any) => ({ variantId: v.id, label: `${d.name} – ${variantLabel(v) || 'Standard'}`, barcode: v.barcode, price: v.sell_price, qty: Math.max(0, v.stock_qty) }))
        )
      )
  }, [productId, purchaseItems])

  const total = useMemo(() => (items ?? []).reduce((s, i) => s + i.qty, 0), [items])

  const print = async () => {
    if (!items) return
    setBusy(true)
    try {
      const r: any = await call('labels.print', { items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })) })
      notify(`${r.printed} label${r.printed === 1 ? '' : 's'} sent to the printer.`, 'good')
      onClose()
    } catch (e) {
      notify(errMsg(e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      size="md"
      title="Print barcode labels"
      description="One label per garment. Quantities start at the current stock."
      icon="printer"
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="ghost" onClick={close} style={{ marginRight: 'auto' }}>
            Cancel
          </Button>
          <Button variant="primary" icon="printer" onClick={print} loading={busy} disabled={total === 0 || !settings.label_printer}>
            Print {total} label{total === 1 ? '' : 's'}
          </Button>
        </>
      )}
    >
      <div className="stack">
        {!settings.label_printer ? (
          <div className="banner warn">
            <Icon name="printer" />
            <span className="grow">No label printer selected yet.</span>
            <Button size="sm" onClick={() => (onClose(), go('settings', { tab: 'printers' }))}>
              Set up printer
            </Button>
          </div>
        ) : (
          <div className="subtle row" style={{ gap: 6 }}>
            <Icon name="printer" size={15} /> {settings.label_printer} · {settings.label_width_mm} × {settings.label_height_mm} mm
          </div>
        )}
        {!items ? (
          <SkeletonRows rows={4} cols={3} />
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Barcode</th>
                  <th className="r">Price</th>
                  <th>Labels</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.variantId}>
                    <td className="truncate" style={{ maxWidth: 240 }}>{it.label}</td>
                    <td className="mono">{it.barcode}</td>
                    <td className="r num">{it.price ? tk(it.price) : ''}</td>
                    <td>
                      <NumInput value={it.qty} onChange={(n) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Math.floor(n)) } : x)))} style={{ width: 84 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  )
}
