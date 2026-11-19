import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc/contracts'
import type { ResoSettings } from './store/settings-schema'
import type { NameState, Platform } from '../src/shared/types'

/**
 * Jembatan typed renderer ↔ main. Hanya expose fungsi kecil & eksplisit —
 * jangan expose ipcRenderer mentah (membuka seluruh channel ke dunia render).
 */
const api = {
  platform: 'electron' as const,

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

  /** Data lokal (SQLite) — pengganti Firestore. Payload divalidasi di main. */
  data: {
    listEmployees: () => ipcRenderer.invoke(IPC.dbListEmployees),
    upsertEmployee: (employee: unknown) => ipcRenderer.invoke(IPC.dbUpsertEmployee, employee),
    replaceEmployees: (employees: unknown) => ipcRenderer.invoke(IPC.dbReplaceEmployees, employees),
    deleteEmployee: (id: string) => ipcRenderer.invoke(IPC.dbDeleteEmployee, id),
    getDaily: (date: string) => ipcRenderer.invoke(IPC.dbGetDaily, date),
    listDailyRange: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.dbListDailyRange, from, to),
    upsertDaily: (date: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.dbUpsertDaily, date, patch),
    stats: () => ipcRenderer.invoke(IPC.dbStats),
    listSettings: (): Promise<string[]> => ipcRenderer.invoke(IPC.dbListSettings),
    getSetting: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC.dbGetSetting, key),
    setSetting: (key: string, value: unknown) =>
      ipcRenderer.invoke(IPC.dbSetSetting, key, value),
    deleteSetting: (key: string) => ipcRenderer.invoke(IPC.dbDeleteSetting, key),
    exportAll: () => ipcRenderer.invoke(IPC.dbExportAll),
    importAll: (payload: unknown) => ipcRenderer.invoke(IPC.dbImportAll, payload),
    /** Siaran perubahan DB dari main (import/scraper) → segarkan onSnapshot. */
    onChanged: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on(IPC.dbChanged, listener)
      return () => ipcRenderer.removeListener(IPC.dbChanged, listener)
    },
  },
}

contextBridge.exposeInMainWorld('reso', api)

export type ResoBridge = typeof api