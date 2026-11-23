/**
 * Normalisasi nama + merge/dedupe + perkakas daftar.
 *
 * PORT 1:1 dari `tmp-shared.js` (baris 285–411 normalize*, 722–806 merge/panel).
 * Blok normalize* di bawah adalah SINGLE SOURCE OF TRUTH — perilakunya TIDAK
 * boleh diubah tanpa menyesuaikan test: src/shared/normalize.test.ts.
 */
import type { Platform } from './types'

/** Bersihkan karakter tak terlihat + rapikan spasi. */
function tidy(raw: string): string {
  return raw
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Label UI / teks sistem yang bukan nama orang. */
const BLOCKED = [
  /^view\b/i, /^see\b/i, /^like\b/i, /^likes$/i, /^reply\b/i, /^share\b/i,
  /^comment\b/i, /^write\b/i, /^log\s*in/i, /^sign\s*up/i, /^facebook$/i,
  /^meta$/i, /^suka$/i, /^balas$/i, /^bagikan$/i, /^komentar$/i, /^tulis\b/i,
  /^lihat\b/i, /^tampilkan\b/i, /^semua$/i, /^most relevant$/i, /^all comments$/i,
  /^newest$/i, /^terbaru$/i, /^paling relevan$/i, /^edited$/i, /^sponsor\b/i,
  /^follow$/i, /^following$/i, /^followers$/i, /^ikuti$/i, /^send\b/i,
  /^kirim$/i, /^hide\b/i, /^open\b/i, /^photo$/i, /^video$/i, /^reels?$/i,
  /^add a comment/i, /^tulis komentar/i, /^write a comment/i,
  /^see more$/i, /^lihat selengkapnya$/i,
  /^tiktok$/i,
  /^profile\b/i, /^mengikuti\b/i, /^following you\b/i,
]

/** Tautan/promosi yang tidak boleh lolos jadi "nama". */
function looksLikeJunk(name: string): boolean {
  if (/https?:\/\//i.test(name) || /@\w+\.\w+/.test(name)) return true
  if (/^(wa\.me|bit\.ly|t\.co|goo\.gl|tinyurl\.com|s\.id|link\.)\b/i.test(name)) return true
  if (/\b(wa\.me|bit\.ly|t\.co)\b/i.test(name)) return true
  if (/^[a-z0-9][-a-z0-9]*\.[a-z]{2,6}\//i.test(name)) return true
  return false
}

/** Nama komentar (Facebook + fallback) — buang stempel waktu & label UI. */
export function normalizeCommentName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let name = tidy(raw)
  name = name.replace(/\s+[·•|].*$/, '').trim()
  name = name.replace(
    /\s+(sekitar\s+)?(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|beberapa)\s+(jam|menit|detik|hari|minggu|tahun|bulan)\s+(yang\s+lalu|lalu).*$/i,
    ''
  )
  name = name.replace(
    /\s+(sehari|semenit|sejam|setahun|seminggu|sebulan)\s+(yang\s+lalu|lalu).*$/i,
    ''
  )
  name = name.replace(
    /\s+\d+\s+(jam|menit|detik|hari|minggu|tahun|bulan)\s+(yang\s+lalu|lalu).*$/i,
    ''
  )
  name = name.replace(
    /\s+(about\s+)?(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago.*$/i,
    ''
  )
  name = name.replace(/\s+just\s+now.*$/i, '')
  name = name.replace(
    /\s+\d+\s*(d|h|m|w|y|jam|menit|hari|minggu|tahun|bulan|hr|min|detik|sec|second|minute|hour|day|week|month|year)s?\b.*$/i,
    ''
  )
  name = name.replace(/\s+Edited$/i, '').trim()
  if (/\bis with\b/i.test(name)) name = name.split(/\bis with\b/i)[0]!.trim()
  if (!name) return ''
  if (name.length < 2 || name.length > 100) return ''
  if (name.startsWith('@')) return ''
  if (/^\d+$/.test(name)) return ''
  if (looksLikeJunk(name)) return ''
  if (BLOCKED.some((re) => re.test(name))) return ''
  if (!/[\p{L}\p{N}]/u.test(name)) return ''
  return name
}

/** Nama panggilan TikTok — boleh 1 karakter, tanpa aturan username. */
export function normalizeNickname(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let name = tidy(raw)
  if (!name) return ''
  if (name.startsWith('@') && !name.includes(' ')) name = name.slice(1)
  if (name.length < 1 || name.length > 100) return ''
  if (/^\d+$/.test(name)) return ''
  if (!/[\p{L}\p{N}]/u.test(name)) return '' // emoji-only bukan nama
  if (looksLikeJunk(name)) return ''
  if (BLOCKED.some((re) => re.test(name))) return ''
  return name
}

const IG_BLOCKED = [
  /^instagram$/i, /^post$/i, /^posts$/i, /^reel$/i, /^reels$/i,
  /^story$/i, /^stories$/i, /^explore$/i, /^direct$/i, /^inbox$/i,
  /^activity$/i, /^following$/i, /^followers$/i, /^follow$/i,
  /^saved$/i, /^settings$/i, /^help$/i, /^about$/i, /^terms$/i,
  /^privacy$/i, /^login$/i, /^signup$/i, /^report$/i, /^more$/i,
  /^comment$/i, /^reply$/i, /^share$/i, /^save$/i, /^like$/i,
  /^sent$/i, /^translate\b/i, /^view\b/i, /^username$/i, /^new$/i,
  /^edit\b/i, /^delete\b/i, /^cancel$/i, /^close$/i, /^copy\b/i,
  /^threads$/i, /^threadsapp$/i,
]

/** Username Instagram (lowercase, tanpa spasi, ≤30). */
export function normalizeInstagramUsername(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let u = raw.replace(/\u200b|\u200c|\u200d|\ufeff/g, '').trim()
  if (/\s/.test(u)) return ''
  if (u.startsWith('@')) u = u.slice(1)
  u = u.trim()
  if (!u) return ''
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(u)) return ''
  if (/\.\./.test(u) || u.startsWith('.') || u.endsWith('.')) return ''
  u = u.toLowerCase()
  if (IG_BLOCKED.some((re) => re.test(u))) return ''
  return u
}

/** Normalisasi per platform (IG = username, TikTok = nickname, lain = nama). */
export function normalizeName(raw: unknown, platform: Platform | null): string {
  if (platform === 'instagram') return normalizeInstagramUsername(raw)
  if (platform === 'tiktok') return normalizeNickname(raw)
  return normalizeCommentName(raw)
}

/** Gabung + dedupe case-insensitive, urutan kemunculan dipertahankan. */
export function mergeNames(
  existing: readonly string[] | null | undefined,
  incoming: readonly string[] | null | undefined,
  platform: Platform | null
): string[] {
  const map = new Map<string, string>()
  for (const n of [...(existing ?? []), ...(incoming ?? [])]) {
    const k = normalizeName(n, platform)
    if (k && !map.has(k.toLowerCase())) map.set(k.toLowerCase(), k)
  }
  return [...map.values()]
}

export function namesToClipboardText(
  names: readonly string[] | null | undefined,
  platform: Platform | null
): string {
  return (names ?? []).map((n) => normalizeName(n, platform)).filter(Boolean).join('\n')
}

/** Saring nama (case-insensitive substring). */
export function filterNames(names: readonly string[] | null | undefined, query: unknown): string[] {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return [...(names ?? [])]
  return (names ?? []).filter((n) => String(n).toLowerCase().includes(q))
}

/** Urutkan A–Z (locale id) pada salinan baru. */
export function sortNamesAz(names: readonly string[] | null | undefined): string[] {
  return [...(names ?? [])].sort((a, b) => String(a).localeCompare(String(b), 'id'))
}
