/**
 * Engine TikTok NATIVE (main process) — pengganti `inject-tiktok.js` +
 * `content-tiktok.js` ekstensi lama, tanpa chrome.scripting/tabs.
 *
 * Strategi (port perilaku lama, tetap di jalur API resmi halaman):
 * 1. Buka template URL `/api/comment/list` dari sesi TikTok operator
 *    (WebContentsView persisten) → respons JSON → parseTikTokComments.
 * 2. Bila template belum ada/kadaluarsa: buka halaman video TikTok,
 *    klik ikon komentar, lalu scroll panel komentar (lazy-load) dan
 *    intersep respons `/api/comment/list` lewat session.webRequest.
 *
 * Semua keputusan nama tetap lewat src/shared (pure, teruji) — file ini hanya
 * I/O Electron. Tidak ada `window.scrollBy` halaman (parity v1.0.85).
 */

export type CaptureMode = 'template' | 'navigation'

export type CaptureStopReason =
  | 'complete'
  | 'incomplete'
  | 'timeout'
  | 'stopped'
  | 'no_template'
  | 'no_video'
  | 'no_login'
  | 'error'

export interface CaptureRequest {
  /** URL template /api/comment/list yang sudah divalidasi (opsional). */
  templateUrl: string | null
  /** URL halaman video target (wajib untuk mode navigation, opsional untuk template). */
  videoUrl: string | null
  includeReplies: boolean
  maxScrollRounds: number
  scrollDelayMs: number
  /** Batas waktu total (ms). */
  timeoutMs: number
  /** Dipanggil berkala saat berjalan. */
  signal: { aborted: boolean }
}

export interface CaptureResult {
  names: string[]
  mode: CaptureMode | null
  reason: CaptureStopReason
  /** Diagnosis tambahan (mis. jumlah respons terintersep, HTTP status). */
  detail?: string
}

/** Pola endpoint komentar TikTok (satu tempat, mudah diaudit). */
export const TT_COMMENT_LIST = '/api/comment/list'
export const TT_COMMENT_REPLY = '/api/comment/list/reply'
export const TT_VIDEO_API = '/api/item/detail'

export function isTikTokCommentApi(url: string): boolean {
  const low = url.toLowerCase()
  return low.includes(TT_COMMENT_LIST) && !low.includes(TT_COMMENT_REPLY)
}

export function isTikTokReplyApi(url: string): boolean {
  return url.toLowerCase().includes(TT_COMMENT_REPLY)
}

/** Cek halaman login TikTok (belum login → template tidak bisa dipanen). */
export function isTikTokLoginWall(url: string): boolean {
  const low = url.toLowerCase()
  return low.includes('/login') || low.includes('tiktok.com/login')
}

/**
 * Validasi ringan yang bisa dites tanpa Electron: request harus punya
 * sumber target (template atau video) dan batas waktu positif.
 */
export function validateCaptureRequest(req: CaptureRequest): string | null {
  if (!req.templateUrl && !req.videoUrl) return 'no_video'
  if (!Number.isFinite(req.timeoutMs) || req.timeoutMs <= 0) return 'error'
  if (req.maxScrollRounds < 1) return 'error'
  if (req.scrollDelayMs < 0) return 'error'
  return null
}

/** Pilih mode berdasarkan kelengkapan input (murni, teruji). */
export function pickCaptureMode(req: CaptureRequest): CaptureMode {
  return req.templateUrl ? 'template' : 'navigation'
}
