import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type Channel } from '@shared/channels'

/**
 * The only bridge between the screens and the application core.
 * It forwards only the fixed channel names in CHANNELS; any other name is rejected here and again
 * in the main process. No filesystem, shell or database access is exposed.
 */
const allowed = new Set(Object.keys(CHANNELS))

const api = {
  invoke(channel: Channel, payload?: unknown) {
    if (!allowed.has(channel)) return Promise.resolve({ ok: false, code: 'UNKNOWN_CHANNEL', message: 'Unknown action.' })
    return ipcRenderer.invoke(`pos:${channel}`, payload)
  }
}

contextBridge.exposeInMainWorld('pos', Object.freeze(api))
