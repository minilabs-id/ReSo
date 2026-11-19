/**
 * Test modul hasil port (M3) — jalankan: npm run test:shared
 *
 * Fokus: perilaku yang mudah rusak saat port dari tmp-shared.js (normalisasi,
 * deteksi platform, parser, validator template, patch state, pesan).
 */
import { normalizeCommentName, normalizeNickname, normalizeInstagramUsername, normalizeName, mergeNames, mergeAcrossPlatforms, filterNames, sortNamesAz, namesToClipboardText } from './normalize'
import { detectPlatform, extractFbFeedbackIds, extractInstagramShortcode, extractAwemeId, isFacebookPostPage } from './platform'
import { parseTikTokComments, parseIgComments, extractGraphqlNames } from './parsers'
import { sanitizeTikTokTemplateUrl, isTikTokTemplateValid, sanitizeInstagramTemplateUrl, isInstagramTemplateValid, sanitizeEngineOptions, TEMPLATE_TTL_MS } from './template'
import { applyStatePatch, defaultStateFor, newRunId, isStaleRun } from './state'
import { reduce } from './run-state'
import { doneMessage } from './messages'

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
eq(
  mergeAcrossPlatforms([
    { platform: 'instagram', names: ['Andi.S'] },
    { platform: 'tiktok', names: ['andi.s'] },
  ]),
  ['andi.s'],
  'merge lintas platform dedupe'
)

// ===================== platform =====================
eq(detectPlatform('https://www.facebook.com/x/posts/123'), 'facebook', 'detect FB')
eq(detectPlatform('https://www.tiktok.com/@a/video/7234567890'), 'tiktok', 'detect TT')
eq(detectPlatform('https://instagram.com/p/ABC123/'), 'instagram', 'detect IG')
eq(detectPlatform('https://example.com/'), null, 'detect selain platform → null')

eq(extractAwemeId('https://www.tiktok.com/@a/video/7234567890123'), '7234567890123', 'aweme dari path video')
eq(extractAwemeId('https://www.tiktok.com/embed/12345678901'), '12345678901', 'aweme dari embed')
eq(extractAwemeId('https://www.tiktok.com/foryou'), null, 'aweme tidak ada')

eq(extractInstagramShortcode('https://www.instagram.com/reel/XYZ-9_/'), 'XYZ-9_', 'shortcode reel')
eq(extractInstagramShortcode('https://www.instagram.com/share/p/AbC123/'), 'AbC123', 'shortcode share')

const fbIds = extractFbFeedbackIds('https://www.facebook.com/groups/1/posts/123456789/')
eq(fbIds, ['123456789'], 'FB id dari /posts/')
eq(isFacebookPostPage('https://www.facebook.com/groups/1/posts/123456789/'), true, 'FB post page')
eq(isFacebookPostPage('https://www.facebook.com/watch/?v=123456789012'), true, 'FB watch page')
eq(isFacebookPostPage('https://www.facebook.com/'), false, 'FB home bukan post page')

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

eq(
  parseIgComments({ comments: [{ user: { username: 'andi.s' } }, { user: {} }, null] }),
  ['andi.s'],
  'IG parser'
)

const graphql = '{"data":{"node":{"__typename":"Comment","created_time":123,"author":{"__typename":"User","name":"Andi Saputra"}}}}'
eq(extractGraphqlNames(graphql, true), ['Andi Saputra'], 'FB graphql top-level')
const graphqlReply =
  '{"__typename":"Comment","depth":1,"author":{"__typename":"User","name":"Budi"}}' +
  '{"__typename":"Comment","created_time":5,"author":{"name":"Andi"}}'
ok(!extractGraphqlNames(graphqlReply, false).includes('Budi'), 'FB graphql tolak balasan saat !includeReplies')
eq(extractGraphqlNames('bukan json', true), [], 'FB graphql teks tanpa match')

// ===================== template =====================
const ttUrl = 'https://www.tiktok.com/api/comment/list/?aweme_id=123&msToken=abc&X-Bogus=xyz'
eq(
  sanitizeTikTokTemplateUrl(ttUrl),
  'https://www.tiktok.com/api/comment/list/?aweme_id=123',
  'TT template: buang param signing'
)
eq(sanitizeTikTokTemplateUrl('bukan url'), null, 'TT template: URL invalid → null')
eq(
  isTikTokTemplateValid('https://www.tiktok.com/api/comment/list/?aweme_id=1', { capturedAt: Date.now() }),
  true,
  'TT template valid'
)
eq(isTikTokTemplateValid('https://www.tiktok.com/api/comment/list/reply/?x=1', { capturedAt: Date.now() }), false, 'TT template reply endpoint ditolak')
eq(isTikTokTemplateValid('https://www.tiktok.com/api/comment/list/?a=1', { capturedAt: Date.now() - TEMPLATE_TTL_MS - 1 }), false, 'TT template kedaluwarsa')
eq(isTikTokTemplateValid('https://www.tiktok.com/api/comment/list/?a=1', { capturedAt: Date.now(), awemeId: '1' }, '2'), false, 'TT template aweme beda')
eq(isTikTokTemplateValid('https://evil.com/api/comment/list/?a=1', { capturedAt: Date.now() }), false, 'TT template host palsu ditolak')

const igUrl = 'https://www.instagram.com/api/v1/media/123/comments/?max_id=9&__a=1&index=2'
eq(
  sanitizeInstagramTemplateUrl(igUrl),
  'https://www.instagram.com/api/v1/media/123/comments/',
  'IG template: buang pagination'
)
eq(sanitizeInstagramTemplateUrl('https://www.instagram.com/api/v1/media/1/inline_child_comments/'), null, 'IG template inline ditolak')
eq(
  isInstagramTemplateValid('https://www.instagram.com/api/v1/media/1/comments/', { capturedAt: Date.now() }),
  true,
  'IG template valid'
)

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
eq(isStaleRun(null, 'x'), true, 'stale: state tanpa run aktif + pesan bertanda run')
eq(isStaleRun(null, null), false, 'tidak stale: state dan pesan tanpa runId')
eq(isStaleRun('a', null), true, 'stale: pesan tanpa runId')
eq(isStaleRun('a', 'b'), true, 'stale: runId beda')
eq(isStaleRun('a', 'a'), false, 'stale: runId sama')

// cross-check: isStaleRun HARUS sejalan dengan keputusan reducer (parity race tab)
{
  const idle = defaultStateFor('facebook') // runId = null
  const intruder = { type: 'PROGRESS' as const, runId: 'r1', names: ['Penyusup'] }
  eq(isStaleRun(idle.runId, intruder.runId), true, 'idle: isStaleRun menandai intruder stale')
  eq(reduce('facebook', idle, intruder).changed, false, 'idle: reducer menolak PROGRESS dari run lain')
  eq(
    reduce('facebook', idle, { type: 'DONE', runId: 'r1', reason: 'complete' }).changed,
    false,
    'idle: reducer menolak DONE dari run lain'
  )

  const active = reduce('facebook', idle, { type: 'START', runId: 'r1', includeReplies: true }).state
  eq(isStaleRun(active.runId, 'r1'), false, 'aktif: runId sama tidak stale')
  eq(reduce('facebook', active, { type: 'PROGRESS', runId: 'r1', names: ['Andi'] }).changed, true, 'aktif: reducer menerima PROGRESS runId sama')
  eq(isStaleRun(active.runId, 'r2'), true, 'aktif: runId beda stale')
  eq(reduce('facebook', active, { type: 'PROGRESS', runId: 'r2', names: ['Penyusup'] }).changed, false, 'aktif: reducer menolak PROGRESS runId beda')
}

// ===================== messages =====================
ok(doneMessage('complete', 12, 'tiktok').includes('12'), 'pesan selesai memuat jumlah')
ok(doneMessage('no_video', 0, 'tiktok').includes('/video/'), 'pesan no_video TT')
ok(doneMessage('rate_limit', 3, 'facebook').includes('429'), 'pesan rate limit')
ok(doneMessage('blocked', 0, 'instagram').includes('403'), 'pesan blocked IG')
ok(doneMessage('error', 0, 'facebook', { extra: 'boom' }) === 'boom', 'pesan error pakai extra')
ok(doneMessage('tidak_dikenal', 0, 'facebook') === 'Siap.', 'pesan fallback')

console.log(`shared (port M3): ${n} checks OK`)
