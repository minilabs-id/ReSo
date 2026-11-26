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

  /** Browser internal (WebContentsView) yang bisa dibuka/diarahkan dari UI. */
  browser: {
    openBrowser: (platform: string, bounds: unknown): Promise<boolean> =>
      ipcRenderer.invoke(IPC.scrapeOpenBrowser, platform, bounds),
    closeBrowser: (): Promise<boolean> => ipcRenderer.invoke(IPC.scrapeCloseBrowser),
    setBounds: (bounds: unknown): Promise<boolean> => ipcRenderer.invoke(IPC.scrapeSetBounds, bounds),
    navigate: (platform: string, url: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.scrapeNavigate, platform, url),
    openOwnProfile: (platform: string): Promise<string> =>
      ipcRenderer.invoke(IPC.scrapeBrowserOwnProfile, platform),
    captureStatus: (platform: string): Promise<{ installed: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.scrapeCaptureStatus, platform),
    back: (platform: string): Promise<boolean> => ipcRenderer.invoke(IPC.scrapeBrowserBack, platform),
    forward: (platform: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.scrapeBrowserForward, platform),
    reload: (platform: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.scrapeBrowserReload, platform),
    navState: (platform: string): Promise<{ canBack: boolean; canForward: boolean }> =>
      ipcRenderer.invoke(IPC.scrapeBrowserNavState, platform),
    getUrl: (platform: string): Promise<string> =>
      ipcRenderer.invoke(IPC.scrapeBrowserGetUrl, platform),
    onNavigated: (cb: (payload: { platform: string; url: string }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { platform: string; url: string }) => cb(payload)
      ipcRenderer.on(IPC.scrapeBrowserNavigated, listener)
      return () => ipcRenderer.removeListener(IPC.scrapeBrowserNavigated, listener)
    },
    onLoading: (cb: (payload: { platform: string; loading: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { platform: string; loading: boolean }) => cb(payload)
      ipcRenderer.on(IPC.scrapeBrowserLoading, listener)
      return () => ipcRenderer.removeListener(IPC.scrapeBrowserLoading, listener)
    },
  },

  app: {
    getErrorLog: (): Promise<string> => ipcRenderer.invoke(IPC.appGetErrorLog),
  },

  settings: {
    get: (): Promise<ResoSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<ResoSettings>): Promise<ResoSettings> =>
      ipcRenderer.invoke(IPC.settingsSet, patch),
    reset: (): Promise<ResoSettings> => ipcRenderer.invoke(IPC.settingsReset),
  },

  updater: {
    getState: (): Promise<unknown> => ipcRenderer.invoke(IPC.updateGetState),
    check: (): Promise<boolean> => ipcRenderer.invoke(IPC.updateCheck),
    install: (): Promise<boolean> => ipcRenderer.invoke(IPC.updateInstall),
    onStateChanged: (cb: (state: unknown) => void): (() => void) => {
      const listener = (_e: unknown, state: unknown): void => cb(state)
      ipcRenderer.on(IPC.updateStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.updateStateChanged, listener)
    },
  },

  scrape: {
    getAll: (): Promise<Record<Platform, NameState>> => ipcRenderer.invoke(IPC.scrapeGetAll),
    applyEvent: (platform: Platform, event: unknown): Promise<NameState | null> =>
      ipcRenderer.invoke(IPC.scrapeApplyEvent, platform, event),
    /** Berlangganan siaran perubahan state; kembalikan fungsi unsubscribe. */
    onStateChanged: (
      cb: (payload: { platform: Platform; state: NameState }) => void
    ): (() => void) => {
      const listener = (_e: unknown, payload: { platform: Platform; state: NameState }): void =>
        cb(payload)
      ipcRenderer.on(IPC.scrapeStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.scrapeStateChanged, listener)
    },

    /** Hasil scraping otomatis masuk rekap — kabari renderer untuk toast. */
    onHandoff: (cb: (payload: unknown) => void): (() => void) => {
      const listener = (_e: unknown, payload: unknown): void => cb(payload)
      ipcRenderer.on(IPC.scrapeHandoff, listener)
      return () => ipcRenderer.removeListener(IPC.scrapeHandoff, listener)
    },
  },

  /** Data lokal (SQLite) — pengganti Firestore. Payload divalidasi di main. */
  data: {
    listEmployees: () => ipcRenderer.invoke(IPC.dbListEmployees),
    upsertEmployee: (employee: unknown) => ipcRenderer.invoke(IPC.dbUpsertEmployee, employee),
    deleteEmployee: (id: string) => ipcRenderer.invoke(IPC.dbDeleteEmployee, id),
    getDaily: (date: string) => ipcRenderer.invoke(IPC.dbGetDaily, date),
    listDailyRange: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.dbListDailyRange, from, to),
    upsertDaily: (date: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.dbUpsertDaily, date, patch),
    stats: () => ipcRenderer.invoke(IPC.dbStats),
    batchSave: (ops: unknown) => ipcRenderer.invoke(IPC.dbBatchSave, ops),
    getAllSettings: (): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke(IPC.dbGetAllSettings),
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