/**
 * Uji ekstraksi komentar sosial (khususnya Instagram).
 * Regression test untuk bug "0 nama di browser 789px": dulu ada filter
 * absolut `rect.left < 600`, sehingga semua username yang berada di x=477
 * dibuang. Sekarang penentuan komentar memakai permalink /p/.../c/... dan
 * indentasi RELATIF terhadap komentar utama.
 */
import { buildHarvestScript } from './engine-social'
import {
  isPlausibleHandle,
  shouldIncludeCandidate,
  type HandleCandidate,
} from './engine-social-logic'

let n = 0
function ok(cond: boolean, label: string): void {
  n++
  if (!cond) throw new Error(`✗ ${label}`)
}
function eq<T>(a: T, b: T, label: string): void {
  n++
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`✗ ${label}: dapat ${JSON.stringify(a)}, harusnya ${JSON.stringify(b)}`)
  }
}

const base = (patch: Partial<HandleCandidate> = {}): HandleCandidate => ({
  user: 'fandy_balyan',
  label: 'fandy_balyan',
  reserved: false,
  verified: false,
  inNav: false,
  nearFollow: false,
  depth: 0,
  left: 477,
  minLeft: 477,
  includeReplies: false,
  ...patch,
})

// --- handle ---
ok(isPlausibleHandle('fandy_balyan'), 'username valid diterima')
ok(isPlausibleHandle('adio.s264'), 'titik & angka diterima')
ok(!isPlausibleHandle('12345'), 'username angka semua ditolak')
ok(!isPlausibleHandle('a'.repeat(31)), 'username >30 ditolak')
ok(!isPlausibleHandle('bad/name'), 'karakter tidak sah ditolak')

// --- keputusan komentator ---
ok(shouldIncludeCandidate(base()), 'komentar utama diambil')
ok(!shouldIncludeCandidate(base({ label: 'Orang Lain' })), 'label beda dengan username ditolak')
ok(!shouldIncludeCandidate(base({ reserved: true })), 'username reserved ditolak')
ok(!shouldIncludeCandidate(base({ verified: true })), 'label Verified ditolak')
ok(!shouldIncludeCandidate(base({ inNav: true })), 'anchor navigasi ditolak')
ok(!shouldIncludeCandidate(base({ nearFollow: true })), 'penulis post (tombol Follow) ditolak')
ok(!shouldIncludeCandidate(base({ user: '123', label: '123' })), 'username numerik ditolak')

// --- balasan ---
ok(!shouldIncludeCandidate(base({ depth: 1 })), 'balasan dibuang saat includeReplies=false')
ok(shouldIncludeCandidate(base({ depth: 1, includeReplies: true })), 'balasan diambil saat includeReplies=true')
ok(!shouldIncludeCandidate(base({ left: 500 })), 'komentar terindentasi dibuang saat includeReplies=false')
ok(shouldIncludeCandidate(base({ left: 500, includeReplies: true })), 'komentar terindentasi diambil saat includeReplies=true')

// --- script in-page ---
const ig = buildHarvestScript('instagram', false)
const fb = buildHarvestScript('facebook', false)
ok(!ig.includes('left < 600'), 'TIDAK ada ambang piksel absolut')
ok(ig.includes('/p/'), 'memakai permalink komentar /p/.../c/...')
ok(ig.includes('SHOULD_INCLUDE'), 'memakai aturan murni yang diuji')
ok(ig.includes('minLeft'), 'indentasi dihitung relatif terhadap komentar utama')
ok((ig.match(/INCLUDE_REPLIES/g) || []).length >= 2, 'includeReplies dipakai di cabang IG')
ok(fb.includes('INCLUDE_REPLIES'), 'includeReplies tetap dipakai di cabang FB')

console.log(`engine-social: ${n} checks OK`)
