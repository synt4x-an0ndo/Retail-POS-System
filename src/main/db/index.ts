import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { MIGRATIONS } from './schema'

let db: DatabaseSync | null = null
let dbPath = ''
let deviceId = ''

export type Row = Record<string, any>

export class AppError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export function uuid(): string {
  return randomUUID()
}

/** Local time as 'YYYY-MM-DD HH:MM:SS' so daily reports group by the shop's own day. */
export function now(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function today(): string {
  return now().slice(0, 10)
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function openDatabase(path: string): DatabaseSync {
  dbPath = path
  db = new DatabaseSync(path)
  // WAL + FULL sync: a sale reported as complete is on disk and survives a power cut.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = FULL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  deviceId = getSetting('device_id') || ''
  if (!deviceId) {
    deviceId = uuid()
    setSetting('device_id', deviceId)
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
    db.close()
    db = null
  }
}

export function getDb(): DatabaseSync {
  if (!db) throw new AppError('DB_CLOSED', 'Database is not open')
  return db
}

export function getDbPath(): string {
  return dbPath
}

export function getDeviceId(): string {
  return deviceId
}

function migrate(d: DatabaseSync): void {
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL)`)
  const applied = new Set(
    (d.prepare('SELECT version FROM schema_migrations').all() as Row[]).map((r) => Number(r.version))
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    d.exec('BEGIN IMMEDIATE')
    try {
      d.exec(m.sql)
      d.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, now())
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
  }
}

export function latestSchemaVersion(): number {
  return Math.max(...MIGRATIONS.map((m) => m.version))
}

let txDepth = 0
/** Run fn inside one write transaction. Everything commits together or nothing does. */
export function tx<T>(fn: () => T): T {
  const d = getDb()
  if (txDepth > 0) return fn()
  d.exec('BEGIN IMMEDIATE')
  txDepth++
  try {
    const result = fn()
    d.exec('COMMIT')
    return result
  } catch (e) {
    try {
      d.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e
  } finally {
    txDepth--
  }
}

export function all(sql: string, ...params: any[]): Row[] {
  return getDb().prepare(sql).all(...params) as Row[]
}

export function get(sql: string, ...params: any[]): Row | undefined {
  return getDb().prepare(sql).get(...params) as Row | undefined
}

export function run(sql: string, ...params: any[]) {
  return getDb().prepare(sql).run(...params)
}

export function getSetting(key: string): string | null {
  const r = get('SELECT value FROM settings WHERE key = ?', key)
  return r ? (r.value as string) : null
}

export function setSetting(key: string, value: string): void {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
}

/** Atomically take the next number from a named counter stored in settings. */
export function nextCounter(key: string, start = 1): number {
  return tx(() => {
    const cur = Number(getSetting(key) || start - 1)
    const next = cur + 1
    setSetting(key, String(next))
    return next
  })
}

export function logActivity(userId: string | null, action: string, entity?: string, entityId?: string, details?: unknown): void {
  run(
    'INSERT INTO activity_log (id, user_id, action, entity, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    uuid(),
    userId,
    action,
    entity ?? null,
    entityId ?? null,
    details === undefined ? null : JSON.stringify(details),
    now()
  )
}
