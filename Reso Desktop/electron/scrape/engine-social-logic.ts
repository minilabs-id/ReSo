/**
 * Logika murni pengambilan keputusan ekstraksi komentar sosial.
 *
 * Fungsi di sini TIDAK boleh mereferensikan variabel luar: source-nya
 * diserialisasi (`toString()`) ke dalam script in-page oleh engine-social.ts,
 * sehingga aturan yang sama dipakai browser dan test unit.
 */

export interface HandleCandidate {
  user: string
  label: string
  reserved: boolean
  verified: boolean
  inNav: boolean
  nearFollow: boolean
  /** 0 = komentar utama, > 0 = balasan. */
  depth: number
  /** Posisi horizontal relatif terhadap komentar utama (bukan absolut). */
  left: number
  minLeft: number
  includeReplies: boolean
}

/** Username sah: 1–30 huruf/angka/titik/garis bawah, bukan angka semua. */
export function isPlausibleHandle(user: string): boolean {
  return /^[A-Za-z0-9._]{1,30}$/.test(user) && !/^\d+$/.test(user)
}

/**
 * Satu keputusan "apakah anchor ini komentator yang harus diambil".
 * Sengaja tanpa konteks DOM — semua fakta sudah dihitung pemanggil.
 */
export function shouldIncludeCandidate(c: HandleCandidate): boolean {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(c.user)) return false
  if (/^\d+$/.test(c.user)) return false
  if (c.reserved || c.verified || c.inNav || c.nearFollow) return false
  if (c.label && c.label.toLowerCase() !== c.user.toLowerCase()) return false
  // Balasan: kedalaman permalink lebih dalam ATAU indentasi relatif terhadap
  // komentar utama. Tidak ada angka piksel tetap — aman di viewport berapa pun.
  if (!c.includeReplies && (c.depth > 0 || c.left > c.minLeft + 16)) return false
  return true
}
