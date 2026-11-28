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
import type { Session, WebContentsView } from 'electron'
import { parseTikTokComments } from '../../src/shared/parsers'
import { mergeNames } from '../../src/shared/normalize'
import { sanitizeEngineOptions, TEMPLATE_TTL_MS } from '../../src/shared/template'
import {
  isTikTokCommentApi,
  isTikTokLoginWall,
  validateCaptureRequest,
  pickCaptureMode,
  type CaptureRequest,
  type CaptureResult,
} from './engine-tiktok-logic'
import { attachCdp, type CdpSession } from './cdp'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Ambil semua username dari satu body JSON `/api/comment/list`.
 *
 * Jalur DOM hanya melihat kartu yang sedang di-render (TikTok memakai
 * virtualization), jadi semua nama dari respons API yang ditangkap CDP
 * digabungkan di sini. `unique_id` diprioritaskan supaya konsisten dengan
 * nama yang diharapkan operator; `nickname` dipakai bila tidak tersedia.
 */
export function extractTikTokApiNames(data: unknown, includeReplies: boolean): string[] {
  const out: string[] = []
  const visited = new Set<unknown>()
  const walk = (v: unknown, depth = 0): void => {
    if (!v || depth > 24 || visited.has(v)) return
    visited.add(v)
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
      return
    }
    if (!isRecord(v)) return
    const user = v['user']
    if (isRecord(user)) {
      const unique = user['unique_id']
      const nick = user['nickname'] ?? user['nickName']
      const name = typeof unique === 'string' && unique.trim() ? unique : nick
      if (typeof name === 'string' && name.trim()) out.push(name.trim())
    }
    for (const [key, value] of Object.entries(v)) {
      if (!includeReplies && (key === 'reply_comment' || key === 'reply_comments')) continue
      walk(value, depth + 1)
    }
  }
  walk(data)
  return out
}

interface Intercepted {
  urls: string[]
  /** Status HTTP tertinggi yang terlihat (429/403 dipetakan ke reason khusus). */
  maxStatus: number
}

function sleep(ms: number, signal: { aborted: boolean }, deadline = 0): Promise<void> {
  return new Promise((resolve) => {
    const step = 100
    let waited = 0
    const tick = setInterval(() => {
      waited += step
      if (signal.aborted || (deadline > 0 && Date.now() >= deadline) || waited >= ms) {
        clearInterval(tick)
        resolve()
      }
    }, step)
  })
}

// ===================== Intersep webRequest (satu listener per session) =====================
//
// Electron 33 TIDAK punya API "hapus satu listener" untuk `webRequest`. Memanggil
// `onCompleted(null)` melepaskan SEMUA listener di session (bug P2-4). Solusinya:
// daftarkan SATU listener bersama per Session, lalu tiap run cuma mendaftar &
// menghapus sink-nya sendiri. Run lama tidak pernah bisa mengganggu run baru.

type UrlSink = (url: string, statusCode: number) => void

const sessionSinks = new Map<Session, Set<UrlSink>>()

function ensureInterceptor(ses: Session): Set<UrlSink> {
  const existing = sessionSinks.get(ses)
  if (existing) return existing

  const sinks = new Set<UrlSink>()
  sessionSinks.set(ses, sinks)
  const listener = (details: Electron.OnCompletedListenerDetails): void => {
    if (!isTikTokCommentApi(details.url)) return
    for (const sink of [...sinks]) {
      try {
        sink(details.url, details.statusCode ?? 0)
      } catch {
        /* sink mati → abaikan */
      }
    }
  }
  // Satu listener untuk semua run di session ini; tidak pernah dipanggil dengan
  // `null`, jadi listener platform lain (bila ada) tetap utuh.
  ses.webRequest.onCompleted({ urls: ['*://*.tiktok.com/*'] }, listener)
  return sinks
}

/**
 * Pasang intersep respons JSON di session TikTok.
 * Mengembalikan fungsi pelepasan + wadah hasil.
 *
 * Body respons TIDAK bisa dibaca lewat webRequest di Electron modern tanpa
 * debugger; jalur navigation memanen nama dari DOM panel komentar (sumber
 * yang sama yang dipakai ekstensi lama saat GraphQL tidak terbaca).
 */
async function attachInterceptor(
  view: WebContentsView,
  signal: { aborted: boolean },
  onStatus?: (status: number) => void
): Promise<{ result: Intercepted; detach: () => void }> {
  const store: Intercepted = { urls: [], maxStatus: 0 }
  const sinks = ensureInterceptor(view.webContents.session)

  const sink: UrlSink = (url, statusCode) => {
    if (signal.aborted) return
    store.urls.push(url)
    if (statusCode > store.maxStatus) store.maxStatus = statusCode
    onStatus?.(statusCode)
  }
  sinks.add(sink)

  const detach = (): void => {
    sinks.delete(sink) // lepas HANYA sink milik run ini
  }

  return { result: store, detach }
}

/**
 * Validasi URL template sebelum dinavigasi: host/endpoint via sanitizeEngineOptions
 * + TTL 45 menit bila metadata `capturedAt` tersedia. Template warisan tanpa
 * metadata tetap diterima (kompatibilitas), tetapi template baru ditolak bila
 * sudah kedaluwarsa.
 */
export function sanitizeTikTokTemplateForRun(url: unknown, capturedAt = 0): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  const clean = sanitizeEngineOptions('SET_TEMPLATE', { templateUrl: url }, 'tiktok').templateUrl
  if (!clean) return null
  if (capturedAt > 0 && Date.now() - capturedAt > TEMPLATE_TTL_MS) return null
  // Template tanpa aweme_id tidak bisa diikat ke video target.
  if (!/[?&]aweme_id=\d+/.test(clean)) return null
  return clean
}

/**
 * Harvest nama dari DOM panel komentar TikTok yang sedang terbuka.
 * Dipanggil berulang (tiap putaran scroll) — penggabungan dilakukan pemanggil.
 */
const buildTikTokHarvestScript = (includeReplies: boolean): string => `(() => {
  const INCLUDE_REPLIES = ${includeReplies ? 'true' : 'false'};
  const out = [];
  const seen = new Set();
  const push = (t) => {
    if (typeof t !== 'string') return;
    const v = t.trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push(v);
  };
  const fromHref = (a) => {
    const h = a && a.getAttribute('href');
    if (!h) return '';
    const m = h.match(/^\\/@([A-Za-z0-9._]{1,30})/);
    return m ? m[1] : '';
  };

  // HANYA kartu komentar — JANGAN pernah jatuh ke seluruh dokumen. Fallback lama
  // querySelectorAll('div') + a[href^="/@"] menarik akun sidebar "Following"
  // sebagai komentator (false positive engagement).
  // SUMBER BENAR (diverifikasi pada 2 video berbeda):
  //   [data-e2e="comment-username-1"] > a[href^="/@username"]
  // data-e2e="inbox-list" adalah NOTIFIKASI akun (komentar lintas video) —
  // mengambilnya menghasilkan nama yang sama pada video berbeda. Jangan pakai.
  // comment-username-2 adalah level balasan — hanya diambil bila opsi aktif.
  const authors = document.querySelectorAll(INCLUDE_REPLIES
    ? '[data-e2e="comment-username-1"], [data-e2e="comment-username-2"]'
    : '[data-e2e="comment-username-1"]');
  for (const author of authors) {
    const a = author.querySelector('a[href^="/@"]');
    const u = fromHref(a);
    if (u) push(u);
  }

  // Fallback aman: anchor profil di dalam header komentar (bukan inbox).
  if (!out.length) {
    for (const a of document.querySelectorAll('a[href^="/@"]')) {
      if (!a.closest('[data-e2e*="comment"], [class*="CommentHeader"]')) continue;
      if (a.closest('[data-e2e="inbox-list"], [data-e2e="inbox-notifications"]')) continue;
      push(fromHref(a));
    }
  }
  return out;
})()`

/**
 * TikTok mengabaikan `element.click()` dari executeJavaScript (event untrusted),
 * sehingga panel komentar tidak pernah terbuka hanya dengan klik programatik.
 * Klik lewat pipeline input Electron menghasilkan event trusted yang setara
 * dengan klik operator. Dipanggil setelah halaman video selesai dimuat.
 */
async function clickCommentsTrusted(
  view: WebContentsView,
  runJs: <T>(script: string) => Promise<T>,
  sharedCdp: CdpSession | null
): Promise<string | null> {
  const wc = view.webContents
  // Tanpa pipeline input (mis. test/engine non-Electron) jangan buang waktu.
  if (typeof wc.sendInputEvent !== 'function') return null
  try {
    let box: { x: number; y: number; label: string } | null = null
    // Video TikTok bisa butuh beberapa detik untuk me-render action bar setelah
    // loadURL. Coba beberapa kali sebelum menyerah.
    for (let attempt = 0; attempt < 12 && !box; attempt++) {
      box = await runJs<{ x: number; y: number; label: string } | null>(`(() => {
      const icons = Array.from(document.querySelectorAll('[data-e2e="comment-icon"]'));
      const score = (el) => {
        const m = (el.getAttribute('aria-label') || '').match(/(\\d+)\\s*comments?/i);
        return m ? Number(m[1]) : 0;
      };
      icons.sort((a, b) => score(b) - score(a));
      const el = icons[0] || document.querySelector('[data-e2e="browse-comment"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) return null;
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        label: el.getAttribute('aria-label') || ''
      };
    })()`)
      if (!box) await new Promise((r) => setTimeout(r, 500))
    }
    if (!box) return null

    // Pakai CDP Input dengan koordinat viewport — sudah terbukti membuka panel
    // komentar TikTok. Sesi CDP dipakai bersama seluruh run (jangan di-detach
    // di sini — penangkap respons API masih membutuhkannya).
    try {
      const cdp = sharedCdp ?? (await attachCdp(wc, 2))
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 })
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 })
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 })
      await new Promise((r) => setTimeout(r, 1500))
      const opened = await runJs(`!!document.querySelector('[data-e2e="comment-username-1"]')`)
      if (opened) return box.label || 'comment-icon'
      if (!sharedCdp) await cdp.detach()
    } catch {
      /* CDP gagal — coba koordinat window sebagai fallback */
    }
    try {
      const vb = view.getBounds()
      wc.sendInputEvent({ type: 'mouseMove', x: box.x + vb.x, y: box.y + vb.y })
      wc.sendInputEvent({ type: 'mouseDown', x: box.x + vb.x, y: box.y + vb.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: box.x + vb.x, y: box.y + vb.y, button: 'left', clickCount: 1 })
      await new Promise((r) => setTimeout(r, 1200))
      if (await runJs(`!!document.querySelector('[data-e2e="comment-username-1"]')`)) {
        return box.label || 'comment-icon'
      }
    } catch {
      /* klik gagal */
    }
    return null
  } catch {
    return null
  }
}

/** Klik ikon komentar di halaman video (fallback untuk browser non-Electron). */
const OPEN_COMMENTS_JS = `(() => {
  // Prioritas: ikon komentar dengan JUMLAH terbesar. Di halaman video nyata
  // ada dua [data-e2e="comment-icon"] (0 dan 133) — regex lama mengabaikan
  // aria-label "Read or add comments 133 comments" karena diawali "Read".
  const icons = Array.from(document.querySelectorAll('[data-e2e="comment-icon"]'));
  if (icons.length) {
    const score = (el) => {
      const a = el.getAttribute('aria-label') || '';
      const n = a.match(/(\\d+)\\s*comments?/i);
      return n ? Number(n[1]) : 0;
    };
    icons.sort((a, b) => score(b) - score(a));
    try { icons[0].click(); return 'comment-icon:' + score(icons[0]); } catch (_) {}
  }
  const sels = ['[data-e2e="browse-comment"]', 'button[aria-label*="omment"]', '[aria-label*="Comment"]', 'div[role="button"]', 'button'];
  const re = /^(comments?|komentar|\\d+\\s*comments?|view all comments?)/i;
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      const label = (el.getAttribute('aria-label') || '').trim();
      const text = (el.textContent || '').trim();
      if (re.test(text) || /read or add comments/i.test(label) || re.test(label)) {
        try { el.click(); return s; } catch (_) {}
      }
    }
  }
  return null;
})()`

/** Scroll HANYA container komentar (parity v1.0.85: halaman tidak digeser). */
const SCROLL_COMMENT_CONTAINER_JS = `(() => {
  const sels = [
    '[data-e2e="comment-list"]',
    // Container yang benar-benar di-scroll di TikTok saat ini.
    '[class*="DivCommentMain"]',
    '[class*="DivCommentListContainer"]',
    '[class*="CommentListContainer"]',
    'div[class*="RightPanelContainer"]',
    'div[class*="CommentFooter"]',
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

/**
 * Scroll panel dengan wheel event asli supaya handler infinite-scroll TikTok
 * ikut berjalan. `scrollTop` saja sering tidak memicu React observer pada
 * container virtualized, sehingga hanya 10 komentar pertama yang pernah dimuat.
 */
async function wheelCommentPanel(
  cdp: CdpSession | null,
  runJs: <T>(script: string) => Promise<T>
): Promise<boolean> {
  if (!cdp) return false
  try {
    const point = await runJs<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector('[data-e2e="comment-list"]')
        || [...document.querySelectorAll('*')].find((e) => {
          const cls = String(e.className || '') + ' ' + (e.getAttribute('data-e2e') || '');
          return /comment/i.test(cls) && e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 60;
        });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 240)) };
    })()`)
    if (!point) return false
    await cdp.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: 720,
    })
    return true
  } catch {
    return false
  }
}

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
  /** Status HTTP tertinggi dari respons komentar (0 = tak ada respons). */
  let maxStatus = 0

  /** executeJavaScript dengan batas deadline/abort agar STOP tidak menggantung. */
  const runJs = <T>(script: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(
        () => settle(() => reject(new Error('scrape-timeout'))),
        Math.max(1, deadline - Date.now())
      )
      const poll = setInterval(() => {
        if (req.signal.aborted) settle(() => reject(new Error('scrape-aborted')))
      }, 50)
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearInterval(poll)
        fn()
      }
      try {
        wc.executeJavaScript(script, true).then(
          (v) => settle(() => resolve(v as T)),
          (e) => settle(() => reject(e))
        )
      } catch (err) {
        settle(() => reject(err))
      }
    })

  const finish = (reason: CaptureResult['reason'], detail?: string): CaptureResult => {
    let finalReason = reason
    let finalDetail = detail
    if (maxStatus === 429) {
      finalReason = 'rate_limit'
      finalDetail = 'TikTok membatasi permintaan (429) — tunggu beberapa menit lalu coba lagi.'
    } else if (maxStatus === 403) {
      finalReason = 'blocked'
      finalDetail = 'Akses komentar ditolak TikTok (403) — periksa login/checkpoint di browser.'
    }
    return { names: mergeNames([], names, 'tiktok'), mode, reason: finalReason, detail: finalDetail }
  }

  let cdp: CdpSession | null = null
  const offListeners: Array<() => void> = []
  const apiNames: string[] = []
  let apiPages = 0
  let apiHasMore = true

  if (mode === 'template' && req.templateUrl) {
    // Jangan navigasikan WebContentsView ke JSON — itu mengubah target run
    // berikutnya. Ambil lewat session.fetch dengan cookie partition yang sama.
    const safeUrl = sanitizeTikTokTemplateForRun(req.templateUrl, req.templateCapturedAt ?? 0)
    if (!safeUrl) return finish('no_template', 'template URL tidak valid / aweme_id tidak ditemukan')
    if (req.signal.aborted) return finish('stopped')
    try {
      const res = await wc.session.fetch(safeUrl, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      maxStatus = res.status
      if (res.status === 429) return finish('rate_limit', 'TikTok membatasi permintaan (429).')
      if (res.status === 403) return finish('blocked', 'Akses komentar ditolak TikTok (403).')
      if (!res.ok) return finish('error', 'HTTP-' + res.status)
      const body = await res.text()
      if (!body.trim()) return finish('no_template', 'body kosong')
      let json: unknown = null
      try {
        json = JSON.parse(body)
      } catch {
        const m = body.match(/\{[\s\S]*\}/)
        if (m) {
          try { json = JSON.parse(m[0]) } catch { json = null }
        }
      }
      if (!json) return finish('no_template', 'bukan JSON')
      if (req.awemeId && isRecord(json)) {
        const got = String(json['aweme_id'] ?? json['item_id'] ?? '')
        if (got && got !== req.awemeId) {
          return finish('no_template', `Template untuk video ${got}, bukan ${req.awemeId}`)
        }
      }
      const parsed = [
        ...parseTikTokComments(json, req.includeReplies),
        ...extractTikTokApiNames(json, req.includeReplies),
      ]
      return { names: mergeNames([], parsed, 'tiktok'), mode, reason: 'complete' }
    } catch (err) {
      return finish('error', err instanceof Error ? err.message : String(err))
    }
  }

  if (!req.videoUrl) return finish('no_video')
  if (isTikTokLoginWall(req.videoUrl)) return finish('no_login')

  // Satu sesi CDP untuk seluruh run: klik trusted, wheel scroll, dan — yang
  // terpenting — membaca body JSON /api/comment/list. DOM panel TikTok
  // tervirtualisasi, jadi mengandalkan kartu yang terlihat saja kehilangan
  // komentar pada halaman yang sama.
  try {
    const session = await attachCdp(wc, 2)
    cdp = session
    await session.sendCommand('Network.enable')
    offListeners.push(
      session.on('Network.responseReceived', (params) => {
        const response = params['response']
        if (!isRecord(response)) return
        const url = typeof response['url'] === 'string' ? response['url'] : ''
        if (!/\/api\/comment\/list/.test(url)) return
        void (async () => {
          try {
            const raw = (await session.sendCommand('Network.getResponseBody', {
              requestId: params['requestId'],
            })) as { body?: string } | undefined
            const text = typeof raw?.body === 'string' ? raw.body : ''
            if (!text.trim()) return
            let json: unknown = null
            try { json = JSON.parse(text) } catch { return }
            const isReply = /\/list\/reply/.test(url)
            if (!isReply) apiPages++
            // `has_more` balasan tidak boleh menghentikan pagination komentar utama.
            if (!isReply && isRecord(json) && 'has_more' in json) {
              apiHasMore = Boolean(json['has_more'])
            }
            for (const name of extractTikTokApiNames(json, req.includeReplies)) apiNames.push(name)
          } catch {
            /* body sudah dibebaskan oleh CDP — halaman berikutnya tetap diproses */
          }
        })()
      })
    )
  } catch {
    cdp = null
  }

  const { result: intercepted, detach } = await attachInterceptor(view, req.signal, (status) => {
    if (status > maxStatus) maxStatus = status
  })
  try {
    await wc.loadURL(req.videoUrl)
    if (req.signal.aborted) return finish('stopped')
    if (isTikTokLoginWall(wc.getURL())) return finish('no_login')

    await sleep(Math.max(2000, Math.min(4000, req.scrollDelayMs * 2)), req.signal, deadline)
    if (req.signal.aborted) return finish('stopped')
    // Buka panel komentar. Klik trusted wajib — TikTok mengabaikan klik
    // programatik biasa. Fallback tetap ada bila pipeline input gagal.
    const opened = await clickCommentsTrusted(view, runJs, cdp)
    if (!opened) {
      try {
        await runJs(OPEN_COMMENTS_JS)
      } catch {
        if (req.signal.aborted) return finish('stopped')
        /* klik gagal → andalkan harvest berikutnya */
      }
    }
    // Tunggu kartu komentar sempat di-render sebelum putaran pertama — hanya
    // bila klik trusted benar-benar terkirim, dan tidak melewati deadline.
    if (opened) {
      for (let i = 0; i < 20 && Date.now() < deadline; i++) {
        if (req.signal.aborted) return finish('stopped')
        const ready = await runJs<boolean>(
          `!!document.querySelector('[data-e2e="comment-username-1"], [data-e2e="comment-username-2"]')`
        ).catch(() => false)
        if (ready) break
        await sleep(400, req.signal, deadline)
      }
    }

    // Dedupe lintas putaran: HARVEST_JS hanya punya Set per pemanggilan, jadi
    // komentar yang sama muncul lagi tiap scroll. Tanpa `seen` di sini,
    // `emptyRounds` tidak pernah naik dan run menghabiskan semua scroll rounds.
    const seen = new Set<string>()
    let emptyRounds = 0
    for (let round = 0; round < req.maxScrollRounds; round++) {
      if (req.signal.aborted) return finish('stopped')
      if (Date.now() > deadline) return finish('timeout')

      let found: string[] = []
      try {
        found = await runJs<string[]>(buildTikTokHarvestScript(req.includeReplies))
      } catch {
        if (req.signal.aborted) return finish('stopped')
        if (Date.now() >= deadline) return finish(names.length ? 'incomplete' : 'timeout')
        found = []
      }
      const before = names.length
      if (Array.isArray(found)) {
        for (const name of found) {
          if (typeof name !== 'string') continue
          const key = name.trim().toLowerCase()
          if (!key || seen.has(key)) continue
          seen.add(key)
          names.push(name.trim())
        }
      }
      // Nama dari body API yang ditangkap CDP — tidak dibatasi virtualization.
      for (const name of apiNames) {
        if (typeof name !== 'string') continue
        const key = name.trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        names.push(name.trim())
      }
      emptyRounds = names.length === before ? emptyRounds + 1 : 0

      // API mengatakan tidak ada halaman lagi → berhenti lebih awal & tuntas.
      if (apiPages > 0 && !apiHasMore) {
        return finish('complete', `${apiPages} halaman API, ${intercepted.urls.length} respons`)
      }

      // Wheel asli memicu infinite-scroll TikTok; scrollTop tetap sebagai
      // fallback untuk container yang tidak merespons wheel.
      await wheelCommentPanel(cdp, runJs)
      try {
        await runJs(SCROLL_COMMENT_CONTAINER_JS)
      } catch {
        if (req.signal.aborted) return finish('stopped')
        /* tanpa container → putaran berikutnya harvest lagi */
      }

      // 3 putaran tanpa tambahan = panel habis (parity idle-grace lama).
      if (emptyRounds >= 3) {
        return finish(
          'complete',
          `${apiPages} halaman API, ${intercepted.urls.length} respons API`
        )
      }
      await sleep(req.scrollDelayMs, req.signal, deadline)
    }
    return finish('incomplete', `${apiPages} halaman API, ${intercepted.urls.length} respons API`)
  } catch (err) {
    return finish('error', err instanceof Error ? err.message : String(err))
  } finally {
    detach()
    for (const off of offListeners) off()
    if (cdp) await cdp.detach().catch(() => {})
  }
}
