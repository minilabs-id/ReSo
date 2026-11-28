/**
 * Uji ekstraksi nama dari body JSON /api/comment/list (tanpa Electron).
 * Jalankan: npx tsx electron/scrape/engine-tiktok-api.test.ts
 */
import { extractTikTokApiNames } from './engine-tiktok'

let n = 0
function eq(actual: unknown, expected: unknown, label: string): void {
  n++
  if (actual !== expected) throw new Error(`✗ ${label}: dapat ${String(actual)}, harusnya ${String(expected)}`)
}

const payload = {
  aweme_id: '7675591856700460295',
  cursor: 20,
  has_more: true,
  comments: [
    { cid: '1', user: { unique_id: 'alpha', nickname: 'Alpha' }, text: 'a' },
    {
      cid: '2',
      user: { unique_id: 'beta', nickname: 'Beta' },
      text: 'b',
      reply_comment: [
        { cid: '3', user: { unique_id: 'gamma', nickname: 'Gamma' }, text: 'c' },
      ],
    },
  ],
}

eq(extractTikTokApiNames(payload, false).join(','), 'alpha,beta', 'top-level unique_id tanpa balasan')
eq(
  extractTikTokApiNames(payload, true).join(','),
  'alpha,beta,gamma',
  'balasan ikut bila includeReplies'
)
eq(
  extractTikTokApiNames({ comments: [{ user: { nickname: 'Tanpa ID' } }] }, false).join(','),
  'Tanpa ID',
  'nickname dipakai bila unique_id tidak ada'
)
eq(extractTikTokApiNames({ comments: [], has_more: false }, false).length, 0, 'halaman kosong')
eq(extractTikTokApiNames(null, false).length, 0, 'payload null aman')

console.log(`engine-tiktok-api: ${n} checks OK`)
