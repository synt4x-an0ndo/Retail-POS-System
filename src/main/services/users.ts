import { AppError, all, get, getDeviceId, logActivity, now, run, uuid } from '../db'
import { hashSecret, requireUser } from './auth'

export function listUsers() {
  return all(
    `SELECT u.id, u.name, u.username, u.role_id, r.name AS role_name, u.discount_limit_pct, u.active,
            (u.pin_hash IS NOT NULL) AS has_pin, u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.active DESC, u.name`
  )
}

export function listRoles() {
  return all('SELECT id, name FROM roles ORDER BY name')
}

export interface SaveUserInput {
  id?: string | null
  name: string
  username: string
  password?: string | null
  pin?: string | null
  roleId: string
  discountLimitPct: number
  active: boolean
}

export function saveUser(input: SaveUserInput) {
  const me = requireUser()
  if (!get('SELECT 1 FROM roles WHERE id = ?', input.roleId)) throw new AppError('BAD_ROLE', 'Unknown role.')
  const clash = get('SELECT id FROM users WHERE username = ? AND id != ?', input.username.trim(), input.id ?? '')
  if (clash) throw new AppError('USERNAME_TAKEN', 'That username is already used.')
  const t = now()
  if (!input.id) {
    if (!input.password) throw new AppError('PASSWORD_REQUIRED', 'A password is required for a new user.')
    const id = uuid()
    run(
      `INSERT INTO users (id, name, username, password_hash, pin_hash, role_id, discount_limit_pct, active, device_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.username.trim(),
      hashSecret(input.password),
      input.pin ? hashSecret(input.pin) : null,
      input.roleId,
      input.discountLimitPct,
      input.active ? 1 : 0,
      getDeviceId(),
      t,
      t
    )
    logActivity(me.id, 'user.create', 'user', id, { username: input.username, roleId: input.roleId })
    return { id }
  }
  const existing = get('SELECT * FROM users WHERE id = ?', input.id)
  if (!existing) throw new AppError('USER_NOT_FOUND', 'User not found.')
  if (existing.id === me.id && (!input.active || input.roleId !== existing.role_id)) {
    throw new AppError('SELF_LOCKOUT', 'You cannot deactivate yourself or change your own role.')
  }
  if (existing.role_id === 'role-owner' && (input.roleId !== 'role-owner' || !input.active)) {
    const owners = get(`SELECT COUNT(*) AS n FROM users WHERE role_id = 'role-owner' AND active = 1`)!.n
    if (owners <= 1) throw new AppError('LAST_OWNER', 'At least one active owner account must remain.')
  }
  run(
    `UPDATE users SET name = ?, username = ?, role_id = ?, discount_limit_pct = ?, active = ?, updated_at = ? WHERE id = ?`,
    input.name,
    input.username.trim(),
    input.roleId,
    input.discountLimitPct,
    input.active ? 1 : 0,
    t,
    input.id
  )
  if (input.password) run('UPDATE users SET password_hash = ? WHERE id = ?', hashSecret(input.password), input.id)
  if (input.pin) run('UPDATE users SET pin_hash = ? WHERE id = ?', hashSecret(input.pin), input.id)
  logActivity(me.id, 'user.update', 'user', input.id, {
    roleId: input.roleId,
    active: input.active,
    passwordChanged: !!input.password,
    pinChanged: !!input.pin
  })
  return { id: input.id }
}
