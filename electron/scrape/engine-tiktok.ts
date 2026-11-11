/**
 * Engine TikTok Electron — eksekutor CaptureRequest dari engine-tiktok-logic.ts.
 *
 * Dua jalur (parity perilaku ekstensi lama):
 * - `template`: navigasi langsung ke URL /api/comment/list (sudah divalidasi
 *   TTL & aweme_id oleh src/shared/template.ts) → JSON → parseTikTokComments.
 * - `navigation`: buka halaman video, intersep respons /api/comment/list via
 *   ses.webRequest, klik ikon komentar + scroll panel komentar (hanya container
 *   komentar — halaman TIDAK digeser).
 */
import type { WebContentsView } from 'electron'
import { parseTikTokComments } from '../../src/shared/parsers'
import { mergeNames } from '../../src/shared/normalize'
import { isStaleRun } from '../../src/shared/state'
import {
  isTikTokCommentApi,
  isTikTokLoginWall,
  validateCaptureRequest,
  pickCaptureMode,
  type CaptureRequest,
  type CaptureResult,
} from './engine-tiktok-logic'

/** Jeda kecil antar polling DOM (ms). */
interface Intercepted {
  urls: string[]
}

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const step = 100
    let waited = 0
    const tick = setInterval(() => {
      waited += step
      if (signal.aborted || waited >= ms) {
        clearInterval(tick)
        resolve()
      }
    }, step)
  })
}

/**
 * Pasang intersep respons JSON di session TikTok.
 * Mengembalikan fungsi pelepasan + wadah hasil.
 */
async function attachInterceptor(
  view: WebContentsView,
  _includeReplies: boolean,
  signal: { aborted: boolean }
): Promise<{ result: Intercepted; detach: () => void }> {
  const store: Intercepted = { urls: [] }
  const ses = view.webContents.session

  const listener = (details: Electron.OnCompletedListenerDetails): void => {
    if (signal.aborted || !isTikTokCommentApi(details.url)) return
    store.urls.push(details.url)
  }

  ses.webRequest.onCompleted({ urls: ['*://*.tiktok.com/*'] }, listener)

  // Body respons TIDAK bisa dibaca lewat webRequest di Electron modern tanpa
  // debugger; jalur navigation memanen nama dari DOM panel komentar (sumber
  // yang sama yang dipakai ekstensi lama saat GraphQL tidak terbaca).
  const detach = (): void => {
    try {
      ses.webRequest.onCompleted(null)
    } catch {
      /* sudah dilepas */
    }
  }

  return { result: store, detach }
}

/**
 * Harvest nama dari DOM panel komentar TikTok yang sedang terbuka.
 * Dipanggil berulang (tiap putaran scroll) — penggabungan dilakukan pemanggil.
 */
const HARVEST_JS = `(() => {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    if (typeof t !== 'string') return;
    const v = t.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  // Kartu komentar: penulis biasanya di tautan profil /@username.
  const cards = document.querySelectorAll('[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]');
  const roots = cards.length ? cards : document.querySelectorAll('div');
  for (const card of roots) {
    const author = card.querySelector('[data-e2e="comment-username-1"], [data-e2e="comment-username-2"], a[href^="/@"]');
    if (author) push(author.textContent || '');
  }
  // Fallback: tautan profil tunggal di area komentar.
  if (!out.length) {
    for (const a of document.querySelectorAll('a[href^="/@"]')) push(a.getAttribute('href').slice(2));
  }
  return out;
})()`

/** Klik ikon komentar di halaman video (tanpa menggeser viewport). */
const OPEN_COMMENTS_JS = `(() => {
  const sels = [
    '[data-e2e="comment-icon"]',
    '[data-e2e="browse-comment"]',
    'button[aria-label*="omment"]',
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el) { el.click(); return s; }
  }
  return null;
})()`

/** Scroll HANYA container komentar (parity v1.0.85: halaman tidak digeser). */
const SCROLL_COMMENT_CONTAINER_JS = `(() => {
  const sels = [
    '[data-e2e="comment-list"]',
    '[class*="DivCommentListContainer"]',
    '[class*="CommentListContainer"]',
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el && el.scrollHeight > el.clientHeight) {
      el.scrollTop = el.scrollHeight;
      return s;
    }
  }
  return null;
})()`

export async function runTikTokCapture(
  view: WebContentsView,
  req: CaptureRequest
): Promise<CaptureResult> {
  const invalid = validateCaptureRequest(req)
  if (invalid) return { names: [], mode: null, reason: invalid as CaptureResult['reason'] }

  const mode = pickCaptureMode(req)
  const names: string[] = []
  const deadline = Date.now() + req.timeoutMs
  const wc = view.webContents

  const finish = (reason: CaptureResult['reason'], detail?: string): CaptureResult => ({
    names: mergeNames([], names, 'tiktok'),
    mode,
    reason,
    detail,
  })

  if (mode === 'template' && req.templateUrl) {
    try {
      // WebContents.loadURL tidak mengembalikan status HTTP; kegagalan load
      // melempar error dan ditangkap di blok catch di bawah.
      await wc.loadURL(req.templateUrl)
      const body = await wc.executeJavaScript('document.body ? document.body.innerText : ""', true)
      if (typeof body !== 'string' || !body.trim()) return finish('no_template', 'body kosong')
      let json: unknown = null
      try {
        json = JSON.parse(body)
      } catch {
        // Beberapa respons dibungkus <pre>; coba ambil teks mentah.
        const m = body.match(/\{[\s\S]*\}/)
        if (m) {
          try {
            json = JSON.parse(m[0])
          } catch {
            json = null
          }
        }
      }
      if (!json) return finish('no_template', 'bukan JSON')
      const parsed = parseTikTokComments(json, req.includeReplies)
      return { names: mergeNames([], parsed, 'tiktok'), mode, reason: 'complete' }
    } catch (err) {
      return finish('error', err instanceof Error ? err.message : String(err))
    }
  }

  if (!req.videoUrl) return finish('no_video')
  if (isTikTokLoginWall(req.videoUrl)) return finish('no_login')

  const { result: intercepted, detach } = await attachInterceptor(view, req.includeReplies, req.signal)
  try {
    await wc.loadURL(req.videoUrl)
    if (isTikTokLoginWall(wc.getURL())) return finish('no_login')

    await sleep(1200, req.signal)
    try {
      await wc.executeJavaScript(OPEN_COMMENTS_JS, true)
    } catch {
      /* klik gagal → andalkan harvest berikutnya */
    }

    let emptyRounds = 0
    for (let round = 0; round < req.maxScrollRounds; round++) {
      if (req.signal.aborted) return finish('stopped')
      if (Date.now() > deadline) return finish('timeout')

      let found: string[] = []
      try {
        found = (await wc.executeJavaScript(HARVEST_JS, true)) as string[]
      } catch {
        found = []
      }
      const before = names.length
      if (Array.isArray(found)) {
        for (const name of found) if (typeof name === 'string') names.push(name)
      }
      emptyRounds = names.length === before ? emptyRounds + 1 : 0

      try {
        await wc.executeJavaScript(SCROLL_COMMENT_CONTAINER_JS, true)
      } catch {
        /* tanpa container → putaran berikutnya harvest lagi */
      }

      // 3 putaran tanpa tambahan = panel habis (parity idle-grace lama).
      if (emptyRounds >= 3) return finish('complete', `${intercepted.urls.length} respons API`)
      await sleep(req.scrollDelayMs, req.signal)
    }
    return finish('incomplete', `${intercepted.urls.length} respons API`)
  } catch (err) {
    return finish('error', err instanceof Error ? err.message : String(err))
  } finally {
    detach()
  }
}

/** Guard run basi — dipakai RunController sebelum menulis hasil. */
export function resultIsStale(stateRunId: string | null, runId: string | null): boolean {
  return isStaleRun(stateRunId, runId)
}
