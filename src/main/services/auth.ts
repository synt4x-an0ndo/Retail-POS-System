import bcrypt from 'bcryptjs'
import { DEFAULT_ROLES, type Permission } from '@shared/permissions'
import { AppError, all, get, getDeviceId, logActivity, now, run, setSetting, tx, uuid } from '../db'

export interface SessionUser {
  id: string
  name: string
  username: string
  roleId: string
  roleName: string
  permissions: Permission[]
  discountLimitPct: number
}

let session: SessionUser | null = null

const MAX_FAILED = 5
const LOCK_MINUTES = 5

export function currentUser(): SessionUser | null {
  return session
}

export function requireUser(): SessionUser {
  if (!session) throw new AppError('NOT_LOGGED_IN', 'Please log in again.')
  return session
}

export function hasPermission(p: Permission): boolean {
  return !!session && session.permissions.includes(p)
}

export function isSetupDone(): boolean {
  return !!get('SELECT 1 FROM users LIMIT 1')
}

function permissionsFor(roleId: string): Permission[] {
  return all('SELECT permission FROM role_permissions WHERE role_id = ?', roleId).map((r) => r.permission as Permission)
}

export function seedRoles(): void {
  tx(() => {
    for (const r of DEFAULT_ROLES) {
      const t = now()
      run('INSERT OR IGNORE INTO roles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', r.id, r.name, t, t)
      for (const p of r.permissions) {
        run('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)', r.id, p)
      }
    }
  })
}

export function hashSecret(secret: string): string {
  return bcrypt.hashSync(secret, 10)
}

function loadSession(userId: string): SessionUser {
  const u = get(
    `SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    userId
  )
  if (!u) throw new AppError('USER_NOT_FOUND', 'User not found.')
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    roleId: u.role_id,
    roleName: u.role_name,
    permissions: permissionsFor(u.role_id),
    discountLimitPct: Number(u.discount_limit_pct)
  }
}

export function login(username: string, secret: string): SessionUser {
  const u = get('SELECT * FROM users WHERE username = ? AND active = 1', username.trim())
  if (!u) throw new AppError('LOGIN_FAILED', 'Wrong username, password or PIN.')
  if (u.locked_until && u.locked_until > now()) {
    throw new AppError('LOCKED', `Too many wrong attempts. Try again after ${u.locked_until.slice(11, 16)}.`)
  }
  const okPassword = bcrypt.compareSync(secret, u.password_hash)
  const okPin = !okPassword && u.pin_hash ? bcrypt.compareSync(secret, u.pin_hash) : false
  if (!okPassword && !okPin) {
    const failed = Number(u.failed_attempts) + 1
    const lockUntil = failed >= MAX_FAILED ? now(new Date(Date.now() + LOCK_MINUTES * 60000)) : null
    run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', failed >= MAX_FAILED ? 0 : failed, lockUntil, u.id)
    logActivity(u.id, 'login.failed', 'user', u.id)
    throw new AppError('LOGIN_FAILED', 'Wrong username, password or PIN.')
  }
  run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', u.id)
  session = loadSession(u.id)
  logActivity(u.id, 'login', 'user', u.id)
  return session
}

/** For local maintenance scripts only (seeding, imports). Not reachable from the screens: no IPC channel calls it. */
export function actAsForScript(userId: string): SessionUser {
  session = loadSession(userId)
  return session
}

export function logout(): void {
  if (session) logActivity(session.id, 'logout', 'user', session.id)
  session = null
}

export interface SetupInput {
  shopName: string
  address: string
  phone: string
  receiptFooter: string
  ownerName: string
  username: string
  password: string
  pin: string
}

export function completeSetup(input: SetupInput): SessionUser {
  if (isSetupDone()) throw new AppError('SETUP_DONE', 'Setup has already been completed.')
  const id = uuid()
  tx(() => {
    seedRoles()
    setSetting('shop_name', input.shopName)
    setSetting('shop_address', input.address)
    setSetting('shop_phone', input.phone)
    setSetting('receipt_footer', input.receiptFooter)
    const t = now()
    run(
      `INSERT INTO users (id, name, username, password_hash, pin_hash, role_id, discount_limit_pct, device_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'role-owner', 100, ?, ?, ?)`,
      id,
      input.ownerName,
      input.username.trim(),
      hashSecret(input.password),
      input.pin ? hashSecret(input.pin) : null,
      getDeviceId(),
      t,
      t
    )
    logActivity(id, 'setup.complete', 'user', id)
  })
  session = loadSession(id)
  return session
}

/**
 * Returns the id of the user who authorised an action needing `permission`:
 * the logged-in user if they hold it, otherwise a user holding it whose PIN was entered.
 */
export function authorise(permission: Permission, overridePin?: string | null): string {
  const me = requireUser()
  if (me.permissions.includes(permission)) return me.id
  if (!overridePin) {
    throw new AppError('OVERRIDE_REQUIRED', 'This needs owner approval. Ask the owner to enter their PIN.')
  }
  const candidates = all(
    `SELECT u.id, u.pin_hash FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
     WHERE rp.permission = ? AND u.active = 1 AND u.pin_hash IS NOT NULL`,
    permission
  )
  for (const c of candidates) {
    if (bcrypt.compareSync(overridePin, c.pin_hash)) {
      logActivity(me.id, 'override.approved', 'permission', permission, { approvedBy: c.id })
      return c.id
    }
  }
  logActivity(me.id, 'override.failed', 'permission', permission)
  throw new AppError('OVERRIDE_FAILED', 'Approval PIN is not correct.')
}
