/**
 * Runner scraping — jembatan antara state machine (RunController) dan engine
 * Electron (ScraperHost + engine TikTok).
 *
 * RunController tetap murni soal state; runner yang melakukan efek I/O: baca
 * preferensi, ambil host, jalankan engine, lalu kirim balik PROGRESS/DONE/FAIL
 * lewat callback `dispatch` (milik controller). Callback ini menghindari
 * import melingkar runner ↔ run-controller.
 *
 * SATU run per platform. AbortController disimpan per platform supaya STOP
 * bisa memotong engine di tengah jalan (engine memakai `signal.aborted`).
 */
import type { BrowserWindow } from 'electron'
import { getSettings } from '../store/settings-store'
import { getHost } from './scraper-host'
import { runTikTokCapture, sanitizeTikTokTemplateForRun } from './engine-tiktok'
import type { CaptureRequest } from './engine-tiktok-logic'
import type { Platform } from '../../src/shared/types'

/** Sinyal stop yang diharapkan engine (cukup pakai `aborted`-nya saja). */
type StopSignal = { readonly aborted: boolean }

export type ScrapeDispatch = (event: unknown) => void

interface ActiveRun {
  runId: string
  abort: AbortController
  /** Selesai saat engine run ini benar-benar berhenti (dipakai saat supersede). */
  done: Promise<void>
}

let mainWindow: BrowserWindow | null = null
const active = new Map<Platform, ActiveRun>()

/** main.ts memanggil ini saat jendela utama dibuat / ditutup. */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

/** Batalkan run platform (dipanggil saat STOP atau saat disusul runId baru). */
export function cancelRun(platform: Platform): void {
  const run = active.get(platform)
  if (!run) return
  active.delete(platform)
  try {
    run.abort.abort()
  } catch {
    /* sudah aborted */
  }
}

/** Masihkah run ini yang aktif? (dipakai untuk membuang hasil basi) */
function isCurrent(platform: Platform, runId: string): boolean {
  return active.get(platform)?.runId === runId
}

/** Hentikan run lama & hapus entrinya bila run baru menggantikannya. */
function finishIfCurrent(platform: Platform, runId: string): boolean {
  if (!isCurrent(platform, runId)) return false
  active.delete(platform)
  return true
}

/**
 * Mulai run. `dispatch` mengirim event ke `runController.apply(platform, …)`.
 */
export function startRun(
  platform: Platform,
  runId: string,
  includeReplies: boolean,
  dispatch: ScrapeDispatch
): void {
  // Supersede: tunggu run lama benar-benar lepas dari WebContentsView yang sama
  // sebelum run baru menyentuhnya (host persisten per platform).
  const previous = active.get(platform)?.done
  cancelRun(platform)

  const abort = new AbortController()
  // Tunda ke microtask agar dispatch sinkron (FB/IG, template invalid, dll.)
  // tidak terjadi di dalam call stack `apply` START yang sedang berjalan.
  const done = Promise.resolve()
    .then(() => (previous ? previous.catch(() => {}) : undefined))
    .then(() => execute(platform, runId, includeReplies, abort.signal, dispatch))
    .catch((err: unknown) => {
      if (!finishIfCurrent(platform, runId)) return
      dispatch({
        type: 'FAIL',
        runId,
        message: `Error runner: ${err instanceof Error ? err.message : String(err)}`,
      })
    })

  active.set(platform, { runId, abort, done })
}

async function execute(
  platform: Platform,
  runId: string,
  includeReplies: boolean,
  signal: StopSignal,
  dispatch: ScrapeDispatch
): Promise<void> {
  const fail = (message: string): void => {
    if (finishIfCurrent(platform, runId)) dispatch({ type: 'FAIL', runId, message })
  }

  // FB/IG: engine belum ada — jangan biarkan UI menggantung di "running".
  if (platform !== 'tiktok') {
    fail(`Engine ${platform.toUpperCase()} belum tersedia.`)
    return
  }

  const win = mainWindow
  if (!win || win.isDestroyed()) {
    fail('Jendela utama belum siap — buka ulang aplikasi.')
    return
  }

  const settings = getSettings()

  // Validasi ketat SEBELUM navigasi. Template invalid → FAIL, jangan loadURL.
  let templateUrl: string | null = null
  if (settings.tiktokTemplateUrl) {
    templateUrl = sanitizeTikTokTemplateForRun(settings.tiktokTemplateUrl)
    if (!templateUrl) {
      fail('Template TikTok tidak valid — periksa URL template di Pengaturan.')
      return
    }
  }

  // Fallback navigation: URL video yang sedang terbuka di host (bila ada).
  // Renderer tidak mengirim videoUrl, jadi ini satu-satunya sumber tanpa UI baru.
  let host
  try {
    host = getHost(win, platform)
  } catch (err) {
    fail(`Gagal menyiapkan browser scraper: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const videoUrl = plausibleTikTokVideoUrl(host.view.webContents.getURL())

  if (!templateUrl && !videoUrl) {
    fail('Belum ada target. Isi URL template TikTok di Pengaturan, lalu Proses lagi.')
    return
  }

  const req: CaptureRequest = {
    templateUrl,
    videoUrl,
    includeReplies,
    maxScrollRounds: settings.maxScrollRounds,
    scrollDelayMs: settings.scrollDelayMs,
    timeoutMs: settings.captureTimeoutMs,
    signal, // AbortSignal punya getter `aborted` — sesuai kontrak engine.
  }

  const result = await runTikTokCapture(host.view, req)

  // STOP / runId baru: buang hasil basi (STOP sudah menulis state berhenti).
  if (!isCurrent(platform, runId)) return
  if (result.reason === 'stopped') {
    active.delete(platform) // STOP sudah menulis state; jangan kirim DONE
    return
  }

  // Stream nama unik per chunk supaya daftar terisi bertahap.
  const unique = [...new Set(result.names)].filter((name): name is string => !!name)
  for (let i = 0; i < unique.length; i += 25) {
    if (!isCurrent(platform, runId)) return
    dispatch({ type: 'PROGRESS', runId, names: unique.slice(i, i + 25) })
  }

  // Tutup run hanya setelah semua chunk terkirim (entry masih dipakai loop above).
  if (!finishIfCurrent(platform, runId)) return
  if (result.reason === 'error') {
    dispatch({ type: 'FAIL', runId, message: result.detail || 'Gagal mengambil komentar TikTok.' })
    return
  }
  dispatch({ type: 'DONE', runId, reason: result.reason })
}

/** Hanya terima URL halaman video/foto TikTok yang wajar (bukan feed/login/api). */
function plausibleTikTokVideoUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('tiktok.com')) return null
    if (!/\/(video|photo)\//.test(u.pathname)) return null
    if (u.pathname.toLowerCase().includes('/login')) return null
    return u.toString()
  } catch {
    return null
  }
}
