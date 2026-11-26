/**
 * Test modul hasil port (M3) — jalankan: npm run test:shared
 *
 * Fokus: perilaku yang mudah rusak saat port dari tmp-shared.js (normalisasi,
 * parser TikTok, opsi engine, patch state, pesan, allowlist host).
 */
import { normalizeCommentName, normalizeNickname, normalizeInstagramUsername, normalizeName, mergeNames, filterNames, sortNamesAz, namesToClipboardText } from './normalize'
import { isHostAllowed, isAllowedScrapeUrl } from './platform'
import { parseTikTokComments } from './parsers'
import { sanitizeEngineOptions, TEMPLATE_TTL_MS } from './template'
import { applyStatePatch, defaultStateFor, newRunId } from './state'
import { reduce } from './run-state'
import { doneMessage } from './messages'
import { OWN_PROFILE_ENTRY, instagramOwnUsernameFromHtml, tiktokOwnHrefFromHtml } from './own-profile'

let n = 0
function ok(cond: boolean, label: string): void {
  n++
  if (!cond) throw new Error(`✗ ${label}`)
}
function eq<T>(actual: T, expected: T, label: string): void {
  n++
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`✗ ${label}: dapat ${a}, harusnya ${b}`)
}

// ===================== normalize =====================
eq(normalizeCommentName('  Andi  Saputra  '), 'Andi Saputra', 'FB: rapikan spasi')
eq(normalizeCommentName('Andi Saputra · 3 jam'), 'Andi Saputra', 'FB: buang separator + waktu')
eq(normalizeCommentName('Budi 3 jam yang lalu'), 'Budi', 'FB: buang waktu ID')
eq(normalizeCommentName('Budi 2 days ago'), 'Budi', 'FB: buang waktu EN')
eq(normalizeCommentName('Budi just now'), 'Budi', 'FB: buang just now')
eq(normalizeCommentName('Budi Edited'), 'Budi', 'FB: buang Edited')
eq(normalizeCommentName('Andi is with Sinta'), 'Andi', 'FB: potong "is with"')
eq(normalizeCommentName('Suka'), '', 'FB: label UI ditolak')
eq(normalizeCommentName('Lihat selengkapnya'), '', 'FB: label UI ID ditolak')
eq(normalizeCommentName('@andi'), '', 'FB: handle ditolak')
eq(normalizeCommentName('12345'), '', 'FB: angka saja ditolak')
eq(normalizeCommentName('A'), '', 'FB: 1 huruf ditolak')
eq(normalizeCommentName('wa.me/62812'), '', 'FB: link ditolak')
eq(normalizeCommentName('Andi\u200b Saputra'), 'Andi Saputra', 'FB: buang zero-width')

eq(normalizeNickname('@andi'), 'andi', 'TT: strip @ tanpa spasi')
eq(normalizeNickname('A'), 'A', 'TT: 1 huruf diterima')
eq(normalizeNickname('Andi Budi'), 'Andi Budi', 'TT: spasi dipertahankan')
eq(normalizeNickname('TikTok'), '', 'TT: label ditolak')

eq(normalizeInstagramUsername('Andi.Saputra'), 'andi.saputra', 'IG: lowercase')
eq(normalizeInstagramUsername('@andi_s'), 'andi_s', 'IG: strip @')
eq(normalizeInstagramUsername('andi saputra'), '', 'IG: spasi ditolak')
eq(normalizeInstagramUsername('.andi'), '', 'IG: titik awal ditolak')
eq(normalizeInstagramUsername('andi..s'), '', 'IG: titik ganda ditolak')
eq(normalizeInstagramUsername('Explore'), '', 'IG: label ditolak')
eq(normalizeInstagramUsername('a'.repeat(31)), '', 'IG: >30 ditolak')

eq(normalizeName('Andi', null), 'Andi', 'normalizeName default FB')
eq(mergeNames(['Andi', 'andi'], ['ANDI', 'Budi'], 'facebook'), ['Andi', 'Budi'], 'merge dedupe case-insensitive')
eq(mergeNames(['Andi :)'], [], 'tiktok'), ['Andi :)'], 'merge memakai aturan platform')
eq(namesToClipboardText(['a', 'b '], 'instagram'), 'a\nb', 'clipboard per baris')
eq(filterNames(['Andi', 'Budi', 'Citra'], 'and'), ['Andi'], 'filter substring case-insensitive')
eq(filterNames(['Andi', 'Budi'], ''), ['Andi', 'Budi'], 'filter kosong → semua')
eq(filterNames(null, 'x'), [], 'filter input null aman')
eq(sortNamesAz(['budi', 'Andi']), ['Andi', 'budi'], 'sort A-Z locale id')

// ===================== parsers =====================
eq(
  parseTikTokComments({ comments: [{ user: { nickname: 'Andi' }, cid: '1' }] }, false),
  ['Andi'],
  'TT parser array comments'
)
eq(
  parseTikTokComments(
    { comments: [{ user: { nickname: 'Andi' }, reply_comment: [{ user: { nickname: 'Budi' } }] }] },
    true
  ),
  ['Andi', 'Budi'],
  'TT parser ikut balasan saat includeReplies'
)
eq(
  parseTikTokComments(
    { comments: [{ user: { nickname: 'Andi' }, reply_comment: [{ user: { nickname: 'Budi' } }] }] },
    false
  ),
  ['Andi'],
  'TT parser tolak balasan saat !includeReplies'
)
eq(
  parseTikTokComments({ data: { comments: [{ user: { nickName: 'Citra' }, text: 'x' }] } }, false),
  ['Citra'],
  'TT parser fallback data.comments + nickName'
)
eq(
  parseTikTokComments({ wrapped: { user: { nickname: 'Dewi' }, comment_id: '9' } }, false),
  ['Dewi'],
  'TT parser fallback walk'
)

// ===================== template =====================
ok(TEMPLATE_TTL_MS === 45 * 60 * 1000, 'TTL template 45 menit')
eq(sanitizeEngineOptions('START', {}, 'tiktok').maxMs, 120_000, 'opsi START default TT')
eq(sanitizeEngineOptions('START', { maxMs: 1 }, 'facebook').maxMs, 8_000, 'opsi maxMs di-clamp bawah')
eq(sanitizeEngineOptions('START', { maxMs: 9e9 }, 'facebook').maxMs, 180_000, 'opsi maxMs di-clamp atas')
eq(sanitizeEngineOptions('START', {}, 'tiktok').includeReplies, false, 'TT default excludeReplies')
eq(sanitizeEngineOptions('START', {}, 'facebook').includeReplies, true, 'FB default includeReplies')
eq(
  sanitizeEngineOptions('SET_TEMPLATE', { templateUrl: 'https://evil.com/api/comment/list/' }, 'tiktok').templateUrl,
  null,
  'SET_TEMPLATE host palsu → null'
)

// ===================== state =====================
eq(defaultStateFor('tiktok').status, 'idle', 'default state idle')
ok(defaultStateFor('tiktok').includeReplies === false, 'default TT excludeReplies')
const patched = applyStatePatch(defaultStateFor('facebook'), { names: ['Andi', 'andi'] }, 'facebook')
eq(patched.names, ['Andi'], 'patch dedupe nama')
eq(patched.count, 1, 'patch hitung ulang count')
ok(patched.updatedAt > 0, 'patch set updatedAt')
ok(newRunId() !== newRunId(), 'runId unik')

// cross-check: keputusan reducer konsisten untuk runId yang tidak cocok
{
  const idle = defaultStateFor('facebook') // runId = null
  const intruder = { type: 'PROGRESS' as const, runId: 'r1', names: ['Penyusup'] }
  eq(reduce('facebook', idle, intruder).changed, false, 'idle: reducer menolak PROGRESS dari run lain')
  eq(
    reduce('facebook', idle, { type: 'DONE', runId: 'r1', reason: 'complete' }).changed,
    false,
    'idle: reducer menolak DONE dari run lain'
  )

  const active = reduce('facebook', idle, { type: 'START', runId: 'r1', includeReplies: true }).state
  eq(reduce('facebook', active, { type: 'PROGRESS', runId: 'r1', names: ['Andi'] }).changed, true, 'aktif: reducer menerima PROGRESS runId sama')
  eq(reduce('facebook', active, { type: 'PROGRESS', runId: 'r2', names: ['Penyusup'] }).changed, false, 'aktif: reducer menolak PROGRESS runId beda')
}

// ===================== messages =====================
ok(doneMessage('complete', 12, 'tiktok').includes('12'), 'pesan selesai memuat jumlah')
ok(doneMessage('no_video', 0, 'tiktok').includes('/video/'), 'pesan no_video TT')
ok(doneMessage('rate_limit', 3, 'facebook').includes('429'), 'pesan rate limit')
ok(doneMessage('blocked', 0, 'instagram').includes('403'), 'pesan blocked IG')
ok(doneMessage('error', 0, 'facebook', { extra: 'boom' }) === 'boom', 'pesan error pakai extra')
ok(doneMessage('tidak_dikenal', 0, 'facebook') === 'Siap.', 'pesan fallback')

// ===================== profil sendiri (default browser) =====================
eq(OWN_PROFILE_ENTRY.facebook, 'https://www.facebook.com/me/', 'entry FB = redirect /me/')
eq(OWN_PROFILE_ENTRY.instagram, 'https://www.instagram.com/', 'entry IG = homepage untuk deteksi user')
eq(OWN_PROFILE_ENTRY.tiktok, 'https://www.tiktok.com/', 'entry TT = homepage untuk deteksi profil')
eq(
  instagramOwnUsernameFromHtml('x "username":"feed_user" y "username":"desajember","is_supervised_user":false,"should_show_public_contacts":false z'),
  'desajember',
  'username IG dengan penanda user sendiri dikenali'
)
eq(instagramOwnUsernameFromHtml('"username":" orang lain "'), '', 'username IG biasa tidak dijadikan profil sendiri')
eq(
  tiktokOwnHrefFromHtml('<a data-e2e="nav-profile" href="/@desajember">Profil</a>'),
  '/@desajember',
  'tautan profil TikTok dikenali'
)
eq(tiktokOwnHrefFromHtml('<div>tanpa tautan profil</div>'), '', 'tanpa tautan profil TikTok → kosong')

// ===================== allowlist host (regresi suffix-spoof) =====================
ok(isHostAllowed('facebook.com', 'facebook.com'), 'host exact diterima')
ok(isHostAllowed('www.facebook.com', 'facebook.com'), 'subdomain www diterima')
ok(isHostAllowed('m.tiktok.com', 'tiktok.com'), 'subdomain tiktok diterima')
ok(!isHostAllowed('evilfacebook.com', 'facebook.com'), 'suffix-spoof facebook ditolak')
ok(!isHostAllowed('eviltiktok.com', 'tiktok.com'), 'suffix-spoof tiktok ditolak')
ok(!isHostAllowed('notinstagram.com', 'instagram.com'), 'suffix-spoof instagram ditolak')
ok(isAllowedScrapeUrl('https://www.instagram.com/p/ABC/', 'instagram'), 'URL IG valid')
ok(!isAllowedScrapeUrl('https://evilfacebook.com/posts/1', 'facebook'), 'URL FB spoof ditolak')
ok(!isAllowedScrapeUrl('file:///C:/secret.txt', 'tiktok'), 'URL non-http ditolak')
ok(!isAllowedScrapeUrl('https://tiktok.com.evil.com/video/1', 'tiktok'), 'subdomain palsu ditolak')

console.log(`shared (port M3): ${n} checks OK`)
