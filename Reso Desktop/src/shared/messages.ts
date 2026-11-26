/**
 * Pesan akhir run + alasan stop → kalimat untuk operator.
 *
 * PORT 1:1 dari `tmp-shared.js` (BLOCK DONEMSG + reasonToMessage + wordFor).
 */
import type { Platform, StopReason } from './types'

/** Kata hasil per platform — Instagram = username, lainnya = nama. */
export function wordFor(platform: Platform): string {
  return platform === 'instagram' ? 'username' : 'nama'
}

export interface DoneMessageOptions {
  /** Diagnosis tambahan (mis. 429 saat timeout). */
  extra?: string
  /** Panduan saat tidak ada hasil. */
  tip?: string
}

/** Pesan akhir run (DONE) berdasarkan stopReason engine. */
export function doneMessage(
  reason: StopReason,
  count: number,
  platform: Platform,
  options?: DoneMessageOptions
): string {
  const word = wordFor(platform)
  const extra = options && typeof options.extra === 'string' && options.extra ? ` ${options.extra}` : ''
  const tip = options && typeof options.tip === 'string' && options.tip ? ` ${options.tip}` : ''
  const c = Number.isFinite(count) ? count : 0

  if (reason === 'stopped') {
    return c
      ? `Dihentikan — ${c} ${word}.${extra} Sudah masuk rekap harian.`
      : `Dihentikan — belum ada ${word}.${extra}`
  }
  if (reason === 'timeout') {
    return c
      ? `Waktu habis — ${c} ${word} (mungkin belum semua).${extra} Sudah masuk rekap harian.`
      : `Waktu habis — belum ada ${word}.${extra}`
  }
  if (reason === 'incomplete') {
    return c
      ? `Belum tuntas — ${c} ${word} terkumpul, thread belum terlihat habis. Klik Ambil nama lagi untuk melengkapi.`
      : `Belum ada ${word} — pagination belum tuntas.${extra}`
  }
  if (reason === 'idle' || reason === 'complete') {
    if (c) return `Selesai — ${c} ${word}.${extra} Sudah masuk rekap harian.`
    if (tip) return `Tidak ada ${word}.${tip}`
    if (platform === 'facebook')
      return 'Tidak ada nama. Buka permalink post, buka list komentar sampai terlihat, tunggu 2–3 dtk, lalu klik Ambil nama lagi.'
    if (platform === 'tiktok')
      return 'Tidak ada nama. Pastikan komentar terbuka di video, lalu klik Ambil nama lagi.'
    return 'Tidak ada username. Buka “View all comments” di postingan, tunggu komentar muncul, lalu klik Ambil nama lagi.'
  }
  if (reason === 'error') {
    const base = extra.trim() || 'Terjadi error saat ekstrak.'
    return c ? `${base} ${c} ${word} tetap masuk rekap harian.` : base
  }
  if (reason === 'rate_limit') {
    const who =
      platform === 'facebook' ? 'Facebook' : platform === 'tiktok' ? 'TikTok' : 'Instagram'
    return c
      ? `Rate limit ${who} (429) — ${c} ${word} terkumpul. Tunggu beberapa saat, lalu klik Ambil nama lagi.`
      : `Rate limit ${who} (429) — tunggu beberapa saat, lalu coba lagi.`
  }
  if (reason === 'blocked') {
    const who = platform === 'facebook' ? 'Facebook' : platform === 'tiktok' ? 'TikTok' : 'Instagram'
    return c
      ? `${who} memblokir permintaan (403) — kemungkinan anti-bot. ${c} ${word} terkumpul. Tunggu beberapa saat, lalu klik Ambil nama lagi.`
      : `${who} memblokir permintaan (403) — kemungkinan anti-bot. Berhenti agar akun aman; coba lagi beberapa saat kemudian.`
  }
  if (reason === 'checkpoint') {
    const who = platform === 'facebook' ? 'Facebook' : platform === 'tiktok' ? 'TikTok' : 'Instagram'
    const host = platform === 'facebook' ? 'facebook.com' : platform === 'tiktok' ? 'tiktok.com' : 'instagram.com'
    return c
      ? `${who} minta verifikasi (checkpoint). ${c} ${word} terkumpul — buka ${host}, selesaikan verifikasi, lalu klik Ambil nama lagi.`
      : `${who} minta verifikasi (checkpoint). Buka ${host}, selesaikan verifikasi, lalu klik Ambil nama lagi.`
  }
  if (reason === 'no_template') {
    if (platform === 'instagram') {
      return 'Panel komentar belum terbuka. Buka post/reel, klik ikon komentar, tunggu daftar muncul, lalu klik Ambil nama lagi (wajib login).'
    }
    if (platform === 'facebook') {
      return 'Panel komentar belum terbuka. Buka permalink post, buka daftar komentar sampai terlihat, tunggu 2–3 detik, lalu klik Ambil nama lagi.'
    }
    return 'Panel komentar belum terbuka. Buka video, klik ikon komentar, tunggu komentar muncul, lalu klik Ambil nama lagi.'
  }
  if (reason === 'no_video') {
    return 'Buka halaman video TikTok dulu (URL berisi /video/...), bukan For You feed saja.'
  }
  if (reason === 'no_login') {
    if (platform === 'facebook')
      return 'Sesi Facebook tidak aktif — login di facebook.com lalu klik Ambil nama lagi.'
    if (platform === 'tiktok') return 'Sesi TikTok tidak aktif — login di tiktok.com lalu klik Ambil nama lagi.'
    return 'Butuh login Instagram. Buka instagram.com, login, lalu buka post, lalu klik Ambil nama lagi.'
  }
  if (reason === 'no_media') {
    return 'Buka halaman post/reel Instagram dulu (URL /p/... atau /reel/...).'
  }
  if (reason === 'live') {
    return 'Siaran LIVE TikTok tidak memiliki kolom komentar permanen — buka salah satu video/foto, lalu klik Ambil nama lagi.'
  }
  if (reason === 'synthetic_failed') {
    return c
      ? `Belum tuntas — ${c} ${word} terkumpul, endpoint synthetic gagal. Klik Ambil nama lagi untuk melengkapi.`
      : 'Endpoint komentar gagal dibuat — buka panel komentar sampai terlihat, tunggu 2–3 dtk, lalu klik Ambil nama lagi.'
  }
  return c ? `${c} ${word}` : 'Siap.'
}

/** Varian ringkas yang dipakai state machine. */
export function reasonToMessage(
  reason: StopReason,
  count: number,
  platform: Platform,
  extra?: string
): string {
  return doneMessage(reason, count, platform, extra ? { extra } : {})
}

/**
 * Label target yang bermakna (baris "Target:") — token status internal engine
 * bukan target.
 */
export function fbTargetLabel(hint: string | null | undefined): string {
  const s = typeof hint === 'string' ? hint.trim() : ''
  if (!s) return ''
  if (/^(templates:\d+\s+buffer:\d+|capture|dom|idle|graphql|hybrid|replies|rate_limit|error)$/i.test(s)) {
    return ''
  }
  return s
}

export function igTargetLabel(hint: string | null | undefined): string {
  const s = typeof hint === 'string' ? hint.trim() : ''
  if (!s) return ''
  if (/^media\s+\d+$/i.test(s)) return ''
  return s
}
