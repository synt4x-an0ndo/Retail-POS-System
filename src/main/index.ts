import { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeDatabase, getDbPath, logActivity, openDatabase } from './db'
import { registerIpc } from './ipc/router'
import { seedRoles } from './services/auth'
import { cleanupDrafts } from './services/sales'
import { verifyLedger } from './services/inventory'
import { initBackups, lastDailyBackupAt, quickCheck, replaceDatabaseFile, runBackup } from './services/backup'
import { labelsHtml, receiptHtml, setImagesDir, testReceiptData } from './services/print'

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
// Development/QA only: separate data folder and an automatic screenshot. Ignored in the installed app.
if (!app.isPackaged && process.env['TRB_USER_DATA']) app.setPath('userData', process.env['TRB_USER_DATA'])
const qaScreenshot = !app.isPackaged ? process.env['TRB_SCREENSHOT'] : undefined
if (qaScreenshot) app.disableHardwareAcceleration()
let mainWindow: BrowserWindow | null = null
let quitting = false

// Only one copy of the POS may run, so two windows never sell from the same stock.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

protocol.registerSchemesAsPrivileged([{ scheme: 'posimg', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const dataDir = join(app.getPath('userData'), 'data')
const imagesDir = join(app.getPath('userData'), 'images')
const backupDir = join(app.getPath('userData'), 'backups')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f5f7',
    title: 'The Raw Bros POS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  const qaSize = qaScreenshot ? /^(\d+)x(\d+)$/.exec(process.env['TRB_WINDOW'] ?? '') : null
  mainWindow.once('ready-to-show', () => {
    if (qaSize) mainWindow?.setContentSize(Number(qaSize[1]), Number(qaSize[2]))
    else mainWindow?.maximize()
    mainWindow?.show()
  })
  mainWindow.on('closed', () => (mainWindow = null))
  if (qaScreenshot) runQa(mainWindow, qaScreenshot)
  if (isDev) mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/**
 * Development/QA only (never in the installed app): optionally runs a renderer script in phases
 * (TRB_QA_SCRIPT defines window.__qa.phases = [async fn, ...]; the page reloads between phases),
 * saves a screenshot after each phase, then quits.
 */
function runQa(win: BrowserWindow, shotPath: string) {
  const script = process.env['TRB_QA_SCRIPT']
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const shot = async (suffix: string) => {
    const { writeFileSync } = await import('node:fs')
    const img = await win.webContents.capturePage()
    writeFileSync(shotPath.replace(/\.png$/, `${suffix}.png`), img.toPNG())
  }
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(1500)
      if (!script) {
        await shot('')
      } else {
        const { readFileSync, writeFileSync } = await import('node:fs')
        const code = readFileSync(script, 'utf8') + '\n;0'
        const log: string[] = []
        await win.webContents.executeJavaScript(code)
        const count = Number(await win.webContents.executeJavaScript('window.__qa.phases.length'))
        for (let i = 0; i < count; i++) {
          if (i > 0) {
            await win.webContents.executeJavaScript(code)
          }
          const res = await win.webContents.executeJavaScript(`window.__qa.phases[${i}]().then(r => 'ok ' + (r ?? ''), e => 'FAIL ' + (e && e.message))`)
          log.push(`phase ${i + 1}: ${res}`)
          await wait(800)
          await shot(`-${i + 1}`)
          if (i < count - 1) {
            const loaded = new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
            win.webContents.reload()
            await loaded
            await wait(1500)
          }
        }
        writeFileSync(shotPath.replace(/\.png$/, '.log.txt'), log.join('\n'))
      }
      // Render the receipt and a label exactly as they are sent to the printer.
      const { writeFileSync } = await import('node:fs')
      const previews: [string, string, number, number][] = [
        ['receipt', receiptHtml(testReceiptData()), 80, 140],
        ['label', labelsHtml([{ barcode: '2000000001', product_name: 'Oxford Cotton Shirt', size_name: 'M', color_name: 'Black', sell_price: 1250, qty: 1 }]), 38, 25]
      ]
      for (const [name, html, wMm, hMm] of previews) {
        const pw = new BrowserWindow({ show: false, useContentSize: true, width: Math.round((wMm / 25.4) * 96 * 3), height: Math.round((hMm / 25.4) * 96 * 3), webPreferences: { sandbox: true, zoomFactor: 3 } })
        await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        await wait(400)
        writeFileSync(shotPath.replace(/\.png$/, `-${name}.png`), (await pw.webContents.capturePage()).toPNG())
        pw.destroy()
      }
    } catch (e) {
      console.error('QA run failed', e)
    }
    app.quit()
  })
}

function lockDownWebContents() {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      const allowed = isDev ? url.startsWith(process.env['ELECTRON_RENDERER_URL']!) : url.startsWith('file://')
      if (!allowed) e.preventDefault()
    })
    contents.on('will-attach-webview', (e) => e.preventDefault())
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

function registerImageProtocol() {
  // posimg://img/<file>.jpg serves only files from the app's own images folder.
  protocol.handle('posimg', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
    if (!/^[A-Za-z0-9-]+\.(jpg|png)$/.test(name)) return new Response('Not found', { status: 404 })
    const file = join(imagesDir, name)
    if (!existsSync(file)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

async function scheduledBackups() {
  const last = lastDailyBackupAt()
  const due = !last || Date.now() - new Date(last.replace(' ', 'T')).getTime() > 20 * 3600 * 1000
  if (due) await runBackup('daily').catch((e) => console.error('daily backup', e))
  setInterval(() => runBackup('hourly').catch((e) => console.error('hourly backup', e)), 60 * 60 * 1000)
  setInterval(() => {
    cleanupDrafts()
    verifyLedger()
  }, 24 * 3600 * 1000)
}

async function shutdown(): Promise<void> {
  try {
    await runBackup('daily')
  } catch (e) {
    console.error('closing backup failed', e)
  }
  closeDatabase()
}

async function restoreAndRelaunch(backupFile: string) {
  const dbPath = getDbPath()
  quitting = true
  closeDatabase()
  replaceDatabaseFile(backupFile, dbPath)
  app.relaunch()
  app.exit(0)
}

app.whenReady().then(async () => {
  for (const d of [dataDir, imagesDir, backupDir]) mkdirSync(d, { recursive: true })
  if (app.isPackaged) Menu.setApplicationMenu(null)
  lockDownWebContents()
  registerImageProtocol()
  setImagesDir(imagesDir)

  try {
    openDatabase(join(dataDir, 'pos.db'))
  } catch (e: any) {
    dialog.showErrorBox('The Raw Bros POS', `The database could not be opened.\n\n${e?.message ?? e}\n\nRestore from a backup or contact support.`)
    app.exit(1)
    return
  }
  seedRoles()
  initBackups(backupDir)
  if (!quickCheck()) {
    logActivity(null, 'db.integrity_failed', 'database')
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Database check failed',
      message: 'The database check found a problem.',
      detail: 'You can keep working, but the owner should restore the latest backup from Backup → Restore, or call support.'
    })
  }
  cleanupDrafts()
  verifyLedger()

  registerIpc({
    getWindow: () => mainWindow,
    imagesDir,
    appVersion: app.getVersion(),
    restoreAndRelaunch,
    beforeQuit: async () => {
      quitting = true
      await shutdown()
    }
  })
  createWindow()
  scheduledBackups()
})

app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  shutdown().finally(() => app.exit(0))
})

app.on('window-all-closed', () => app.quit())
