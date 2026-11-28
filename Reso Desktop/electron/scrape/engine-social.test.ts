/**
 * Uji ekstraksi komentar sosial (khususnya Instagram).
 * Regression test untuk bug "0 nama di browser 789px": dulu ada filter
 * absolut `rect.left < 600`, sehingga semua username yang berada di x=477
 * dibuang. Sekarang penentuan komentar memakai permalink /p/.../c/... dan
 * indentasi RELATIF terhadap komentar utama.
 */
import { buildFacebookMetaScript, buildHarvestScript } from './engine-social'
import { buildInstagramApiHarvestScript, shortcodeToPk } from './instagram-api'
import {
  buildInstagramGraphqlHarvestScript,
  findCommentsDocId,
  IG_GQL_CAPTURE_JS,
} from './instagram-graphql'
import { attachCdp } from './cdp'
import { parseFacebookCommentNames } from './facebook-html'
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

// --- Instagram private API (arsitektur terverifikasi) ---
eq(shortcodeToPk('Df12rYekjTt'), '4032369517111948525', 'shortcode → pk pakai BigInt')
eq(shortcodeToPk('B1LbfVPlwIA'), '2110901750722920960', 'shortcode lama → pk sesuai instagrapi')
eq(shortcodeToPk('bad!'), null, 'shortcode invalid ditolak')

const apiIg = buildInstagramApiHarvestScript({ maxPages: 500, includeReplies: true })
ok(apiIg.includes('BigInt'), 'konversi pk memakai BigInt')
ok(
  apiIg.indexOf('location.pathname.match') < apiIg.indexOf('html.match'),
  'pk diambil dari shortcode URL sebelum HTML (HTML reel berisi media rekomendasi)'
)
ok(apiIg.includes('X-IG-App-ID'), 'memakai header app id web IG')
ok(apiIg.includes('X-CSRFToken'), 'memakai CSRF cookie')
ok(apiIg.includes('next_max_id'), 'mendukung paginasi kronologis')
ok(apiIg.includes('has_more_headload_comments'), 'mendukung paginasi ranked')
ok(apiIg.includes('preview_child_comments'), 'mengambil balasan dari payload utama')
ok(apiIg.includes('inline_child_comments'), 'endpoint balasan yang benar')
ok(!apiIg.includes('c.replies'), 'TIDAK memakai field replies yang tidak ada')
ok(apiIg.includes('MAX_PAGES = 500'), 'paginasi tidak dibatasi putaran scroll')
ok(!apiIg.includes('if (commentCount === 0) complete = true'), 'comment_count=0 tidak membuang halaman pertama')
ok(apiIg.includes('rawCount === 0 && names.length === 0'), 'zero hanya bila tidak ada komentar sama sekali')
ok(apiIg.includes('res.status === 429'), 'retry otomatis saat IG memberi 429')
ok(apiIg.includes('rawCount >= commentCount'), 'berhenti setelah semua komentar terbaca')
ok(apiIg.includes('complete'), 'status tuntas dilaporkan ke engine')
ok(
  buildInstagramApiHarvestScript({ maxPages: 9999, includeReplies: false }).includes('MAX_PAGES = 500'),
  'batas halaman dibatasi maksimal 500 (pengaman)'
)
ok(
  buildInstagramApiHarvestScript({ maxPages: 10, includeReplies: false }).includes('INCLUDE_REPLIES = false'),
  'includeReplies=false tidak mengambil balasan'
)

// --- fallback GraphQL (jalur independen dari REST) ---
eq(
  findCommentsDocId('__d("PolarisPostCommentsPaginationQuery_instagramRelayOperation",[],(function(t,n,r,o,a,i){a.exports="29250323357962155"})'),
  '29250323357962155',
  'doc_id GraphQL ditemukan dari bundle'
)
eq(findCommentsDocId('bundle tanpa query'), '', 'doc_id kosong bila tidak ada')
const gql = buildInstagramGraphqlHarvestScript({ maxPages: 200, includeReplies: false })
ok(gql.includes('findDocId'), 'doc_id dicari saat runtime')
ok(gql.includes('window.__resoGqlTemplate'), 'memakai template request asli halaman')
ok(gql.includes('comments_media'), 'membaca connection komentar Relay')
ok(gql.includes('PolarisPostCommentsPaginationQuery'), 'friendly name diganti sesuai query')
ok(gql.includes('after'), 'paginasi memakai after cursor')
ok(IG_GQL_CAPTURE_JS.includes('XMLHttpRequest.prototype.open'), 'penangkap template memasang XHR')
ok(IG_GQL_CAPTURE_JS.includes('__resoGqlCaptureInstalled'), 'capture idempoten')

// --- dependency CDP ---
const cdpCalls: string[] = []
let attached = false
const fakeWc = {
  debugger: {
    isAttached: () => attached,
    attach: (v: string) => { attached = true; cdpCalls.push('attach:' + v) },
    sendCommand: async (method: string) => {
      cdpCalls.push(method)
      return { identifier: 'script-1', result: { value: 'terpasang' } }
    },
  },
} as any
const cdp = await attachCdp(fakeWc, 1)
eq(await cdp.evaluate('1+1'), 'terpasang', 'evaluate CDP mengembalikan value')
eq(await cdp.addDocumentStartScript('x'), 'script-1', 'script document-start terpasang')
ok(cdpCalls.includes('attach:1.3'), 'CDP attach memakai versi 1.3')
ok(cdpCalls.includes('Page.enable'), 'domain Page dinyalakan')
ok(cdpCalls.includes('Runtime.enable'), 'domain Runtime dinyalakan')
ok(cdpCalls.includes('Page.addScriptToEvaluateOnNewDocument'), 'capture dipasang sebelum dokumen')

// --- Facebook aria-label struktural ---
ok(fb.includes('[role="article"][aria-label]'), 'FB memakai selector artikel ber-label')
ok(fb.includes('Komentar'), 'FB mengenali label Komentar oleh')
ok(fb.includes('Balasan'), 'FB mengenali label Balasan saat includeReplies')
ok(fb.includes('labelName'), 'nama diambil dari aria-label sebelum heuristik lama')
ok(fb.includes('data-commentid'), 'FB mempertahankan heuristik lama sebagai fallback')

// --- efisiensi: fallback HTML hanya bila DOM belum punya komentar ---
const engineSrc = await (await import('node:fs/promises')).readFile(
  new URL('./engine-social.ts', import.meta.url),
  'utf8'
)
ok(
  engineSrc.includes('needHtmlFallback'),
  'fetch HTML 4 MB hanya saat DOM kosong'
)
const fbMeta = buildFacebookMetaScript()
ok(fbMeta.includes('komentar|comments?'), 'meta FB mencari jumlah komentar')
ok(fbMeta.includes('declared'), 'meta FB mengembalikan jumlah yang diumumkan')

// --- fallback HTML FB (main process) ---
const fbHtml = [
  '<div aria-label="Komentar oleh Ferdy Mutant 7 jam yang lalu" role="article"></div>',
  '<div aria-label="Komentar oleh Pramono\u200c 8 jam yang lalu" role="article"></div>',
  '<div aria-label="Komentar oleh Ferdy Mutant 9 jam yang lalu" role="article"></div>',
  '<div aria-label="Balasan oleh Dann 6 jam yang lalu" role="article"></div>',
  '<div aria-label="Komentar oleh 12345 5 jam yang lalu" role="article"></div>',
].join('')
eq(
  parseFacebookCommentNames(fbHtml, false),
  ['Ferdy Mutant', 'Pramono'],
  'parser HTML FB mengambil & mendeduplikasi nama komentar'
)
eq(
  parseFacebookCommentNames(fbHtml, true),
  ['Ferdy Mutant', 'Pramono', 'Dann'],
  'parser HTML FB menyertakan balasan saat diminta'
)

console.log(`engine-social: ${n} checks OK`)
