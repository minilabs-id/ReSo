/**
 * Fallback Facebook — baca komentar dari HTML mentah yang diambil main process.
 *
 * Kenapa ini dibutuhkan: DOM desktop FB bisa tervirtualisasi/berubah, tapi
 * HTML yang dikirim FB untuk URL postingan yang sama memuat atribut
 * `aria-label="Komentar oleh <nama> <waktu>"` pada tiap komentar. Fetch dari
 * main process memakai cookie sesi partition (`session.fetch`), jadi tidak
 * terkena CORS seperti fetch dari dalam halaman.
 */
import type { Session } from 'electron'
import { isAllowedScrapeUrl } from '../../src/shared/platform'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

const HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Dest': 'document',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
}

const TIME_SUFFIX =
  /\s+\d+\s+(jam|menit|detik|hari|minggu|tahun|bulan|hr|min|second|minute|hour|day|week|month|year)s?\b.*$/i

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))

/** Parser murni — dipakai runtime & test unit. */
export function parseFacebookCommentNames(html: string, includeReplies: boolean): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string): void => {
    const v = decodeEntities(raw)
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/\\u200[bcde]/g, '')
      .replace(/\s+/g, ' ')
      .replace(TIME_SUFFIX, '')
      .trim()
    if (!v || v.length < 2 || v.length > 100) return
    if (/^\d+$/.test(v) || /https?:\/\//i.test(v)) return
    const key = v.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(v)
  }
  const patterns = [
    /aria-label="(?:Komentar|Comment)\s+oleh\s+([^"]{1,140})"/gi,
    /aria-label="Comment\s+by\s+([^"]{1,140})"/gi,
  ]
  if (includeReplies) {
    patterns.push(/aria-label="(?:Balasan|Reply)\s+oleh\s+([^"]{1,140})"/gi)
    patterns.push(/aria-label="Reply\s+by\s+([^"]{1,140})"/gi)
  }
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) push(m[1]!)
  }
  return out
}

/** Ambil HTML postingan lewat sesi Electron lalu ekstrak nama komentator. */
export async function fetchFacebookHtmlNames(
  ses: Session,
  postUrl: string,
  includeReplies: boolean,
  timeoutMs = 20000
): Promise<string[] | null> {
  if (!isAllowedScrapeUrl(postUrl, 'facebook')) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
  try {
    const res = await ses.fetch(postUrl, {
      headers: HEADERS,
      credentials: 'include',
      signal: controller.signal,
    } as RequestInit)
    if (!res.ok) return null
    const html = await res.text()
    return parseFacebookCommentNames(html, includeReplies)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
