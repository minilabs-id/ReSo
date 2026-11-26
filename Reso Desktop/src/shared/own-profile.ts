/**
 * Deteksi profil akun sendiri dari halaman awal tiap platform.
 *
 * Fungsi di sini murni (string → string) supaya bisa diuji dan diserialisasi
 * ke script in-page oleh scraper-host dengan aturan yang sama persis.
 */
import type { Platform } from './types'

/** Halaman entry untuk mendeteksi akun yang sedang login. */
export const OWN_PROFILE_ENTRY: Record<Platform, string> = {
  facebook: 'https://www.facebook.com/me/',
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/',
}

/**
 * Instagram: objek user sendiri di payload halaman punya penanda
 * `is_supervised_user` / `should_show_public_contacts` / `guardian_id`.
 * Penanda tersebut tidak dipakai objek user biasa di feed.
 */
export function instagramOwnUsernameFromHtml(html: string): string {
  const re = /"username":"([A-Za-z0-9._]{1,30})"/g
  const markers = [
    'is_supervised_user',
    'should_show_public_contacts',
    'guardian_id',
    'linked_accounts',
  ]
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    // Batasi segmen sampai username berikutnya: penanda user sendiri harus
    // berada dalam objek yang sama, bukan di feed/user lain di dekatnya.
    const next = html.indexOf('"username":', match.index + 1)
    const end = next < 0 ? html.length : Math.min(next, match.index + 800)
    const segment = html.slice(match.index, end)
    const hits = markers.filter((k) => segment.includes(`"${k}"`)).length
    if (hits >= 2) return match[1]!
  }
  return ''
}

/** TikTok: tautan navigasi profil di header (`data-e2e="nav-profile"`). */
export function tiktokOwnHrefFromHtml(html: string): string {
  const nav = html.match(/<a[^>]*data-e2e="nav-profile"[^>]*href="(\/@[^"]+)"/)
  if (nav) return nav[1]!
  const any = html.match(/<a[^>]*href="(\/@[^"]+)"[^>]*data-e2e="nav-profile"/)
  return any ? any[1]! : ''
}
