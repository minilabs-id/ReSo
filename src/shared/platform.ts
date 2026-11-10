/**
 * Deteksi platform + ekstraksi id dari URL.
 *
 * PORT 1:1 dari `tmp-shared.js` (baris 3–57 platform, 61–135 FB ids,
 * 255–283 IG shortcode & TikTok aweme id).
 */
import type { Platform } from './types'

export function isFacebookUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.hostname === 'www.facebook.com' || u.hostname.endsWith('.facebook.com')
  } catch {
    return false
  }
}

export function isTikTokUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.hostname === 'tiktok.com' || u.hostname.endsWith('.tiktok.com')
  } catch {
    return false
  }
}

export function isInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.hostname === 'instagram.com' || u.hostname.endsWith('.instagram.com')
  } catch {
    return false
  }
}

export function detectPlatform(url: string | null | undefined): Platform | null {
  if (isFacebookUrl(url)) return 'facebook'
  if (isTikTokUrl(url)) return 'tiktok'
  if (isInstagramUrl(url)) return 'instagram'
  return null
}

// ===================== Facebook =====================

/**
 * Kandidat story/feedback id dari permalink FB — urutan = prioritas.
 * Engine mem-probe tiap kandidat dan memakai yang menghasilkan page_info.
 */
export function extractFbFeedbackIds(url: string | null | undefined): string[] {
  const out: string[] = []
  const add = (id: unknown): void => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9]{8,}$/.test(id)) return
    if (!out.includes(id)) out.push(id)
  }
  if (!url || typeof url !== 'string') return out
  const href = url

  const direct = [
    /\/posts\/[^/?#]+\/([^/?#]+)/,
    /\/posts\/([^/?#]+)/,
    /\/permalink\.php\?story_fbid=([^&#]+)/,
    /\/story\.php\?story_fbid=([^&#]+)/,
    /\/photos\/a\.\d+\.(\d+)/,
    /\/photos\/pcb\.(\d+)/,
    /\/photos\/(\d+)/,
    /\/videos\/(\d+)/,
    /\/reels?\/(\d+)/,
    /\/video\.php\?v=(\d+)/,
  ]
  for (const re of direct) {
    const m = href.match(re)
    if (m) add(m[1])
  }

  const watch = href.match(/\/watch(?:[^?#]*\?|\?)[^#]*\bv=(\d+)/i)
  if (watch) add(watch[1])

  try {
    const u = new URL(href)
    for (const key of ['story_fbid', 'multi_permalinks']) {
      const val = u.searchParams.get(key)
      if (val) add(val.split(',')[0]!.trim())
    }
    const set = u.searchParams.get('set') || ''
    const parts = String(set).split('.')
    if (parts[0] === 'pcb' && parts.length >= 2) add(parts[parts.length - 1])
    for (const key of ['fbid', 'v']) {
      const val = u.searchParams.get(key)
      if (val) add(val)
    }
    if (parts[0] === 'a' && parts.length >= 4) add(parts[3])
  } catch {
    /* URL relatif/aneh — kandidat dari regex tetap dipakai */
  }
  return out
}

export function extractFbFeedbackId(url: string | null | undefined): string | null {
  const ids = extractFbFeedbackIds(url)
  return ids.length ? ids[0]! : null
}

export function isFacebookPostPage(url: string | null | undefined): boolean {
  return extractFbFeedbackIds(url).length > 0
}

// ===================== Instagram =====================

export function extractInstagramShortcode(url: string | null | undefined): string | null {
  if (!url) return null
  const m = String(url).match(
    /instagram\.com\/(?:share\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i
  )
  return m ? m[1]! : null
}

// ===================== TikTok =====================

export function extractAwemeId(url: string | null | undefined): string | null {
  if (!url) return null
  const patterns = [
    /tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/i,
    /tiktok\.com\/(?:embed|v)\/(\d+)/i,
    /[?&]aweme_id=(\d+)/i,
    /[?&]item_id=(\d+)/i,
    /\/video\/(\d+)/i,
    /\/photo\/(\d+)/i,
  ]
  for (const re of patterns) {
    const m = String(url).match(re)
    if (m) return m[1]!
  }
  return null
}
