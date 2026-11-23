/**
 * Uji logika engine TikTok (tanpa Electron).
 * Jalankan: npx tsx electron/scrape/engine-tiktok-logic.test.ts
 */
import {
  isTikTokCommentApi,
  isTikTokLoginWall,
  validateCaptureRequest,
  pickCaptureMode,
  type CaptureRequest,
} from './engine-tiktok-logic'

let n = 0
function eq(actual: unknown, expected: unknown, label: string): void {
  n++
  if (actual !== expected) throw new Error(`✗ ${label}: dapat ${String(actual)}, harusnya ${String(expected)}`)
}

const base: CaptureRequest = {
  templateUrl: null,
  videoUrl: null,
  includeReplies: false,
  maxScrollRounds: 15,
  scrollDelayMs: 1200,
  timeoutMs: 120_000,
  signal: { aborted: false },
}

// --- deteksi endpoint ---
eq(isTikTokCommentApi('https://www.tiktok.com/api/comment/list/?aweme_id=1'), true, 'comment/list dikenali')
eq(isTikTokCommentApi('https://www.tiktok.com/api/comment/list/reply/?comment_id=1'), false, 'reply bukan list')
eq(isTikTokCommentApi('https://www.tiktok.com/api/item/detail/?itemId=1'), false, 'endpoint lain ditolak')
eq(isTikTokCommentApi('HTTPS://WWW.TIKTOK.COM/API/COMMENT/LIST/?x=1'), true, 'case-insensitive')

// --- login wall ---
eq(isTikTokLoginWall('https://www.tiktok.com/login?redirect=x'), true, 'halaman login dikenali')
eq(isTikTokLoginWall('https://www.tiktok.com/@user/video/123'), false, 'halaman video bukan login')

// --- validasi request ---
eq(validateCaptureRequest(base), 'no_video', 'tanpa target → no_video')
eq(validateCaptureRequest({ ...base, videoUrl: 'https://x' }), null, 'video saja valid')
eq(validateCaptureRequest({ ...base, templateUrl: 'https://x' }), null, 'template saja valid')
eq(validateCaptureRequest({ ...base, videoUrl: 'a', timeoutMs: 0 }), 'error', 'timeout 0 ditolak')
eq(validateCaptureRequest({ ...base, videoUrl: 'a', timeoutMs: NaN }), 'error', 'timeout NaN ditolak')
eq(validateCaptureRequest({ ...base, videoUrl: 'a', maxScrollRounds: 0 }), 'error', 'rounds 0 ditolak')
eq(validateCaptureRequest({ ...base, videoUrl: 'a', scrollDelayMs: -1 }), 'error', 'delay negatif ditolak')

// --- pemilihan mode ---
eq(pickCaptureMode(base), 'navigation', 'tanpa template → navigation')
eq(pickCaptureMode({ ...base, templateUrl: 'https://t' }), 'template', 'dengan template → template')

console.log(`engine-tiktok-logic: ${n} checks OK`)
