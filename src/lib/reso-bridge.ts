/**
 * Jembatan typed renderer → main process (Electron).
 *
 * `electron/preload.ts` mengekspos `window.reso` lewat contextBridge. Di build
 * WEB (Vite murni, tanpa Electron), `window.reso` tidak ada — semua pemanggilan
 * di sini HARUS tahan-absence (no-op), supaya `npm run build` web tetap aman.
 */

export interface ResoSession {
  idToken: string
  uid: string
  email: string | null
}

export interface ResoAppMeta {
  version: string
  platform: 'win32' | 'darwin' | 'linux'
  electron: boolean
}

/** State hasil scraping (pemilik: main process). */
export interface NameState {
  status: 'idle' | 'running' | 'done' | 'stopped' | 'error'
  names: string[]
  count: number
  message: string
  updatedAt: number
  stopReason: string | null
  includeReplies: boolean
  hasTemplate: boolean
  runId: string | null
  postHint: string
  videoHint: string
}

/** Mirror dari electron/store/settings-schema.ts (renderer tidak mengimpor kode main). */
export interface ResoSettings {
  tiktokTemplateUrl: string
  instagramTemplateUrl: string
  maxScrollRounds: number
  scrollDelayMs: number
  captureTimeoutMs: number
  launchAtLogin: boolean
  minimizeToTray: boolean
  autoSendToReso: boolean
}

interface ResoSettingsBridge {
  get: () => Promise<ResoSettings>
  set: (patch: Partial<ResoSettings>) => Promise<ResoSettings>
  reset: () => Promise<ResoSettings>
}

interface ResoAuthBridge {
  setSession: (session: ResoSession) => Promise<{ ok: boolean }>
  getSession: () => Promise<ResoSession | null>
  clearSession: () => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    reso?: {
      platform: 'electron'
      auth: ResoAuthBridge
      app: { getMeta: () => Promise<ResoAppMeta> }
      settings: ResoSettingsBridge
      scrape: {
        getState: (platform: string) => Promise<NameState | null>
        getAll: () => Promise<Record<string, NameState>>
        applyEvent: (platform: string, event: unknown) => Promise<NameState | null>
        clearNames: (platform: string) => Promise<NameState | null>
        reset: (platform: string) => Promise<NameState | null>
        onStateChanged: (
          cb: (payload: { platform: string; state: NameState }) => void
        ) => () => void
      }
    }
  }
}

export const isElectron =
  typeof window !== 'undefined' && window.reso?.platform === 'electron'

/** Simpan idToken (bukan refresh token) ke memori main process. No-op di web. */
export async function syncSessionToMain(session: ResoSession): Promise<void> {
  if (!isElectron) return
  try {
    await window.reso!.auth.setSession(session)
  } catch (err) {
    // Login renderer tidak boleh gagal gara-gara sinkronisasi main gagal.
    console.warn('syncSessionToMain gagal:', err)
  }
}

export async function clearSessionFromMain(): Promise<void> {
  if (!isElectron) return
  try {
    await window.reso!.auth.clearSession()
  } catch (err) {
    console.warn('clearSessionFromMain gagal:', err)
  }
}

// ===================== Pengaturan (M2 — JSON store) =====================

/** null di build web (tanpa Electron) — UI memakai default lokal. */
export async function getSettings(): Promise<ResoSettings | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.settings.get()
  } catch (err) {
    console.warn('getSettings gagal:', err)
    return null
  }
}

export async function updateSettings(
  patch: Partial<ResoSettings>
): Promise<ResoSettings | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.settings.set(patch)
  } catch (err) {
    console.warn('updateSettings gagal:', err)
    return null
  }
}

export async function resetSettings(): Promise<ResoSettings | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.settings.reset()
  } catch (err) {
    console.warn('resetSettings gagal:', err)
    return null
  }
}

// ===================== State scraping (M3) =====================

/** State semua platform, atau null di build web. */
export async function getScrapeStates(): Promise<Record<string, NameState> | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.scrape.getAll()
  } catch (err) {
    console.warn('getScrapeStates gagal:', err)
    return null
  }
}

export async function applyScrapeEvent(platform: string, event: unknown): Promise<NameState | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.scrape.applyEvent(platform, event)
  } catch (err) {
    console.warn('applyScrapeEvent gagal:', err)
    return null
  }
}

export async function clearScrapeNames(platform: string): Promise<NameState | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.scrape.clearNames(platform)
  } catch (err) {
    console.warn('clearScrapeNames gagal:', err)
    return null
  }
}

/** Berlangganan perubahan state; no-op (fungsi kosong) di build web. */
export function onScrapeStateChanged(
  cb: (payload: { platform: string; state: NameState }) => void
): () => void {
  if (!isElectron) return () => {}
  return window.reso!.scrape.onStateChanged(cb)
}