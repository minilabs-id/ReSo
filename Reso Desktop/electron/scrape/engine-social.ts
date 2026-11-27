/**
 * Engine FB/IG Electron — ekstraktor nama komentator dari post yang SEDANG terbuka
 * di sebuah WebContentsView yang terlihat (counterpart dari engine-tiktok.ts).
 *
 * Prinsip:
 * - Semua pembacaan DOM dilakukan DI DALAM halaman lewat executeJavaScript.
 *   HTML mentah TIDAK pernah dikirim lewat IPC — yang kembali cuma string[].
 * - Facebook & Instagram punya struktur DOM yang berubah-ubah, jadi pakai
 *   heuristik + normalisasi `mergeNames` (sudah teruji di src/shared/normalize).
 * - Defensif: executeJavaScript dibungkus try/catch, fungsi TIDAK pernah throw.
 */

import type { WebContentsView } from 'electron'
import { mergeNames } from '../../src/shared/normalize'
import { isPlausibleHandle, shouldIncludeCandidate } from './engine-social-logic'
import { buildInstagramApiHarvestScript, type InstagramApiHarvestResult } from './instagram-api'
import {
  buildInstagramGraphqlHarvestScript,
  type InstagramGraphqlHarvestResult,
} from './instagram-graphql'
import { fetchFacebookHtmlNames } from './facebook-html'

// ===================== Tipe publik =====================

export interface SocialCaptureOptions {
  includeReplies: boolean
  maxScrollRounds: number
  scrollDelayMs: number
  timeoutMs: number
  /** URL postingan saat aksi ambil nama ditekan — hasil tidak boleh berpindah. */
  lockUrl?: string
  signal: { readonly aborted: boolean }
}

export interface SocialCaptureResult {
  names: string[]
  reason: 'complete' | 'incomplete' | 'stopped' | 'error' | 'timeout'
  detail?: string
  /** Catatan ringkas untuk UI (jumlah komentar/halaman, atau 0 komentar). */
  note?: string
  /** Postingan memang tidak punya komentar (bukan kegagalan scraping). */
  zeroComments?: boolean
}

type SocialPlatform = 'facebook' | 'instagram'

const ZERO_NAMES_DETAIL = 'Komentar belum terbuka / belum login.'

// ===================== Skrip in-page =====================

/**
 * Klik ringan untuk membuka panel komentar bila belum terbuka. Best-effort —
 * kegagalan diabaikan pemanggil (post memang mungkin sudah terbuka).
 */
const OPEN_COMMENTS_JS = `(() => {
  const re = /^(view all [\\d,]+ comments?|view all comments?|lihat semua [\\d,]+ komentar|show comments?|tampilkan komentar|comments?|komentar|[\\d,\\s]+comments?)$/i;
  // Instagram & TikTok memakai <div role="button"> / div biasa untuk tombol
  // "Comment(s)" — selector lama hanya button/a sehingga panel tak pernah open.
  const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, div, [aria-label], [data-e2e]'));
  for (const el of nodes) {
    const t = (el.textContent || '').trim();
    const al = (el.getAttribute('aria-label') || '').trim();
    if ((t && t.length < 40 && re.test(t)) || re.test(al)) {
      try { el.click(); return true; } catch (e) { /* lanjut */ }
    }
  }
  return false;
})()`

/**
 * Instagram mengabaikan `element.click()` dari executeJavaScript — panel komentar
 * hanya terbuka dengan klik trusted. Cari tautan "View all N comments" / ikon
 * Comment, lalu kirim mouse event lewat pipeline input Electron.
 */
async function openInstagramCommentsTrusted(
  view: WebContentsView,
  runJs: <T>(script: string) => Promise<T>
): Promise<boolean> {
  const wc = view.webContents
  if (typeof wc.sendInputEvent !== 'function') return false
  for (let attempt = 0; attempt < 3; attempt++) {
    await runJs(`(() => {
      const el = document.querySelector('a[href$="/comments/"]') || document.querySelector('svg[aria-label="Comment"]');
      if (el) el.scrollIntoView({ block: 'center' });
    })()`).catch(() => null)
    await new Promise((r) => setTimeout(r, 400))
    const box = await runJs<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector('a[href$="/comments/"]') || document.querySelector('svg[aria-label="Comment"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`).catch(() => null)
    if (!box) {
      await new Promise((r) => setTimeout(r, 500))
      continue
    }
    const vb = view.getBounds()
    const candidates: Array<[number, number]> = [
      [box.x, box.y],
      [box.x + vb.x, box.y + vb.y],
      [box.x + vb.x, box.y],
      [box.x, box.y + vb.y],
    ]
    for (const [x, y] of candidates) {
      try {
        wc.sendInputEvent({ type: 'mouseMove', x, y })
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      } catch {
        continue
      }
      await new Promise((r) => setTimeout(r, 1200))
      const opened = await runJs<boolean>(
        `document.querySelectorAll('a[href*="/c/"], [data-e2e="comment-username-1"]').length > 0`
      ).catch(() => false)
      if (opened) return true
    }
  }
  return false
}

/**
 * Scroll container komentar (paling dalam yang bisa di-scroll) atau window.
 * Mengembalikan boolean (apakah posisi berubah) — dipakai pemanggil hanya sebagai
 * informasi; penentu akhir tetap "3 putaran tanpa nama baru".
 */
const SCROLL_JS = `(() => {
  const isScrollable = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    const st = window.getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2;
  };
  const findScroller = (start) => {
    let el = start;
    let guard = 0;
    while (el && el !== document.body && el !== document.documentElement && guard < 30) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
      guard++;
    }
    return null;
  };
  const first = document.querySelector('[data-commentid], [role="article"], article, ul li');
  const scroller = first ? findScroller(first) : null;
  if (scroller) {
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(200, scroller.clientHeight * 0.8), scroller.scrollHeight);
    return scroller.scrollTop !== before;
  }
  const before = window.scrollY;
  window.scrollBy(0, Math.max(200, window.innerHeight * 0.8));
  return window.scrollY !== before;
})()`

/**
 * Bangun skrip panen nama. Nilai `platform` & `includeReplies` ditanamkan sebagai
 * literal (boolean/string aman) karena executeJavaScript tidak menerima argumen.
 */
export function buildHarvestScript(platform: SocialPlatform, includeReplies: boolean): string {
  return `(() => {
    const PLATFORM = ${JSON.stringify(platform)};
    const INCLUDE_REPLIES = ${includeReplies ? 'true' : 'false'};

    const seen = new Set();
    const out = [];
    const push = (raw) => {
      if (typeof raw !== 'string') return;
      const v = raw.trim();
      if (!v) return;
      const k = v.toLowerCase();
      if (seen.has(k)) return; // dedupe case-insensitive
      seen.add(k);
      out.push(v);
    };
    const clean = (s) => String(s == null ? '' : s)
      .replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '')
      .replace(/\\s+/g, ' ')
      .trim();

    if (PLATFORM === 'instagram') {
      // Aturan keputusan dipakai bersama test unit — source fungsi ini
      // diserialisasi supaya browser & test menjalankan logika yang identik.
      var SHOULD_INCLUDE = ${shouldIncludeCandidate.toString()};

      const RESERVED = new Set([
        'explore','reel','reels','direct','inbox','account','accounts','settings',
        'saved','activity','story','stories','p','tv','about','help','login',
        'signup','threads','followers','following','comment','comments','reply',
        'replies','tag','tags','nametag','new','edit'
      ]);
      const anchors = Array.from(document.querySelectorAll('a[href^="/"]'));
      const userRe = /^\\/([A-Za-z0-9._]{1,30})\\/?(?:[?#].*)?$/;
      const users = anchors.filter((a) => userRe.test(a.getAttribute('href') || ''));
      const rect = (el) => typeof el.getBoundingClientRect === 'function'
        ? el.getBoundingClientRect() : { top: 0, left: 0 };

      // Tiap komentar IG punya anchor timestamp /p/<shortcode>/c/<id>/ yang
      // sejajar dengan anchor username. Ini sinyal struktural, bukan absolut —
      // filter lama left &lt; 600 menggugurkan SEMUA komentar di browser 789px.
      const stamps = anchors.filter((a) => /\\/p\\/[^/]+\\/c\\/[^/?#]+/.test(a.getAttribute('href') || ''));
      const candidates = [];

      if (stamps.length) {
        for (const s of stamps) {
          const sr = rect(s);
          let best = null;
          for (const a of users) {
            const ar = rect(a);
            if (Math.abs(ar.top - sr.top) > 8 || ar.left >= sr.left) continue;
            if (!best || ar.left > rect(best).left) best = a;
          }
          if (best) {
            candidates.push({
              a: best,
              depth: Math.max(0, ((s.getAttribute('href') || '').match(/\\/c\\//g) || []).length - 1)
            });
          }
        }
      } else {
        // Fallback bila DOM berubah: pakai cluster posisi RELATIF (modus),
        // bukan angka piksel tetap yang bergantung lebar jendela.
        const counts = new Map();
        for (const u of users) {
          const key = Math.round(rect(u).left / 10) * 10;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const base = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
        if (base != null) {
          for (const u of users) {
            if (Math.abs(Math.round(rect(u).left / 10) * 10 - base) < 5) {
              candidates.push({ a: u, depth: 0 });
            }
          }
        }
      }

      const minLeft = candidates.length ? Math.min(...candidates.map((c) => rect(c.a).left)) : 0;
      for (const { a, depth } of candidates) {
        const href = a.getAttribute('href') || '';
        const user = (href.match(userRe) || [])[1];
        if (!user) continue;
        const rawLabel = (a.textContent || '').trim();
        const verified = /Verified$/i.test(rawLabel);
        const label = rawLabel.replace(/Verified$/i, '').trim();
        let nearFollow = false;
        let ancestor = a.parentElement;
        for (let d = 0; ancestor && d < 5 && !nearFollow; d++, ancestor = ancestor.parentElement) {
          const btns = ancestor.querySelectorAll('button, [role="button"]');
          for (const b of btns) {
            const bt = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
            if (/^(Follow|Following|Ikuti|Mengikuti)$/i.test(bt)) { nearFollow = true; break; }
          }
        }
        if (SHOULD_INCLUDE({
          user,
          label,
          reserved: RESERVED.has(user.toLowerCase()),
          verified,
          inNav: !!a.closest('nav, header, aside, footer, form, [role="navigation"], [role="menubar"], [role="menu"], [role="banner"]'),
          nearFollow,
          depth,
          left: rect(a).left,
          minLeft,
          includeReplies: INCLUDE_REPLIES
        })) push(user);
      }
    } else {
      // Facebook: pakai sinyal struktural "Komentar oleh <nama> <waktu>" lebih
      // dulu. Heuristik lama tetap sebagai fallback bila aria-label berubah.
      const timeRe = /\\s+\\d+\\s+(jam|menit|detik|hari|minggu|tahun|bulan|hr|min|second|minute|hour|day|week|month|year)s?\\b.*$/i;
      const labelName = (label) => {
        if (typeof label !== 'string') return '';
        // FB menyisipkan zero-width chars di teks — bersihkan sebelum regex.
        const s = clean(label)
          .replace(/^(Komentar|Comment)\\s+oleh\\s+/i, '')
          .replace(/^Comment\\s+by\\s+/i, '');
        const v = s.replace(timeRe, '').trim();
        if (!v || v.length > 100 || /\\s{6,}/.test(v) || /^\\d+$/.test(v)) return '';
        return v;
      };
      const articles = Array.from(document.querySelectorAll('[role="article"][aria-label]'));
      for (const a of articles) {
        const label = a.getAttribute('aria-label') || '';
        const isComment = /^(Komentar|Comment)\\s+oleh\\s+/i.test(label) || /^Comment\\s+by\\s+/i.test(label);
        const isReply = /^(Balasan|Reply)\\s+oleh\\s+/i.test(label) || /^Reply\\s+by\\s+/i.test(label);
        if (!isComment && !(INCLUDE_REPLIES && isReply)) continue;
        const v = labelName(label);
        if (v) push(v);
      }

      if (!out.length) {
        // Fallback lama — selector generik bila aria-label tidak tersedia.
        const SEL = '[data-commentid], [role="article"]';
        const plausible = (v) => {
          if (!v || v.length < 2 || v.length > 100) return false;
          if (/^\\d+$/.test(v)) return false;
          if (/https?:\\/\\//i.test(v)) return false;
          if (v.split(/\\s+/).length > 6) return false;
          if (/^(reply|replies|like|love|share|comment|comments|see more|balas|suka|bagikan|komentar|lihat selengkapnya|edited|following|follow)$/i.test(v)) return false;
          if (!/[\\p{L}\\p{N}]/u.test(v)) return false;
          return true;
        };
        const norm = (s) => clean(s)
          .replace(/\\s+[·•|].*$/, '')
          .replace(/\\s+\\d+\\s+(jam|menit|detik|hari|minggu|tahun|bulan|hr|min|second|minute|hour|day|week|month|year)s?\\b.*$/i, '')
          .replace(/\\s+(about\\s+)?(a|an|\\d+)\\s+(second|minute|hour|day|week|month|year)s?\\s+ago.*$/i, '')
          .trim();
        const authorOf = (root) => {
          const nested = Array.from(root.querySelectorAll(SEL));
          const inNested = (el) => nested.some((n) => n !== el && n.contains(el));
          const sels = ['a[role="link"]', 'strong', 'a[href^="/"]', '[dir="auto"]'];
          for (const sel of sels) {
            const els = Array.from(root.querySelectorAll(sel));
            for (const el of els) {
              if (inNested(el)) continue; // jangan ambil nama dari balasan bersarang
              const v = norm(el.getAttribute('aria-label') || el.textContent || '');
              if (plausible(v)) return v;
            }
          }
          const al = root.getAttribute('aria-label');
          if (al) { const v = norm(al); if (plausible(v)) return v; }
          return '';
        };
        const roots = Array.from(document.querySelectorAll(SEL));
        for (const root of roots) {
          if (!INCLUDE_REPLIES && roots.some((o) => o !== root && o.contains(root))) continue;
          // Lewati artikel induk (post itu sendiri) bila tampak sebagai post.
          if (!root.hasAttribute('data-commentid')) {
            if (roots.some((o) => o !== root && root.contains(o))) continue;
            if ((root.textContent || '').length > 600) continue;
          }
          const v = authorOf(root);
          if (v) push(v);
        }
        // Fallback: baris dengan tombol Reply/Balas, lalu ambil nama di dekatnya.
        if (!out.length) {
          const rep = /^(reply|balas)$/i;
          const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, [aria-label]'));
          for (const b of nodes) {
            const bt = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
            if (!rep.test(bt)) continue;
            const row = b.parentElement && b.parentElement.parentElement;
            if (!row) continue;
            const a = row.querySelector('a[role="link"], strong, a[href^="/"]');
            if (a) { const v = norm(a.getAttribute('aria-label') || a.textContent || ''); if (plausible(v)) push(v); }
          }
        }
      }
    }
    return out;
  })()`
}

/** Jumlah komentar yang diumumkan FB di halaman (bila ada). */
export function buildFacebookMetaScript(): string {
  return `(() => {
    const text = document.body.innerText || '';
    const re = /(Lihat|View)\\s+([\\d.,]+)\\s*(komentar|comments?|balasan|replies)|\\b([0-9]{2,})\\s*(komentar|comments?)\\b/gi;
    let declared = 0;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[2] || m[4] || '';
      const n = parseInt(raw.replace(/[.,]/g, ''), 10);
      // Angka 1 sering berasal dari jumlah reaksi — bukan jumlah komentar.
      if (Number.isFinite(n) && n >= 2 && n < 100000 && n > declared) declared = n;
    }
    return { declared: declared || null };
  })()`
}

// ===================== Util =====================

/** Tidur kooperatif: berhenti lebih awal saat abort atau deadline tercapai. */
function sleep(ms: number, signal: { readonly aborted: boolean }, deadline: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve()
      return
    }
    const step = 50
    let waited = 0
    const tick = setInterval(() => {
      waited += step
      if (signal.aborted || Date.now() >= deadline || waited >= ms) {
        clearInterval(tick)
        resolve()
      }
    }, step)
  })
}

// ===================== Engine =====================

export async function runSocialCapture(
  view: WebContentsView,
  platform: SocialPlatform,
  options: SocialCaptureOptions
): Promise<SocialCaptureResult> {
  const names: string[] = []
  const seen = new Set<string>()
  const signal = options.signal
  const usePlatform: SocialPlatform = platform === 'instagram' ? 'instagram' : 'facebook'
  // Instagram bisa punya ribuan komentar; batas waktu bawaan terlalu pendek
  // untuk menuntaskan paginasi. Beri ruang lebih besar hanya pada jalur IG.
  const budgetMs =
    usePlatform === 'instagram' ? Math.max(180_000, options.timeoutMs) : Math.max(0, options.timeoutMs)
  const deadline = Date.now() + budgetMs
  let zeroComments = false
  let fbDeclared: number | null = null
  let fbNoComments = false

  /**
   * Setiap executeJavaScript dibatasi sisa deadline & abort. Tanpa ini, halaman
   * yang menggantung membuat run tidak bisa dihentikan (STOP hanya mengubah
   * flag, tapi await tidak pernah selesai).
   */
  const runJs = <T>(script: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(
        () => settle(() => reject(new Error('scrape-timeout'))),
        Math.max(1, deadline - Date.now())
      )
      const poll = setInterval(() => {
        if (signal.aborted) settle(() => reject(new Error('scrape-aborted')))
      }, 50)
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearInterval(poll)
        fn()
      }
      try {
        view.webContents.executeJavaScript(script, true).then(
          (v) => settle(() => resolve(v as T)),
          (e) => settle(() => reject(e))
        )
      } catch (err) {
        settle(() => reject(err))
      }
    })

  /** Akhiri run: normalisasi + dedupe final lewat aturan platform masing-masing. */
  const finish = (
    reason: SocialCaptureResult['reason'],
    detail?: string,
    note?: string
  ): SocialCaptureResult => {
    const merged = mergeNames([], names, usePlatform)
    let finalDetail = detail
    if (!merged.length && fbNoComments) {
      finalDetail = 'Postingan ini tidak punya komentar.'
      zeroComments = true
    }
    if (!merged.length && reason !== 'error' && reason !== 'stopped' && !finalDetail) {
      finalDetail = ZERO_NAMES_DETAIL
    }
    // FB: sampaikan apakah hasilnya tuntas bila FB mengumumkan jumlah komentar.
    let finalNote = note
    if (!finalNote && fbNoComments && !merged.length) finalNote = 'Postingan ini tidak punya komentar.'
    if (!finalNote && usePlatform === 'facebook' && merged.length) {
      finalNote = fbDeclared && fbDeclared > 0
        ? merged.length >= fbDeclared
          ? `Tuntas — ${merged.length} nama dari ${fbDeclared} komentar.`
          : `Sebagian — ${merged.length} nama dari ${fbDeclared} komentar; klik Ambil nama lagi.`
        : `Diambil ${merged.length} nama.`
    }
    const extra = {
      ...(zeroComments ? { zeroComments: true } : {}),
      ...(finalNote ? { note: finalNote } : {}),
    }
    return finalDetail ? { names: merged, reason, detail: finalDetail, ...extra } : { names: merged, reason, ...extra }
  }

  /** Tambah nama baru (dedupe case-insensitive). Returns jumlah yang baru. */
  const addFound = (found: unknown): number => {
    if (!Array.isArray(found)) return 0
    let added = 0
    for (const n of found) {
      if (typeof n !== 'string') continue
      const v = n.trim()
      const key = v.toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      names.push(v)
      added++
    }
    return added
  }

  try {
    const wc = view.webContents
    const pathOf = (u: string): string => {
      try {
        return new URL(u).pathname.replace(/\/+$/, '')
      } catch {
        return u
      }
    }
    const lockedPath = options.lockUrl ? pathOf(options.lockUrl) : null
    if (lockedPath && pathOf(wc.getURL()) !== lockedPath) {
      return finish('error', 'Postingan berpindah saat proses — buka postingan yang sama lalu ulangi.')
    }

    // Instagram: dua jalur independen. REST dulu, lalu GraphQL Relay dengan
    // doc_id yang ditemukan dari bundle — bukan klik DOM yang diabaikan IG.
    if (usePlatform === 'instagram') {
      const restNames: string[] = []
      const gqlNames: string[] = []
      let restComplete = false
      let gqlComplete = false
      let zero = false
      let commentCount = 0
      let restStatus = 'kosong'
      let gqlStatus = 'tidak-dijalankan'

      try {
        const api = await runJs<InstagramApiHarvestResult>(
          buildInstagramApiHarvestScript({
            // Tidak terikat putaran scroll: habiskan cursor sampai tuntas.
            maxPages: 500,
            includeReplies: options.includeReplies,
          })
        )
        if (api) {
          restStatus = api.status
          commentCount = api.commentCount
          restNames.push(...api.names, ...api.replyNames)
          restComplete = api.complete
          zero = api.zero
        }
      } catch (e) {
        restStatus = 'error:' + String(e).slice(0, 48)
      }

      if (!restComplete && !zero) {
        try {
          const gql = await runJs<InstagramGraphqlHarvestResult>(
            buildInstagramGraphqlHarvestScript({
              maxPages: 500,
              includeReplies: options.includeReplies,
            })
          )
          if (gql) {
            gqlStatus = gql.status
            gqlNames.push(...gql.names)
            gqlComplete = gql.complete
            commentCount = Math.max(commentCount, gql.commentCount)
          }
        } catch (e) {
          gqlStatus = 'error:' + String(e).slice(0, 48)
        }
      }

      if (lockedPath && pathOf(wc.getURL()) !== lockedPath) {
        return finish('error', 'Postingan berpindah saat proses — buka postingan yang sama lalu ulangi.')
      }

      const valid = [...new Set([...restNames, ...gqlNames])].filter(isPlausibleHandle)
      if (valid.length) {
        addFound(valid)
        const complete = restComplete || gqlComplete
        const note = complete
          ? `Tuntas — ${valid.length} username dari ${commentCount} komentar.`
          : `Sebagian — ${valid.length} username dari ${commentCount} komentar; ulangi untuk melengkapi.`
        return finish(complete ? 'complete' : 'incomplete', undefined, note)
      }
      if (zero) {
        zeroComments = true
        return finish('complete', 'Postingan ini tidak punya komentar.', 'Postingan ini tidak punya komentar.')
      }
      return finish(
        'error',
        `Gagal mengambil komentar Instagram (REST: ${restStatus}, GraphQL: ${gqlStatus}). Pastikan sudah login & tidak kena rate limit.`
      )
    }

    if (usePlatform === 'facebook') {
      try {
        const meta = await runJs<{ declared?: number | null }>(buildFacebookMetaScript())
        fbDeclared = typeof meta?.declared === 'number' ? meta.declared : null
      } catch {
        /* jumlah komentar tidak tersedia — tetap panen */
      }
      // Fallback mandiri: HTML postingan diambil main process dengan cookie sesi.
      // Tidak bergantung pada DOM/virtualisasi & tidak terkena CORS halaman.
      if (options.lockUrl) {
        try {
          const htmlNames = await fetchFacebookHtmlNames(
            wc.session,
            options.lockUrl,
            options.includeReplies,
            Math.min(20000, Math.max(5000, deadline - Date.now()))
          )
          if (htmlNames !== null) {
            addFound(htmlNames)
            if (!htmlNames.length) fbNoComments = true
          }
        } catch {
          /* fallback gagal — DOM tetap dipakai */
        }
      }
    }

    // Best-effort: buka panel komentar bila belum terbuka.
    try {
      await runJs(OPEN_COMMENTS_JS)
    } catch {
      /* abaikan — post mungkin sudah terbuka */
    }
    // Panel komentar IG/FB butuh waktu untuk me-render setelah tombol diklik.
    // Tanpa jeda ini, putaran pertama memanen hanya penulis post lalu 3 putaran
    // kosong berikutnya mengakhiri run sebelum komentar sempat muncul.
    await sleep(Math.min(2000, Math.max(800, options.scrollDelayMs)), signal, deadline)
    if (signal.aborted) return finish('stopped')
    if (Date.now() > deadline) return finish(names.length ? 'incomplete' : 'timeout')

    const harvest = buildHarvestScript(usePlatform, options.includeReplies)
    const rounds = Math.max(0, Math.floor(options.maxScrollRounds))
    const delay = Math.max(0, options.scrollDelayMs)
    let emptyRounds = 0

    for (let round = 0; round < rounds; round++) {
      if (signal.aborted) return finish('stopped')
      if (Date.now() > deadline) return finish(names.length ? 'incomplete' : 'timeout')
      // Jangan pernah memanen dari postingan lain bila operator scroll saat run.
      if (lockedPath && pathOf(wc.getURL()) !== lockedPath) {
        return finish('error', 'Postingan berpindah saat proses — buka postingan yang sama lalu ulangi.')
      }

      let found: unknown = []
      try {
        found = await runJs(harvest)
      } catch (err) {
        if (signal.aborted) return finish('stopped')
        if (Date.now() >= deadline) return finish(names.length ? 'incomplete' : 'timeout')
        found = []
      }
      emptyRounds = addFound(found) === 0 ? emptyRounds + 1 : 0

      // Geser container komentar / window untuk memuat komentar berikutnya.
      try {
        await runJs(SCROLL_JS)
      } catch {
        /* tanpa container → putaran berikutnya panen lagi */
      }

      // 3 putaran tanpa nama baru = akhir komentar yang stabil.
      if (emptyRounds >= 3) {
        return finish('complete', names.length ? undefined : ZERO_NAMES_DETAIL)
      }

      if (delay > 0) {
        await sleep(delay, signal, deadline)
        if (signal.aborted) return finish('stopped')
        if (Date.now() > deadline) return finish(names.length ? 'incomplete' : 'timeout')
      }
    }

    return finish('incomplete')
  } catch (err) {
    return finish('error', err instanceof Error ? err.message : String(err))
  }
}
