/**
 * Klien Instagram Private Web API untuk pengambilan nama komentator.
 *
 * Dasar implementasi (lihat INSTAGRAM_ARCHITECTURE_RESEARCH.md):
 * - shortcode → media pk memakai base64 BigInt (Number meleset di >2^53)
 * - paginasi mengikuti kontrak instagrapi / instagram-private-api:
 *   max_id bila has_more_comments, min_id bila has_more_headload_comments
 * - balasan: preview_child_comments + endpoint inline_child_comments
 * - autentikasi memakai cookie sesi aplikasi (X-CSRFToken + X-IG-App-ID)
 * - paginasi berjalan sampai cursor habis / comment_count tercapai, bukan
 *   sampai angka putaran — retry 429/5xx dengan backoff.
 *
 * Modul ini tidak mengirim HTML ke main process — hanya string[] nama & metadata.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Convert shortcode IG ke numeric media pk (tanpa suffix _userId). */
export function shortcodeToPk(shortcode: string): string | null {
  const sc = shortcode.slice(0, 11)
  if (!sc) return null
  let n = 0n
  for (const ch of sc) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) return null
    n = n * 64n + BigInt(i)
  }
  return n.toString()
}

export interface InstagramApiHarvestOptions {
  /** Jumlah halaman maksimum (pengaman; 15 komentar per halaman). */
  maxPages: number
  includeReplies: boolean
  /** Maksimum induk yang balasannya diambil lewat endpoint tambahan. */
  maxReplyParents?: number
  /** Maksimum halaman balasan per induk. */
  maxReplyPages?: number
}

export interface InstagramApiHarvestResult {
  names: string[]
  replyNames: string[]
  commentCount: number
  /** Jumlah komentar mentah yang berhasil dibaca (sebelum dedupe). */
  rawCount: number
  pages: number
  replyPages: number
  status: string
  id: string
  /** Postingan memang 0 komentar (bukan kegagalan). */
  zero: boolean
  exhausted: boolean
  /** true bila semua komentar yang tersedia sudah terbaca. */
  complete: boolean
}

/**
 * Script yang dijalankan DI DALAM halaman Instagram lewat executeJavaScript.
 * Fetch relative memakai cookie sesi yang sudah tersimpan di partition view.
 */
export function buildInstagramApiHarvestScript(options: InstagramApiHarvestOptions): string {
  const pages = Math.max(1, Math.min(500, Math.floor(options.maxPages)))
  const replyParents = Math.max(0, Math.min(150, Math.floor(options.maxReplyParents ?? 80)))
  const replyPages = Math.max(0, Math.min(5, Math.floor(options.maxReplyPages ?? 3)))
  return `(async () => {
    const MAX_PAGES = ${pages};
    const INCLUDE_REPLIES = ${options.includeReplies ? 'true' : 'false'};
    const MAX_REPLY_PARENTS = ${replyParents};
    const MAX_REPLY_PAGES = ${replyPages};
    const ALPHA = ${JSON.stringify(ALPHABET)};
    const empty = (status) => ({
      names: [], replyNames: [], commentCount: 0, rawCount: 0, pages: 0,
      replyPages: 0, status, id: '', zero: false, exhausted: false, complete: false,
    });

    const html = document.documentElement.innerHTML;
    // URL shortcode = identitas kanonik postingan yang dibuka operator.
    // HTML reel memuat banyak "media_id" dari rekomendasi → jangan dipakai
    // sebagai sumber utama (akan memanen komentar postingan lain).
    const sc = (location.pathname.match(/\\/(?:p|reel|reels|tv)\\/([^/?#]+)/) || [])[1];
    let id = null;
    if (sc) {
      let n = 0n;
      for (const ch of sc.slice(0, 11)) {
        const i = ALPHA.indexOf(ch);
        if (i < 0) return empty('bad-shortcode');
        n = n * 64n + BigInt(i);
      }
      id = n.toString();
    }
    if (!id) {
      id = (html.match(/"media_id":"(\\d+)"/) || [])[1]
        || (html.match(/"pk":(\\d+)/) || [])[1]
        || null;
    }
    if (!id) return empty('no-post');

    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
    const H = {
      'X-IG-App-ID': '936619743392459',
      'X-CSRFToken': csrf,
      'X-Requested-With': 'XMLHttpRequest',
    };
    const base = '/api/v1/media/' + id + '/comments/';
    const firstQs = '?can_support_threading=true&permalink_enabled=false';

    const names = [];
    const replyNames = [];
    const replyTargets = [];
    const push = (arr, u) => {
      if (typeof u === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(u)) arr.push(u);
    };
    const get = async (url) => {
      if (window.__resoHarvestAbort === true) throw new Error('aborted');
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          if (window.__resoHarvestAbort === true) throw new Error('aborted');
          const res = await fetch(url, { headers: H, credentials: 'include' });
          if (res.status === 429 || res.status >= 500) {
            await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
            continue;
          }
          if (!res.ok) throw new Error('HTTP-' + res.status);
          return await res.json();
        } catch (e) {
          if (attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      throw new Error('retry-exhausted');
    };

    let status = 'ok';
    let commentCount = 0;
    let rawCount = 0;
    let pages = 0;
    let replyPages = 0;
    let exhausted = false;
    let complete = false;
    let j = null;

    try {
      j = await get(base + firstQs);
      if (j.status && j.status !== 'ok') {
        return { ...empty(String(j.status)), id };
      }
      const reported = Number(j.comment_count);
      commentCount = Number.isFinite(reported) && reported > 0 ? reported : 0;
      // comment_count bisa absen/0 walau array comments berisi — jangan pakai
      // itu sebagai gate sebelum halaman pertama dipanen.

      const used = new Set();
      for (let p = 0; p < MAX_PAGES && !complete; p++) {
        if (window.__resoHarvestAbort === true) break;
        const list = Array.isArray(j.comments) ? j.comments : [];
        rawCount += list.length;
        for (const c of list) {
          if (c && c.user) push(names, c.user.username);
          if (!c) continue;
          if (INCLUDE_REPLIES && Array.isArray(c.preview_child_comments)) {
            for (const rc of c.preview_child_comments) if (rc && rc.user) push(replyNames, rc.user.username);
          }
          if (INCLUDE_REPLIES && (c.child_comment_count || 0) > (c.preview_child_comments || []).length && c.pk) {
            replyTargets.push({ pk: String(c.pk), cursor: c.next_min_child_cursor || null });
          }
        }
        pages++;

        // Kontrak resmi IG: prioritaskan max_id (kronologis), lalu min_id (ranked).
        let next = null;
        if (j.has_more_comments && j.next_max_id) next = { k: 'max_id', v: String(j.next_max_id) };
        else if (j.has_more_headload_comments && j.next_min_id) next = { k: 'min_id', v: String(j.next_min_id) };

        // comment_count hanya pengaman sekunder: jangan potong paginasi yang
        // masih punya cursor hanya karena angkanya sudah terlampaui.
        if (commentCount > 0 && rawCount >= commentCount && !next) { complete = true; break; }

        if (!next || used.has(next.k + ':' + next.v) || !list.length) {
          if (!next || !list.length) complete = true;
          else if (used.has(next.k + ':' + next.v)) { exhausted = true; complete = true; }
          break;
        }
        used.add(next.k + ':' + next.v);
        try {
          j = await get(base + firstQs + '&' + next.k + '=' + encodeURIComponent(next.v));
        } catch (e) {
          status = 'page:' + String(e).slice(0, 60);
          break;
        }
        await new Promise((r) => setTimeout(r, 60));
      }

      if (INCLUDE_REPLIES && replyTargets.length && MAX_REPLY_PARENTS > 0 && MAX_REPLY_PAGES > 0) {
        for (const t of replyTargets.slice(0, MAX_REPLY_PARENTS)) {
          const seen = new Set();
          let cursor = t.cursor;
          for (let rp = 0; rp < MAX_REPLY_PAGES; rp++) {
            const suffix = cursor ? '?min_id=' + encodeURIComponent(cursor) : '';
            const url = '/api/v1/media/' + id + '/comments/' + encodeURIComponent(t.pk) + '/inline_child_comments/' + suffix;
            try {
              const rj = await get(url);
              const kids = Array.isArray(rj.child_comments) ? rj.child_comments : [];
              for (const k of kids) if (k && k.user) push(replyNames, k.user.username);
              replyPages++;
              const more = rj.has_more_head_child_comments && rj.next_min_child_cursor;
              if (!more || seen.has(rj.next_min_child_cursor) || !kids.length) break;
              seen.add(rj.next_min_child_cursor);
              cursor = rj.next_min_child_cursor;
            } catch (e) {
              status = 'reply:' + String(e).slice(0, 60);
              break;
            }
          }
        }
      }
    } catch (e) {
      status = 'error:' + String(e).slice(0, 80);
    }

    return {
      names,
      replyNames,
      commentCount,
      rawCount,
      pages,
      replyPages,
      status,
      id,
      zero: status === 'ok' && rawCount === 0 && names.length === 0,
      exhausted,
      complete,
    };
  })()`
}
