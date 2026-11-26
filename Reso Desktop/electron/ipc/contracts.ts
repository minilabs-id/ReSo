/**
 * Kontrak IPC ReSo Native.
 *
 * Sebagian besar payload renderer divalidasi di sini; khusus event state
 * scraping divalidasi oleh `parseRunEvent` di src/shared/run-state.ts yang
 * dipanggil RunController. Jangan pernah percaya objek dari renderer.
 */

export const IPC = {
  settingsGet: 'reso:settings:get',
  settingsSet: 'reso:settings:set',
  settingsReset: 'reso:settings:reset',
  scrapeGetAll: 'reso:scrape:get-all',
  scrapeApplyEvent: 'reso:scrape:apply-event',
  scrapeStateChanged: 'reso:scrape:state-changed',
  scrapeHandoff: 'reso:scrape:handoff',
  appGetErrorLog: 'reso:app:get-error-log',
  updateGetState: 'reso:update:get-state',
  updateCheck: 'reso:update:check',
  updateInstall: 'reso:update:install',
  updateStateChanged: 'reso:update:state-changed',
  dbListEmployees: 'reso:db:list-employees',
  dbUpsertEmployee: 'reso:db:upsert-employee',
  dbDeleteEmployee: 'reso:db:delete-employee',
  dbGetDaily: 'reso:db:get-daily',
  dbListDailyRange: 'reso:db:list-daily-range',
  dbUpsertDaily: 'reso:db:upsert-daily',
  dbStats: 'reso:db:stats',
  dbChanged: 'reso:db:changed',
  dbBatchSave: 'reso:db:batch-save',
  scrapeOpenBrowser: 'reso:scrape:open-browser',
  scrapeCloseBrowser: 'reso:scrape:close-browser',
  scrapeSetBounds: 'reso:scrape:set-bounds',
  scrapeNavigate: 'reso:scrape:navigate',
  scrapeBrowserBack: 'reso:scrape:browser-back',
  scrapeBrowserForward: 'reso:scrape:browser-forward',
  scrapeBrowserReload: 'reso:scrape:browser-reload',
  scrapeBrowserNavState: 'reso:scrape:browser-nav-state',
  scrapeBrowserGetUrl: 'reso:scrape:browser-get-url',
  scrapeBrowserNavigated: 'reso:scrape:browser-navigated',
  scrapeBrowserLoading: 'reso:scrape:browser-loading',
  scrapClick: 'reso:scrap:click',
  dbExportAll: 'reso:db:export-all',
  dbImportAll: 'reso:db:import-all',
  dbGetAllSettings: 'reso:db:get-all-settings',
  dbListSettings: 'reso:db:list-settings',
  dbGetSetting: 'reso:db:get-setting',
  dbSetSetting: 'reso:db:set-setting',
  dbDeleteSetting: 'reso:db:delete-setting',
} as const

export { type Platform } from '../../src/shared/types'

export function isPlatform(v: unknown): v is import('../../src/shared/types').Platform {
  return v === 'facebook' || v === 'tiktok' || v === 'instagram'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// ===================== Validasi payload data (renderer → main) =====================

const MAX_TEXT = 4000

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function optStr(v: unknown): string | undefined {
  const s = str(v).trim()
  return s ? s.slice(0, MAX_TEXT) : undefined
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length <= MAX_TEXT)
}

/** Validasi satu pegawai dari renderer. `null` = payload tidak layak disimpan. */
export function parseEmployee(v: unknown): import('../../src/shared/types').Employee | null {
  if (!isRecord(v)) return null
  const id = str(v.id).trim()
  const name = str(v.name).trim()
  if (!id || id.length > 128 || !name) return null
  const nip = str(v.nip).trim().slice(0, 64)
  return {
    id,
    name: name.slice(0, MAX_TEXT),
    nip,
    bidang: optStr(v.bidang),
    igUsername: optStr(v.igUsername),
    igUsername2: optStr(v.igUsername2),
    fbName: optStr(v.fbName),
    fbName2: optStr(v.fbName2),
    tiktokName: optStr(v.tiktokName),
    tiktokName2: optStr(v.tiktokName2),
    aliases: strArray(v.aliases),
  }
}

export function parseEmployeeList(v: unknown): import('../../src/shared/types').Employee[] | null {
  if (!Array.isArray(v)) return null
  if (v.length > 20000) return null
  const out: import('../../src/shared/types').Employee[] = []
  for (const item of v) {
    const e = parseEmployee(item)
    if (e) out.push(e)
  }
  return out
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Hanya YYYY-MM-DD yang masuk akal — mencegah path/nilai aneh di kolom PK. */
export function parseDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!DATE_RE.test(s)) return null
  const ms = Date.parse(`${s}T00:00:00Z`)
  if (!Number.isFinite(ms)) return null
  return s
}

/** Patch rekap harian: hanya field domain yang dikenal & bertipe benar. */
export function parseDailyPatch(v: unknown): Partial<import('../../src/shared/types').DailyEngagement> {
  if (!isRecord(v)) return {}
  const out: Record<string, unknown> = {}
  for (const key of ['igRawText', 'fbRawText', 'tiktokRawText', 'autoFilledAt', 'verifiedAt']) {
    if (key in v) out[key] = v[key] === null ? null : str(v[key])
  }
  for (const key of [
    'igEngagedEmployeeIds',
    'fbEngagedEmployeeIds',
    'tiktokEngagedEmployeeIds',
    'postedAt',
  ]) {
    if (key in v) out[key] = strArray(v[key])
  }
  if ('unmatchedNames' in v && Array.isArray(v.unmatchedNames)) {
    out.unmatchedNames = (v.unmatchedNames as unknown[])
      .filter(isRecord)
      .map((u) => ({ name: str(u.name), platform: str(u.platform) }))
      .filter((u) => u.name && (u.platform === 'ig' || u.platform === 'fb' || u.platform === 'tiktok'))
  }
  if ('autoFilledCount' in v) {
    const n = v.autoFilledCount
    out.autoFilledCount = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null
  }
  return out as Partial<import('../../src/shared/types').DailyEngagement>
}

/** Key pengaturan dokumen tunggal — UI memakai `social_links`. */
const SETTING_KEY_MAX = 128
export function parseSettingKey(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > SETTING_KEY_MAX) return null
  return s
}

/** Nilai pengaturan: apa pun yang bisa diserialisasi JSON, ukuran dibatasi. */
export function parseSettingValue(v: unknown): { ok: boolean; value?: unknown } {
  try {
    const text = JSON.stringify(v ?? null)
    if (typeof text !== 'string' || text.length > 512 * 1024) return { ok: false }
    return { ok: true, value: v ?? null }
  } catch {
    return { ok: false }
  }
}

/** Satu operasi atomic batch (dipakai WriteBatch.commit di renderer). */
export interface BatchSaveOp {
  collection: 'employees' | 'dailyEngagement' | 'settings'
  id: string
  data?: unknown
  delete?: boolean
}

export function parseBatchSave(v: unknown): BatchSaveOp[] | null {
  if (!Array.isArray(v) || v.length > 20000) return null
  const out: BatchSaveOp[] = []
  for (const item of v) {
    if (!isRecord(item)) return null
    const collection = item.collection
    if (collection !== 'employees' && collection !== 'dailyEngagement' && collection !== 'settings') return null
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || id.length > 256) return null
    const isDelete = item.delete === true
    if (!isDelete && !isRecord(item.data)) return null
    out.push({ collection, id, data: item.data, delete: isDelete })
  }
  return out
}

/** Posisi browser view di dalam jendela (CSS pixel, relatif ke content view). */
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export function parseBrowserBounds(v: unknown): BrowserBounds | null {
  if (!isRecord(v)) return null
  const out: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const n = v[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 100000) return null
    out[key] = Math.round(n)
  }
  if (out.width < 100 || out.height < 100) return null
  return out
}
