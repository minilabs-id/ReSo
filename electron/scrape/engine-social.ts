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

// ===================== Tipe publik =====================

export interface SocialCaptureOptions {
  includeReplies: boolean
  maxScrollRounds: number
  scrollDelayMs: number
  timeoutMs: number
  signal: { readonly aborted: boolean }
}

export interface SocialCaptureResult {
  names: string[]
  reason: 'complete' | 'incomplete' | 'stopped' | 'error' | 'timeout'
  detail?: string
}

type SocialPlatform = 'facebook' | 'instagram'

const ZERO_NAMES_DETAIL = 'Komentar belum terbuka / belum login.'

// ===================== Skrip in-page =====================

/**
 * Klik ringan untuk membuka panel komentar bila belum terbuka. Best-effort —
 * kegagalan diabaikan pemanggil (post memang mungkin sudah terbuka).
 */
const OPEN_COMMENTS_JS = `(() => {
  const re = /^(view (all )?(\\d+ )?comments?|lihat (semua )?(\\d+ )?komentar|show comments?|tampilkan komentar|comments?|komentar)$/i;
  const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, [aria-label]'));
  for (const el of nodes) {
    const t = (el.textContent || '').trim();
    const al = (el.getAttribute('aria-label') || '').trim();
    if (re.test(t) || re.test(al)) {
      try { el.click(); return true; } catch (e) { /* lanjut */ }
    }
  }
  return false;
})()`

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
function buildHarvestScript(platform: SocialPlatform, includeReplies: boolean): string {
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
      // Username IG: anchor profil /username/ di area komentar.
      const RESERVED = new Set([
        'explore','reel','reels','direct','inbox','account','accounts','settings',
        'saved','activity','story','stories','p','tv','about','help','login',
        'signup','threads','followers','following','comment','comments','reply',
        'replies','tag','tags','nametag','new','edit'
      ]);
      const anchors = Array.from(document.querySelectorAll('a[href^="/"]'));
      const measured = [];
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/^\\/([A-Za-z0-9._]{1,30})\\/?(?:[?#].*)?$/);
        if (!m) continue;
        const user = m[1].replace(/^@/, '');
        if (!user || RESERVED.has(user.toLowerCase())) continue;
        // Buang tautan navigasi/menu/header (bukan komentator).
        if (a.closest('nav, header, aside, footer, form, [role="navigation"], [role="menubar"], [role="menu"], [role="banner"]')) continue;
        // Penulis post biasanya berada di baris dengan tombol Follow/Following.
        let nearFollow = false;
        const row = a.parentElement && a.parentElement.parentElement;
        if (row) {
          const btns = row.querySelectorAll('button, [role="button"]');
          for (const b of btns) {
            const bt = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
            if (/^(Follow|Following|Ikuti|Mengikuti)$/i.test(bt)) { nearFollow = true; break; }
          }
        }
        if (nearFollow) continue;
        let cls = '';
        let p = a.parentElement;
        for (let i = 0; p && i < 8; i++) {
          cls += ' ' + (typeof p.className === 'string' ? p.className : '') + ' ' + (p.id || '');
          p = p.parentElement;
        }
        const byClass = /reply|balas/i.test(cls);
        const rect = typeof a.getBoundingClientRect === 'function' ? a.getBoundingClientRect() : null;
        measured.push({ user, byClass, left: rect ? rect.left : 0 });
      }
      // Balasan IG biasanya di-indent; pakai left terkecil sebagai baseline.
      let baseline = Infinity;
      for (const it of measured) if (!it.byClass && it.left < baseline) baseline = it.left;
      for (const it of measured) {
        const isReply = it.byClass || (it.left > baseline + 24);
        if (isReply && !INCLUDE_REPLIES) continue;
        push(it.user);
      }
    } else {
      // Facebook: nama penulis dari kontainer komentar.
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
    return out;
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
  const deadline = Date.now() + Math.max(0, options.timeoutMs)
  const usePlatform: SocialPlatform = platform === 'instagram' ? 'instagram' : 'facebook'

  /** Akhiri run: normalisasi + dedupe final lewat aturan platform masing-masing. */
  const finish = (reason: SocialCaptureResult['reason'], detail?: string): SocialCaptureResult => {
    const merged = mergeNames([], names, usePlatform)
    let finalDetail = detail
    if (!merged.length && reason !== 'error' && reason !== 'stopped' && !finalDetail) {
      finalDetail = ZERO_NAMES_DETAIL
    }
    return finalDetail ? { names: merged, reason, detail: finalDetail } : { names: merged, reason }
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

    // Best-effort: buka panel komentar bila belum terbuka.
    try {
      await wc.executeJavaScript(OPEN_COMMENTS_JS, true)
    } catch {
      /* abaikan — post mungkin sudah terbuka */
    }

    if (signal.aborted) return finish('stopped')
    if (Date.now() > deadline) return finish(names.length ? 'incomplete' : 'timeout')

    const harvest = buildHarvestScript(usePlatform, options.includeReplies)
    const rounds = Math.max(0, Math.floor(options.maxScrollRounds))
    const delay = Math.max(0, options.scrollDelayMs)
    let emptyRounds = 0

    for (let round = 0; round < rounds; round++) {
      if (signal.aborted) return finish('stopped')
      if (Date.now() > deadline) return finish(names.length ? 'incomplete' : 'timeout')

      let found: unknown = []
      try {
        found = await wc.executeJavaScript(harvest, true)
      } catch {
        found = []
      }
      emptyRounds = addFound(found) === 0 ? emptyRounds + 1 : 0

      // Geser container komentar / window untuk memuat komentar berikutnya.
      try {
        await wc.executeJavaScript(SCROLL_JS, true)
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
