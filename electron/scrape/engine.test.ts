/**
 * Uji ENGINE scraper memakai WebContentsView palsu — jalankan: npm run test:scrape
 *
 * Fokus: perilaku yang tidak tercakup helper murni — terminasi putaran,
 * dedupe lintas scroll, abort, template TTL, dan status 429/403.
 */
import { runSocialCapture } from './engine-social'
import { runTikTokCapture, sanitizeTikTokTemplateForRun } from './engine-tiktok'
import { TEMPLATE_TTL_MS } from '../../src/shared/template'

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

type Listener = (details: { url: string; statusCode?: number }) => void

interface FakeOptions {
  harvests: string[][]
  url?: string
  statusOnLoad?: number
}

/** WebContentsView minimal yang dipakai engine: executeJavaScript + session. */
function fakeView(opts: FakeOptions) {
  let harvestIndex = 0
  const listeners = new Set<Listener>()
  const wc = {
    session: {
      webRequest: {
        onCompleted: (_filter: unknown, listener: Listener) => listeners.add(listener),
      },
    },
    getURL: () => opts.url ?? 'https://www.tiktok.com/@x/video/123',
    loadURL: async (_url: string) => {
      if (opts.statusOnLoad) {
        for (const l of listeners) {
          l({ url: 'https://www.tiktok.com/api/comment/list/?aweme_id=1', statusCode: opts.statusOnLoad })
        }
      }
    },
    executeJavaScript: async (script: string) => {
      if (
        script.includes('comment-level-1') ||
        script.includes('inbox-list') ||
        script.includes('data-commentid')
      ) {
        return harvestIndex < opts.harvests.length ? opts.harvests[harvestIndex++]! : []
      }
      return null
    },
    stopLoading: () => {},
  }
  return { view: { webContents: wc } as never, wc }
}

const baseSocial = {
  includeReplies: false,
  maxScrollRounds: 10,
  scrollDelayMs: 0,
  timeoutMs: 5000,
  signal: { aborted: false },
}

// ---- FB/IG: dedupe lintas putaran + terminasi 3 putaran kosong ----
const fbView = fakeView({
  harvests: [
    ['Andi Saputra'],
    ['Andi Saputra', 'Budi Santoso'],
    ['Andi Saputra', 'Budi Santoso'],
    ['Andi Saputra', 'Budi Santoso'],
  ],
})
let r = await runSocialCapture(fbView.view, 'facebook', baseSocial)
eq(r.reason, 'complete', 'FB: berhenti setelah 3 putaran tanpa nama baru')
eq(r.names, ['Andi Saputra', 'Budi Santoso'], 'FB: dedupe case-insensitive lintas putaran')

// ---- Abort di tengah jalan → stopped ----
const abortSignal = { aborted: false }
const abortView = fakeView({ harvests: [['Andi']] })
const abortPromise = runSocialCapture(abortView.view, 'facebook', {
  ...baseSocial,
  signal: abortSignal,
  scrollDelayMs: 50,
})
setTimeout(() => {
  abortSignal.aborted = true
}, 20)
r = await abortPromise
eq(r.reason, 'stopped', 'FB: STOP menghentikan run')

// ---- TikTok: dedupe lintas scroll (bug lama: tidak pernah berhenti) ----
const ttView = fakeView({
  harvests: [
    ['andi', 'budi'],
    ['andi', 'budi'],
    ['andi', 'budi'],
    ['andi', 'budi'],
  ],
})
const tt = await runTikTokCapture(ttView.view, {
  templateUrl: null,
  videoUrl: 'https://www.tiktok.com/@x/video/123',
  includeReplies: false,
  maxScrollRounds: 12,
  scrollDelayMs: 0,
  timeoutMs: 5000,
  signal: { aborted: false },
})
eq(tt.reason, 'complete', 'TikTok: berhenti saat tidak ada nama baru')
eq(tt.names, ['andi', 'budi'], 'TikTok: dedupe lintas putaran')

// ---- TikTok: status 429 dipetakan ke rate_limit ----
const tt429 = fakeView({ harvests: [[]], statusOnLoad: 429 })
const r429 = await runTikTokCapture(tt429.view, {
  templateUrl: null,
  videoUrl: 'https://www.tiktok.com/@x/video/123',
  includeReplies: false,
  maxScrollRounds: 3,
  scrollDelayMs: 0,
  timeoutMs: 5000,
  signal: { aborted: false },
})
eq(r429.reason, 'rate_limit', 'TikTok: HTTP 429 → rate_limit')

// ---- Template: TTL 45 menit ----
const goodTemplate = 'https://www.tiktok.com/api/comment/list/?aweme_id=123'
ok(sanitizeTikTokTemplateForRun(goodTemplate, Date.now() - 1000) !== null, 'template baru diterima')
ok(sanitizeTikTokTemplateForRun(goodTemplate, Date.now() - TEMPLATE_TTL_MS - 1) === null, 'template kadaluarsa ditolak')
ok(sanitizeTikTokTemplateForRun('https://eviltiktok.com/api/comment/list/?aweme_id=1') === null, 'template domain spoof ditolak')

console.log(`scrape engine: ${n} checks OK`)
