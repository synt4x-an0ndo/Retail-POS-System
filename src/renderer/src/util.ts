export const tk = (n: number | null | undefined) =>
  '৳' + Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-IN')

export const pad = (n: number) => String(n).padStart(2, '0')

export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const monthStr = () => todayStr().slice(0, 7)

export const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86400000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const firstOfMonth = () => todayStr().slice(0, 8) + '01'

export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', bkash: 'bKash', nagad: 'Nagad' }

export const variantLabel = (v: { size_name?: string | null; color_name?: string | null }) =>
  [v.size_name, v.color_name].filter(Boolean).join(' / ')

export const imgUrl = (file?: string | null) => (file ? `posimg://img/${file}` : '')

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const uuid = () => crypto.randomUUID()
