/**
 * Test run state machine (M3) — jalankan: npm run test:shared
 */
import { reduce, parseRunEvent } from './run-state'
import { defaultStateFor } from './state'
import type { NameState } from './types'

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

function run(events: Parameters<typeof reduce>[2][], platform: 'facebook' | 'tiktok' = 'facebook'): NameState {
  let s: NameState = defaultStateFor(platform)
  for (const e of events) s = reduce(platform, s, e).state
  return s
}

// --- happy path ---
let s = run([
  { type: 'START', runId: 'r1', includeReplies: true },
  { type: 'PROGRESS', runId: 'r1', names: ['Andi', 'Budi'] },
  { type: 'DONE', runId: 'r1', reason: 'complete', names: ['Citra'] },
])
eq(s.status, 'done', 'DONE → status done')
eq(s.names, ['Andi', 'Budi', 'Citra'], 'nama terkumpul dari PROGRESS + DONE')
eq(s.count, 3, 'count sinkron')
eq(s.runId, null, 'runId dibersihkan setelah selesai')
ok(s.message.includes('3'), 'pesan memuat jumlah')

// --- status selama running ---
s = run([{ type: 'START', runId: 'r1', includeReplies: true }])
eq(s.status, 'running', 'START → running')
eq(s.names, [], 'START mereset nama sebelumnya')

// --- dedupe progress ---
s = run([
  { type: 'START', runId: 'r1', includeReplies: true },
  { type: 'PROGRESS', runId: 'r1', names: ['Andi', 'andi'] },
  { type: 'PROGRESS', runId: 'r1', names: ['ANDI'] },
])
eq(s.names, ['Andi'], 'PROGRESS dedupe case-insensitive')
eq(reduce('facebook', s, { type: 'PROGRESS', runId: 'r1', names: ['ANDI'] }).changed, false, 'PROGRESS tanpa nama baru → changed=false')

// --- tolak run lain (race dua tab) ---
s = run([
  { type: 'START', runId: 'r1', includeReplies: true },
  { type: 'PROGRESS', runId: 'r2', names: ['Penyusup'] },
])
eq(s.names, [], 'PROGRESS runId beda ditolak')
eq(reduce('facebook', s, { type: 'DONE', runId: 'r2', reason: 'complete' }).changed, false, 'DONE runId beda ditolak')

// --- START ganda tidak me-reset run aktif ---
let st = defaultStateFor('facebook')
st = reduce('facebook', st, { type: 'START', runId: 'r1', includeReplies: true }).state
st = reduce('facebook', st, { type: 'PROGRESS', runId: 'r1', names: ['Andi'] }).state
const again = reduce('facebook', st, { type: 'START', runId: 'r2', includeReplies: true })
eq(again.changed, false, 'START saat running diabaikan')
eq(again.state.names, ['Andi'], 'nama lama tidak hilang')

// --- STOP ---
s = run([
  { type: 'START', runId: 'r1', includeReplies: true },
  { type: 'PROGRESS', runId: 'r1', names: ['Andi'] },
  { type: 'STOP' },
])
eq(s.status, 'stopped', 'STOP → stopped')
eq(s.names, ['Andi'], 'STOP mempertahankan hasil')
eq(reduce('facebook', s, { type: 'STOP' }).changed, false, 'STOP saat idle diabaikan')

// --- DONE dengan reason khusus ---
eq(run([{ type: 'START', runId: 'r1', includeReplies: false }, { type: 'DONE', runId: 'r1', reason: 'stopped' }]).status, 'stopped', 'DONE reason stopped → status stopped')
eq(run([{ type: 'START', runId: 'r1', includeReplies: false }, { type: 'DONE', runId: 'r1', reason: 'error' }]).status, 'error', 'DONE reason error → status error')
eq(run([{ type: 'START', runId: 'r1', includeReplies: false }, { type: 'DONE', runId: 'r1', reason: 'rate_limit' }]).status, 'done', 'DONE reason rate_limit → done')
ok(
  run([{ type: 'START', runId: 'r1', includeReplies: false }, { type: 'DONE', runId: 'r1', reason: 'no_video' }]).message.includes('/video/'),
  'pesan no_video diteruskan'
)

// --- FAIL ---
s = run([{ type: 'START', runId: 'r1', includeReplies: true }, { type: 'FAIL', runId: 'r1', message: 'boom' }])
eq(s.status, 'error', 'FAIL → error')
eq(s.message, 'boom', 'FAIL memakai pesan error')
eq(reduce('facebook', s, { type: 'FAIL', runId: 'lain', message: 'x' }).changed, false, 'FAIL runId beda ditolak')
eq(reduce('facebook', s, { type: 'FAIL', message: 'y' }).changed, true, 'FAIL tanpa runId tetap diterapkan')

// --- START membersihkan target lama ---
s = reduce('facebook', { ...defaultStateFor('facebook'), postHint: 'https://lama' }, { type: 'START', runId: 'r1', includeReplies: true }).state
eq(s.postHint, '', 'START menghapus postHint lama')

// --- MAX_NAMES ---
const banyak = Array.from({ length: 6000 }, (_, i) => `Nama${i}`)
s = run([{ type: 'START', runId: 'r1', includeReplies: true }, { type: 'PROGRESS', runId: 'r1', names: banyak }])
eq(s.count, 5000, 'nama dibatasi 5000')

// --- platform tiktok (includeReplies false default) ---
s = run([{ type: 'START', runId: 'r1', includeReplies: false }], 'tiktok')
eq(s.includeReplies, false, 'TT includeReplies diteruskan')

// --- parseRunEvent (input tak dipercaya) ---
eq(parseRunEvent(null), null, 'parse null')
eq(parseRunEvent({ type: 'NGO' }), null, 'parse tipe tak dikenal')
eq(parseRunEvent({ type: 'START' }), null, 'parse START tanpa runId')
eq(parseRunEvent({ type: 'START', runId: 'r', includeReplies: 'yes' }), { type: 'START', runId: 'r', includeReplies: false }, 'parse START paksa boolean')
eq(parseRunEvent({ type: 'PROGRESS', runId: 'r', names: ['a', 1, null] }), { type: 'PROGRESS', runId: 'r', names: ['a'] }, 'parse PROGRESS saring non-string')
eq(parseRunEvent({ type: 'DONE', runId: 'r' }), { type: 'DONE', runId: 'r', reason: 'complete', names: undefined }, 'parse DONE default complete')
eq(parseRunEvent({ type: 'FAIL', message: 'x'.repeat(900) })?.type, 'FAIL', 'parse FAIL diterima')
ok((parseRunEvent({ type: 'FAIL', message: 'x'.repeat(900) }) as { message: string }).message.length === 500, 'parse FAIL memotong pesan')

// --- opsi & target (sumber kebenaran tombol Scrap in-page) ---
s = run([{ type: 'SET_OPTIONS', includeReplies: true }])
eq(s.includeReplies, true, 'SET_OPTIONS mengubah includeReplies')
eq(reduce('facebook', s, { type: 'SET_OPTIONS', includeReplies: true }).changed, false, 'SET_OPTIONS identik → changed=false')
s = run([{ type: 'SET_TARGET', hint: 'https://facebook.com/posts/1' }])
eq(s.postHint, 'https://facebook.com/posts/1', 'SET_TARGET mengisi postHint (FB)')
s = run([{ type: 'SET_TARGET', hint: 'https://tiktok.com/@x/video/1' }], 'tiktok')
eq(s.videoHint, 'https://tiktok.com/@x/video/1', 'SET_TARGET mengisi videoHint (TikTok)')
eq(parseRunEvent({ type: 'SET_OPTIONS', includeReplies: true }), { type: 'SET_OPTIONS', includeReplies: true }, 'parse SET_OPTIONS')
eq(parseRunEvent({ type: 'SET_TARGET', hint: 'x' }), { type: 'SET_TARGET', hint: 'x' }, 'parse SET_TARGET')

console.log(`run-state: ${n} checks OK`)
