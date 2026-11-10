import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ResoSession } from './ipc/contracts'
import type { ResoSettings } from './store/settings-schema'
import type { NameState, Platform } from '../src/shared/types'

/**
 * Jembatan typed renderer ↔ main. Hanya expose fungsi kecil & eksplisit —
 * jangan expose ipcRenderer mentah (membuka seluruh channel ke dunia render).
 */
const api = {
  platform: 'electron' as const,

  auth: {
    setSession: (session: ResoSession) => ipcRenderer.invoke(IPC.authSetSession, session),
    getSession: (): Promise<ResoSession | null> => ipcRenderer.invoke(IPC.authGetSession),
    clearSession: () => ipcRenderer.invoke(IPC.authClearSession),
  },

  app: {
    getMeta: () => ipcRenderer.invoke(IPC.appGetMeta),
  },

  settings: {
    get: (): Promise<ResoSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<ResoSettings>): Promise<ResoSettings> =>
      ipcRenderer.invoke(IPC.settingsSet, patch),
    reset: (): Promise<ResoSettings> => ipcRenderer.invoke(IPC.settingsReset),
  },

  scrape: {
    getState: (platform: Platform): Promise<NameState | null> =>
      ipcRenderer.invoke(IPC.scrapeGetState, platform),
    getAll: (): Promise<Record<Platform, NameState>> => ipcRenderer.invoke(IPC.scrapeGetAll),
    applyEvent: (platform: Platform, event: unknown): Promise<NameState | null> =>
      ipcRenderer.invoke(IPC.scrapeApplyEvent, platform, event),
    clearNames: (platform: Platform): Promise<NameState | null> =>
      ipcRenderer.invoke(IPC.scrapeClearNames, platform),
    reset: (platform: Platform): Promise<NameState | null> =>
      ipcRenderer.invoke(IPC.scrapeReset, platform),

    /** Berlangganan siaran perubahan state; kembalikan fungsi unsubscribe. */
    onStateChanged: (
      cb: (payload: { platform: Platform; state: NameState }) => void
    ): (() => void) => {
      const listener = (_e: unknown, payload: { platform: Platform; state: NameState }): void =>
        cb(payload)
      ipcRenderer.on(IPC.scrapeStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.scrapeStateChanged, listener)
    },
  },
}

contextBridge.exposeInMainWorld('reso', api)

export type ResoBridge = typeof api