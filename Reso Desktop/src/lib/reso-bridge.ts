/**
 * Jembatan typed renderer → main process (Electron).
 *
 * `electron/preload.ts` mengekspos `window.reso` lewat contextBridge. Pemanggilan
 * tetap dibuat tahan-absence (no-op) bila bridge belum siap saat startup.
 */

/** State hasil scraping (pemilik: main process). */
export interface NameState {
  status: 'idle' | 'running' | 'done' | 'stopped' | 'error'
  names: string[]
  count: number
  message: string
  updatedAt: number
  stopReason: string | null
  includeReplies: boolean
  runId: string | null
  postHint: string
  videoHint: string
}

/** Mirror dari electron/store/settings-schema.ts (renderer tidak mengimpor kode main). */
export interface ResoSettings {
  homeUrlFacebook: string
  homeUrlInstagram: string
  homeUrlTiktok: string
  tiktokTemplateUrl: string
  tiktokTemplateCapturedAt: number
  maxScrollRounds: number
  scrollDelayMs: number
  captureTimeoutMs: number
}

interface ResoSettingsBridge {
  get: () => Promise<ResoSettings>
  set: (patch: Partial<ResoSettings>) => Promise<ResoSettings>
  reset: () => Promise<ResoSettings>
}

/** Bentuk payload data lokal — satu definisi dengan domain (src/shared/types). */
import type { Employee, DailyEngagement } from '../shared/types'

export type LocalEmployee = Employee
export type LocalDaily = DailyEngagement

export interface LocalDbStats {
  employees: number
  days: number
  path: string
  schemaVersion: number
}

interface ResoDataBridge {
  listEmployees: () => Promise<LocalEmployee[]>
  upsertEmployee: (
    employee: LocalEmployee
  ) => Promise<{ ok: boolean; employee?: LocalEmployee; reason?: string }>
  replaceEmployees: (
    employees: LocalEmployee[]
  ) => Promise<{ ok: boolean; employees?: LocalEmployee[]; reason?: string }>
  deleteEmployee: (id: string) => Promise<{ ok: boolean }>
  getDaily: (date: string) => Promise<LocalDaily | null>
  listDailyRange: (from: string, to: string) => Promise<LocalDaily[]>
  upsertDaily: (date: string, patch: Partial<LocalDaily>) => Promise<LocalDaily | null>
  stats: () => Promise<LocalDbStats>
  exportAll: () => Promise<{ employees: LocalEmployee[]; daily: LocalDaily[] }>
  importAll: (
    payload: { employees: LocalEmployee[]; daily: LocalDaily[] }
  ) => Promise<{ ok: boolean; stats?: LocalDbStats; reason?: string }>
  /** Dokumen pengaturan tunggal (settings/{id}) — pengganti Firestore. */
  getAllSettings?: () => Promise<Record<string, unknown>>
  listSettings?: () => Promise<string[]>
  getSetting?: (key: string) => Promise<unknown>
  setSetting?: (key: string, value: unknown) => Promise<{ ok: boolean; reason?: string }>
  deleteSetting?: (key: string) => Promise<{ ok: boolean }>
  /** Berlangganan siaran perubahan data dari main process. */
  onChanged?: (cb: () => void) => () => void
  /** Tulis beberapa baris dalam satu transaksi SQLite. */
  batchSave?: (ops: unknown) => Promise<{ ok: boolean; reason?: string }>
}

/** Browser internal tempat operator membuka postingan lalu menekan tombol Scrap. */
export interface ResoScrapeBrowserBridge {
  openBrowser: (platform: string, bounds: unknown) => Promise<boolean>
  closeBrowser: () => Promise<boolean>
  setBounds: (bounds: unknown) => Promise<boolean>
  navigate: (platform: string, url: string) => Promise<boolean>
  getUrl: (platform: string) => Promise<string>
  back: (platform: string) => Promise<boolean>
  forward: (platform: string) => Promise<boolean>
  reload: (platform: string) => Promise<boolean>
  navState: (platform: string) => Promise<{ canBack: boolean; canForward: boolean }>
  onNavigated?: (cb: (payload: { platform: string; url: string }) => void) => () => void
  onLoading?: (cb: (payload: { platform: string; loading: boolean }) => void) => () => void
}

export interface ScrapeHandoffPayload {
  date: string
  platform: string
  total: number
  added: number
  matched: number
  unmatched: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'not-available'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
  message?: string
}

interface ResoUpdateBridge {
  getState: () => Promise<UpdateState>
  check: () => Promise<boolean>
  install: () => Promise<boolean>
  onStateChanged: (cb: (state: UpdateState) => void) => () => void
}

declare global {
  interface Window {
    reso?: {
      platform: 'electron'
      app: { getErrorLog: () => Promise<string> }
      browser: ResoScrapeBrowserBridge
      settings: ResoSettingsBridge
      updater: ResoUpdateBridge
      data: ResoDataBridge
      scrape: {
        getAll: () => Promise<Record<string, NameState>>
        applyEvent: (platform: string, event: unknown) => Promise<NameState | null>
        onStateChanged: (
          cb: (payload: { platform: string; state: NameState }) => void
        ) => () => void
        onHandoff: (cb: (payload: ScrapeHandoffPayload) => void) => () => void
      }
    }
  }
}

export const isElectron =
  typeof window !== 'undefined' && window.reso?.platform === 'electron'

// ===================== Browser internal (buka postingan → tombol Scrap) =====================

export interface ScrapeBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export async function openScrapeBrowser(
  platform: string,
  bounds: ScrapeBrowserBounds
): Promise<boolean> {
  if (!isElectron) return false
  try {
    return await window.reso!.browser.openBrowser(platform, bounds)
  } catch {
    return false
  }
}

export async function closeScrapeBrowser(): Promise<void> {
  if (!isElectron) return
  try {
    await window.reso!.browser.closeBrowser()
  } catch {
    /* already closed */
  }
}

export async function setScrapeBrowserBounds(bounds: ScrapeBrowserBounds): Promise<void> {
  if (!isElectron) return
  try {
    await window.reso!.browser.setBounds(bounds)
  } catch {
    /* window resized */
  }
}

export async function navigateScrapeBrowser(platform: string, url: string): Promise<boolean> {
  if (!isElectron) return false
  try {
    return await window.reso!.browser.navigate(platform, url)
  } catch {
    return false
  }
}

export async function browserBack(platform: string): Promise<void> {
  if (!isElectron) return
  try { await window.reso!.browser.back(platform) } catch { /* sudah di awal */ }
}

export async function browserForward(platform: string): Promise<void> {
  if (!isElectron) return
  try { await window.reso!.browser.forward(platform) } catch { /* sudah di akhir */ }
}

export async function browserReload(platform: string): Promise<void> {
  if (!isElectron) return
  try { await window.reso!.browser.reload(platform) } catch { /* halaman tutup */ }
}

export async function getBrowserNavState(
  platform: string
): Promise<{ canBack: boolean; canForward: boolean }> {
  if (!isElectron) return { canBack: false, canForward: false }
  try { return await window.reso!.browser.navState(platform) } catch { return { canBack: false, canForward: false } }
}

/** URL yang sedang terbuka di host platform — dipakai untuk memulihkan konteks. */
export async function getScrapeBrowserUrl(platform: string): Promise<string> {
  if (!isElectron) return ''
  try { return await window.reso!.browser.getUrl(platform) } catch { return '' }
}

export function onBrowserNavigated(
  cb: (payload: { platform: string; url: string }) => void
): () => void {
  if (!isElectron) return () => {}
  return window.reso!.browser.onNavigated?.(cb) ?? (() => {})
}

export function onBrowserLoading(
  cb: (payload: { platform: string; loading: boolean }) => void
): () => void {
  if (!isElectron) return () => {}
  return window.reso!.browser.onLoading?.(cb) ?? (() => {})
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

// ===================== Data lokal (SQLite, pengganti Firestore) =====================

//
// Semua fungsi mengembalikan nilai aman (array kosong / null) saat berjalan di
// web atau saat main menolak payload — pemanggil tidak perlu menangani throw.

export async function getDaily(date: string): Promise<LocalDaily | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.data.getDaily(date)
  } catch (err) {
    console.warn('getDaily gagal:', err)
    return null
  }
}

export async function upsertDaily(
  date: string,
  patch: Partial<LocalDaily>
): Promise<LocalDaily | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.data.upsertDaily(date, patch)
  } catch (err) {
    console.warn('upsertDaily gagal:', err)
    return null
  }
}

export async function dbStats(): Promise<LocalDbStats | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.data.stats()
  } catch (err) {
    console.warn('dbStats gagal:', err)
    return null
  }
}

export async function exportAll(): Promise<{
  employees: LocalEmployee[]
  daily: LocalDaily[]
} | null> {
  if (!isElectron) return null
  try {
    return await window.reso!.data.exportAll()
  } catch (err) {
    console.warn('exportAll gagal:', err)
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

/** Berlangganan perubahan state; no-op (fungsi kosong) di build web. */
export function onScrapeStateChanged(
  cb: (payload: { platform: string; state: NameState }) => void
): () => void {
  if (!isElectron) return () => {}
  return window.reso!.scrape.onStateChanged(cb)
}

/** Berlangganan notifikasi handoff otomatis hasil scraping → rekap harian. */
export function onScrapeHandoff(cb: (payload: ScrapeHandoffPayload) => void): () => void {
  if (!isElectron) return () => {}
  return window.reso!.scrape.onHandoff(cb)
}

// ===================== Auto-update (GitHub Releases) =====================

export async function getUpdateState(): Promise<UpdateState> {
  if (!isElectron) return { status: 'idle' }
  try {
    return await window.reso!.updater.getState()
  } catch {
    return { status: 'idle' }
  }
}

export function onUpdateStateChanged(cb: (state: UpdateState) => void): () => void {
  if (!isElectron) return () => {}
  return window.reso!.updater.onStateChanged(cb)
}

export async function checkForUpdates(): Promise<boolean> {
  if (!isElectron) return false
  try {
    return await window.reso!.updater.check()
  } catch {
    return false
  }
}

export async function getErrorLog(): Promise<string> {
  if (!isElectron) return ''
  try {
    return await window.reso!.app.getErrorLog()
  } catch {
    return ''
  }
}

export async function installUpdate(): Promise<boolean> {
  if (!isElectron) return false
  try {
    return await window.reso!.updater.install()
  } catch {
    return false
  }
}