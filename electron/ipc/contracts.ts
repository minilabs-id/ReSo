/**
 * Kontrak IPC ReSo Native.
 *
 * Semua payload dari renderer DIVALIDASI di sini sebelum dipakai main process —
 * jangan pernah percaya bentuk objek yang datang lewat ipcRenderer.invoke/send.
 */

export const IPC = {
  authSetSession: 'reso:auth:set-session',
  authGetSession: 'reso:auth:get-session',
  authClearSession: 'reso:auth:clear-session',
  appGetMeta: 'reso:app:get-meta',
  settingsGet: 'reso:settings:get',
  settingsSet: 'reso:settings:set',
  settingsReset: 'reso:settings:reset',
  scrapeGetState: 'reso:scrape:get-state',
  scrapeGetAll: 'reso:scrape:get-all',
  scrapeReset: 'reso:scrape:reset',
  scrapeClearNames: 'reso:scrape:clear-names',
  scrapeApplyEvent: 'reso:scrape:apply-event',
  scrapeStateChanged: 'reso:scrape:state-changed',
} as const

export { type Platform } from '../../src/shared/types'

export function isPlatform(v: unknown): v is import('../../src/shared/types').Platform {
  return v === 'facebook' || v === 'tiktok' || v === 'instagram'
}

/** Sesi Firebase yang dikirim renderer → main. HANYA idToken (tanpa refresh token). */
export interface ResoSession {
  idToken: string
  uid: string
  email: string | null
}

export interface AppMeta {
  version: string
  platform: 'win32' | 'darwin' | 'linux'
  electron: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Validasi longgar tapi aman: hanya string non-kosong & email string/null. */
export function parseResoSession(v: unknown): ResoSession | null {
  if (!isRecord(v)) return null
  const idToken = v.idToken
  const uid = v.uid
  const email = v.email
  if (typeof idToken !== 'string' || !idToken.trim()) return null
  if (idToken.length > 4096) return null
  if (typeof uid !== 'string' || !uid.trim()) return null
  if (typeof email !== 'string' && email !== null) return null
  return { idToken, uid, email: email as string | null }
}