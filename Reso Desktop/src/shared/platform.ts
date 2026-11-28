/**
 * Aturan allowlist host/URL untuk subsistem scraper.
 * Satu-satunya sumber kebenaran: `isHostAllowed` + `isAllowedScrapeUrl`.
 */
import type { Platform } from './types'

/**
 * Satu-satunya aturan host yang dipakai seluruh subsistem scraper.
 * `endsWith` TIDAK aman: `evilfacebook.com` lolos. Harus exact atau subdomain.
 */
export function isHostAllowed(hostname: string, base: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  const b = base.toLowerCase()
  return h === b || h.endsWith(`.${b}`)
}

/** URL http(s) yang diizinkan untuk platform tertentu (dipakai host & IPC). */
export function isAllowedScrapeUrl(url: string | null | undefined, platform: Platform): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (platform === 'facebook') {
      return isHostAllowed(u.hostname, 'facebook.com') || isHostAllowed(u.hostname, 'fb.com')
    }
    if (platform === 'instagram') return isHostAllowed(u.hostname, 'instagram.com')
    return isHostAllowed(u.hostname, 'tiktok.com')
  } catch {
    return false
  }
}

/**
 * URL halaman yang benar-benar bisa dipanen komentarnya. Dipakai runner SEBELUM
 * memulai engine dan UI untuk mengaktifkan/menonaktifkan tombol aksi.
 * Satu aturan untuk dua tempat — jangan duplikasi pola path di renderer.
 */
export function plausibleScrapeTarget(url: string | null | undefined, platform: Platform): boolean {
  if (!url || !isAllowedScrapeUrl(url, platform)) return false
  try {
    const u = new URL(url)
    const p = u.pathname.toLowerCase()
    if (p.includes('/login')) return false
    // Cocok per segmen path — `includes` menerima /profile/p/... dan /login/p/...
    if (platform === 'facebook') {
      return /(^|\/)(posts|permalink|reel|photo|story\.php)(\/|$)/.test(p)
    }
    if (platform === 'instagram') {
      return /(^|\/)(p|reel|reels|tv)\/[^/]+/.test(p)
    }
    return /(^|\/)(video|photo)\/[^/]+/.test(p)
  } catch {
    return false
  }
}
