import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

let state: { status: string; version?: string; message?: string; percent?: number } = { status: 'idle' }
let wired = false

function wire() {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false // install only when the owner chooses
  autoUpdater.on('checking-for-update', () => (state = { status: 'checking' }))
  autoUpdater.on('update-not-available', () => (state = { status: 'up-to-date', version: app.getVersion() }))
  autoUpdater.on('update-available', (i) => (state = { status: 'downloading', version: i.version }))
  autoUpdater.on('download-progress', (p) => (state = { ...state, status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => (state = { status: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => (state = { status: 'error', message: e?.message ?? String(e) }))
}

/** Checks the private HTTPS update server. Downloads are verified against their SHA-512 hash by electron-updater. */
export async function checkForUpdates() {
  if (!app.isPackaged) return { status: 'dev', message: 'Updates work only in the installed app.' }
  wire()
  try {
    await autoUpdater.checkForUpdates()
  } catch (e: any) {
    state = { status: 'error', message: e?.message ?? String(e) }
  }
  return state
}

export function updateState() {
  return state
}

export function installUpdate(beforeQuit: () => Promise<void>) {
  if (state.status !== 'ready') return { started: false }
  beforeQuit().finally(() => autoUpdater.quitAndInstall(false, true))
  return { started: true }
}
