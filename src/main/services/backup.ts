import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { AppError, all, getDb, latestSchemaVersion, logActivity, now, run, setSetting, uuid } from '../db'

export type BackupKind = 'hourly' | 'daily' | 'safety' | 'manual'

let backupDir = ''

export function initBackups(dir: string): void {
  backupDir = dir
  mkdirSync(dir, { recursive: true })
}

export function getBackupDir(): string {
  return backupDir
}

function stamp(): string {
  return now().replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')
}

/** Online backup: safe while the app is running and selling. */
export async function runBackup(kind: BackupKind): Promise<{ path: string; size: number }> {
  const file = join(backupDir, `TRB-${kind}-${stamp()}.db`)
  try {
    await sqliteBackup(getDb(), file)
    const size = statSync(file).size
    run('INSERT INTO backup_log (id, path, size, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', uuid(), file, size, kind, 'ok', now())
    prune()
    return { path: file, size }
  } catch (e: any) {
    try {
      run('INSERT INTO backup_log (id, path, size, kind, status, message, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)', uuid(), file, kind, 'failed', String(e?.message ?? e), now())
    } catch {
      /* ignore */
    }
    throw new AppError('BACKUP_FAILED', `Backup failed: ${e?.message ?? e}`)
  }
}

/** Retention: last 24 hourly, last 30 daily plus one per month for 12 months, last 20 safety/manual. */
function prune(): void {
  const files = readdirSync(backupDir)
    .filter((f) => /^TRB-(hourly|daily|safety|manual)-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse()
  const byKind = (k: string) => files.filter((f) => f.startsWith(`TRB-${k}-`))
  const remove = (f: string) => {
    try {
      rmSync(join(backupDir, f))
    } catch {
      /* ignore */
    }
  }
  byKind('hourly').slice(24).forEach(remove)
  byKind('safety').slice(20).forEach(remove)
  byKind('manual').slice(20).forEach(remove)
  const daily = byKind('daily')
  const keepMonths = new Set<string>()
  daily.slice(30).forEach((f) => {
    const month = f.slice(10, 16) // YYYYMM
    if (keepMonths.has(month) || keepMonths.size >= 12) remove(f)
    else keepMonths.add(month)
  })
}

export function listBackups() {
  const files = existsSync(backupDir)
    ? readdirSync(backupDir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => {
          const st = statSync(join(backupDir, f))
          return { name: f, path: join(backupDir, f), size: st.size, modified: now(st.mtime) }
        })
        .sort((a, b) => b.modified.localeCompare(a.modified))
    : []
  const log = all('SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 50')
  return { dir: backupDir, files, log }
}

export function lastDailyBackupAt(): string | null {
  const r = all(`SELECT created_at FROM backup_log WHERE kind = 'daily' AND status = 'ok' ORDER BY created_at DESC LIMIT 1`)
  return r[0]?.created_at ?? null
}

/** Copy a fresh backup to a folder (USB pen drive, Google Drive folder). */
export async function copyToFolder(folder: string, userId: string) {
  if (!existsSync(folder)) throw new AppError('FOLDER_MISSING', 'That folder is not available. Is the pen drive plugged in?')
  const b = await runBackup('manual')
  const target = join(folder, basename(b.path).replace('TRB-manual-', 'TRB-usb-'))
  copyFileSync(b.path, target)
  setSetting('backup_folder', folder)
  setSetting('last_usb_copy', now())
  run('INSERT INTO backup_log (id, path, size, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', uuid(), target, b.size, 'usb', 'ok', now())
  logActivity(userId, 'backup.copy', 'backup', undefined, { target })
  return { path: target }
}

/** Check that a file is a usable backup of this POS before restoring it. */
export function validateBackupFile(file: string): { schemaVersion: number; sales: number; products: number } {
  let d: DatabaseSync | null = null
  try {
    d = new DatabaseSync(file, { readOnly: true })
    const check = d.prepare('PRAGMA integrity_check').get() as Record<string, any>
    if (Object.values(check)[0] !== 'ok') throw new AppError('BAD_BACKUP', 'The backup file is damaged.')
    const tables = new Set((d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as any[]).map((r) => r.name))
    for (const t of ['schema_migrations', 'users', 'products', 'product_variants', 'sales']) {
      if (!tables.has(t)) throw new AppError('BAD_BACKUP', 'This file is not a The Raw Bros POS backup.')
    }
    const version = Number((d.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as any).v)
    if (version > latestSchemaVersion()) throw new AppError('BACKUP_TOO_NEW', 'This backup is from a newer version of the POS. Update the app first.')
    const sales = Number((d.prepare(`SELECT COUNT(*) AS n FROM sales WHERE status = 'completed'`).get() as any).n)
    const products = Number((d.prepare('SELECT COUNT(*) AS n FROM products').get() as any).n)
    return { schemaVersion: version, sales, products }
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('BAD_BACKUP', 'This file could not be opened as a POS backup.')
  } finally {
    d?.close()
  }
}

/** Replace the live database file with a backup. Call only after the live database is closed. */
export function replaceDatabaseFile(backupFile: string, dbPath: string): void {
  for (const ext of ['-wal', '-shm']) {
    if (existsSync(dbPath + ext)) rmSync(dbPath + ext)
  }
  copyFileSync(backupFile, dbPath)
}

export function quickCheck(): boolean {
  const r = getDb().prepare('PRAGMA quick_check').get() as Record<string, any>
  return Object.values(r)[0] === 'ok'
}
