/**
 * Fallback Instagram #2 — GraphQL web internal.
 *
 * Jalur ini TIDAK memanggil `/api/v1/media/.../comments/`. Ia memakai query
 * Relay yang sama seperti halaman IG:
 *   POST /api/graphql  (PolarisPostCommentsPaginationQuery)
 *
 * Dua hal yang harus ditemukan saat runtime (tidak boleh di-hardcode):
 * 1. doc_id — dibaca dari bundle JS halaman.
 * 2. template parameter (lsd, __dyn, __csr, fb_dtsg, ...) — ditangkap dari
 *    request GraphQL apa pun yang dibuat halaman, lewat patch XHR/fetch yang
 *    dipasang di document-start (lihat IG_GQL_CAPTURE_JS).
 *
 * Ini bukan jalur utama: REST endpoint lebih sederhana. GraphQL dipakai bila
 * REST gagal/status != ok atau belum tuntas.
 */

/** Dipasang di document-start lewat CDP Page.addScriptToEvaluateOnNewDocument. */
export const IG_GQL_CAPTURE_JS = `(() => {
  if (window.__resoGqlCaptureInstalled) return;
  window.__resoGqlCaptureInstalled = true;
  const save = (body, headers, url) => {
    try {
      const s = String(body || '');
      if (!s.includes('doc_id=')) return;
      window.__resoGqlTemplate = {
        body: s,
        headers: JSON.parse(JSON.stringify(headers || {})),
        url: String(url || ''),
      };
    } catch (e) {}
  };
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/graphql') && init && init.method === 'POST' && init.body) {
        save(init.body, init.headers || {}, url);
      }
    } catch (e) {}
    return origFetch(input, init);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__resoUrl = String(url || '');
    this.__resoMethod = String(method || '');
    this.__resoHeaders = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__resoHeaders) this.__resoHeaders[k] = v } catch (e) {}
    return origHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__resoUrl && this.__resoUrl.includes('/api/graphql') &&
          this.__resoMethod === 'POST' && body) {
        save(body, this.__resoHeaders || {}, this.__resoUrl);
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };
})()`

export interface InstagramGraphqlHarvestOptions {
  maxPages: number
  includeReplies: boolean
}

export interface InstagramGraphqlHarvestResult {
  names: string[]
  commentCount: number
  rawCount: number
  pages: number
  status: string
  id: string
  docId: string
  complete: boolean
}

/** Regex murni — dipakai di browser & di test unit. */
export function findCommentsDocId(bundleText: string): string {
  const m = bundleText.match(
    /PolarisPostCommentsPaginationQuery_instagramRelayOperation[\s\S]{0,240}?a\.exports="(\d+)"/
  )
  return m ? m[1]! : ''
}

export function buildInstagramGraphqlHarvestScript(options: InstagramGraphqlHarvestOptions): string {
  const pages = Math.max(1, Math.min(500, Math.floor(options.maxPages)))
  return `(async () => {
    const MAX_PAGES = ${pages};
    const INCLUDE_REPLIES = ${options.includeReplies ? 'true' : 'false'};
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const findDocId = ${findCommentsDocId.toString()};
    const empty = (status) => ({
      names: [], commentCount: 0, rawCount: 0, pages: 0,
      status, id: '', docId: '', complete: false,
    });

    // 1. media pk dari shortcode URL (kanonik).
    const sc = (location.pathname.match(/\\/(?:p|reel|reels|tv)\\/([^/?#]+)/) || [])[1];
    if (!sc) return empty('no-post');
    let pk = 0n;
    for (const ch of sc.slice(0, 11)) {
      const i = ALPHA.indexOf(ch);
      if (i < 0) return empty('bad-shortcode');
      pk = pk * 64n + BigInt(i);
    }
    const mediaId = pk.toString();

    // 2. Template request asli — doc_id diambil dari sana bila tersedia.
    const tpl = window.__resoGqlTemplate;
    if (!tpl || !tpl.body || !tpl.body.includes('doc_id=')) return empty('no-template');
    let docId = '';
    const tplDoc = String(tpl.body.match(/doc_id=(\d+)/)?.[1] || '');
    if (/^\d+$/.test(tplDoc)) docId = tplDoc;

    // Bundle hanya fallback bila template tidak membawa doc_id yang dikenal.
    if (!docId) {
      const html = document.documentElement.innerHTML;
      const scripts = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
      for (const src of scripts.slice(0, 5)) {
        try {
          const txt = await (await fetch(src, { credentials: 'omit' })).text();
          docId = findDocId(txt);
          if (docId) break;
        } catch (e) {}
      }
    }
    if (!docId) return empty('no-doc-id');

    const names = [];
    const seenCursor = new Set();
    const push = (u) => {
      if (typeof u === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(u)) names.push(u);
    };
    const varsOf = (after) => JSON.stringify({
      after,
      first: 15,
      is_mobile_web: false,
      liked_by_author_badge_enabled: false,
      media_id: mediaId,
      sort_order: 'popular',
      __relay_internal__pv__PolarisIsMobileWebrelayprovider: false,
      __relay_internal__pv__PolarisLikedByAuthorBadgeEnabledrelayprovider: false,
      __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
      __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
      __relay_internal__pv__PolarisPinnedCommentsEnabledrelayprovider: false,
    });

    let after = null;
    let pages = 0;
    let rawCount = 0;
    let commentCount = 0;
    let status = 'ok';
    let complete = false;

    try {
      for (let p = 0; p < MAX_PAGES; p++) {
        if (window.__resoHarvestAbort === true) break;
        const body = tpl.body
          .replace(/doc_id=\d+/, 'doc_id=' + docId)
          .replace(/fb_api_req_friendly_name=[^&]*/, 'fb_api_req_friendly_name=PolarisPostCommentsPaginationQuery')
          .replace(/variables=[^&]*/, 'variables=' + encodeURIComponent(varsOf(after)));
        const headers = { ...(tpl.headers || {}) };
        delete headers['content-length'];
        delete headers['Content-Length'];
        delete headers['host'];
        delete headers['Host'];
        headers['X-FB-Friendly-Name'] = 'PolarisPostCommentsPaginationQuery';

        // Retry pada cursor yang SAMA — halaman gagal tidak boleh dilompati.
        let res = null;
        let j = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            if (window.__resoHarvestAbort === true) break;
            res = await fetch('/api/graphql', { method: 'POST', headers, body, credentials: 'include' });
            if (res.status === 429 || res.status >= 500) {
              if (attempt === 3) { status = 'http-' + res.status; break; }
              await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
              continue;
            }
            if (!res.ok) throw new Error('HTTP-' + res.status);
            j = await res.json();
            break;
          } catch (e) {
            if (attempt === 3) { status = 'error:' + String(e).slice(0, 60); break; }
            await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          }
        }
        if (!j) break;
        if (j.errors && j.errors.length) {
          status = 'gql:' + String(j.errors[0].message || '').slice(0, 80);
          break;
        }
        const conn = j.data && j.data.comments_media && j.data.comments_media.comments_connection;
        if (!conn) { status = 'no-connection'; break; }
        const edges = Array.isArray(conn.edges) ? conn.edges : [];
        const reported = Number(conn.count);
        if (Number.isFinite(reported) && reported > 0) commentCount = reported;
        rawCount += edges.length;
        for (const edge of edges) {
          const node = edge && edge.node;
          if (!node) continue;
          if (node.user) push(node.user.username);
          if (INCLUDE_REPLIES && node.replies && Array.isArray(node.replies.comments)) {
            for (const r of node.replies.comments) if (r && r.user) push(r.user.username);
          }
        }
        pages++;
        const pi = conn.page_info || {};
        if (!pi.has_next_page || !pi.end_cursor || seenCursor.has(pi.end_cursor) || !edges.length) {
          complete = true;
          break;
        }
        seenCursor.add(pi.end_cursor);
        after = pi.end_cursor;
      }
    } catch (e) {
      status = 'error:' + String(e).slice(0, 80);
    }
    return { names, commentCount, rawCount, pages, status, id: mediaId, docId, complete };
  })()`
}
