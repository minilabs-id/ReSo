/**
 * Test sanitasi state di disk (M3) — murni, tanpa Electron.
 * Jalankan: npm run test:shared
 */
import { sanitizeState, defaultStateFor } from './state-schema'

let n = 0
function eq<T>(a: T, b: T, label: string): void {
  n++
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`✗ ${label}: dapat ${JSON.stringify(a)}, harusnya ${JSON.stringify(b)}`)
  }
}

eq(sanitizeState(null, 'facebook'), defaultStateFor('facebook'), 'null → default')
eq(sanitizeState('bukan objek', 'tiktok'), defaultStateFor('tiktok'), 'string → default')
eq(sanitizeState({}, 'instagram').status, 'idle', 'objek kosong → idle')

const s = sanitizeState(
  {
    status: 'done',
    names: ['Andi', 'andi', 42, null, 'Budi'],
    message: 'ok',
    stopReason: 'complete',
    runId: 'r1',
    includeReplies: true,
    updatedAt: Date.now(),
  },
  'facebook'
)
eq(s.names, ['Andi', 'Budi'], 'nama disaring & didedupe')
eq(s.count, 2, 'count dihitung ulang')
eq(s.status, 'done', 'status valid dipertahankan')
eq(s.runId, 'r1', 'runId dipertahankan')

eq(sanitizeState({ status: 'hacked' }, 'facebook').status, 'idle', 'status asing → idle')
eq(sanitizeState({ names: 'bukan array' }, 'facebook').names, [], 'names non-array → []')
eq(sanitizeState({ message: 'x'.repeat(900) }, 'facebook').message.length, 500, 'pesan dipotong')
eq(sanitizeState({ runId: 123 }, 'facebook').runId, null, 'runId non-string → null')
eq(sanitizeState({ includeReplies: 'yes' }, 'tiktok').includeReplies, false, 'includeReplies non-bool → default TT')
eq(
  sanitizeState({ names: Array.from({ length: 6000 }, (_, i) => `N${i}`) }, 'facebook').names.length,
  5000,
  'nama dibatasi 5000'
)

console.log(`state-schema: ${n} checks OK`)
