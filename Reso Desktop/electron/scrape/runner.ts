/**
 * Runner scraping — jembatan antara state machine (RunController) dan engine
 * Electron (ScraperHost + engine TikTok + engine sosial FB/IG).
 *
 * RunController tetap murni soal state; runner yang melakukan efek I/O: baca
 * preferensi, ambil host, jalankan engine, lalu kirim balik PROGRESS/DONE/FAIL
 * lewat callback `dispatch` (milik controller). Callback ini menghindari
 * import melingkar runner ↔ run-controller.
 *
 * SATU run per platform. AbortController disimpan per platform supaya STOP
 * bisa memotong engine di tengah jalan (engine memakai `signal.aborted`).
 *
 * TARGET: semua platform memakai URL halaman yang SEDANG TERBUKA di browser
 * aplikasi (dibaca main lewat `getHostUrl`). Renderer tidak perlu mengirim
 * URL target apa pun.
 */
import type { BrowserWindow, WebContentsView } from 'electron'
import { getSettings } from '../store/settings-store'
import { getHost, getHostUrl, setHostBusy } from './scraper-host'
import { runTikTokCapture, sanitizeTikTokTemplateForRun } from './engine-tiktok'
import { runSocialCapture } from './engine-social'
import type { CaptureRequest } from './engine-tiktok-logic'
import type { Platform } from '../../src/shared/types'
import { plausibleScrapeTarget } from '../../src/shared/platform'

/** Sinyal stop yang diharapkan engine (cukup pakai `aborted`-nya saja). */
type StopSignal = { readonly aborted: boolean }

export type ScrapeDispatch = (event: unknown) => void

interface ActiveRun {
  runId: string
  abort: AbortController
  /** View place flag abort in-page ikut dibaca oleh loop fetch IG. */
  view?: WebContentsView
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
  setHostBusy(platform, false)
  try {
    run.abort.abort()
  } catch {
    /* sudah aborted */
  }
  // Flag in-page: engine IG punya loop fetch yang tidak bisa dihentikan_only
  // oleh Promise IPC. Evaluasi terpisah tetap bisa masuk ke dokumen yang sama.
  try {
    void run.view?.webContents
      .executeJavaScript('window.__resoHarvestAbort = true')
      .catch(() => {})
  } catch {
    /* view sudah mati */
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

  const host = mainWindow && !mainWindow.isDestroyed() ? getHost(mainWindow, platform) : null
  setHostBusy(platform, true)
  void done.finally(() => setHostBusy(platform, false))
  active.set(platform, { runId, abort, view: host?.view, done })
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

  const win = mainWindow
  if (!win || win.isDestroyed()) {
    fail('Jendela utama belum siap — buka ulang aplikasi.')
    return
  }

  const settings = getSettings()

  let host
  try {
    host = getHost(win, platform)
  } catch (err) {
    fail(`Gagal menyiapkan browser scraper: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  // URL asli WebContentsView adalah sumber kebenaran. URL siaran bisa basi
  // (misal resolusi profil bawaan yang selesai setelah operator berpindah halaman).
  const hostUrl = host.view.webContents.getURL() || currentHostUrl(platform)

  // ===================== Facebook / Instagram =====================
  if (platform === 'facebook' || platform === 'instagram') {
    const postUrl = plausibleScrapeTarget(hostUrl, platform) ? hostUrl : null

    if (!postUrl) {
      fail(
        platform === 'facebook'
          ? 'Buka dulu postingan Facebook di browser aplikasi, lalu klik "Ambil nama dari halaman ini".'
          : 'Buka dulu postingan Instagram di browser aplikasi, lalu klik "Ambil nama dari halaman ini".'
      )
      return
    }

    // Tampilkan target yang sedang diproses di panel (sebelumnya selalu kosong).
    dispatch({ type: 'SET_TARGET', hint: postUrl })

    const result = await runSocialCapture(host.view, platform, {
      ...settings,
      includeReplies,
      timeoutMs: settings.captureTimeoutMs,
      // Kunci ke postingan yang sedang terbuka saat Scrap ditekan.
      lockUrl: postUrl,
      signal,
    })

    // STOP / runId baru: buang hasil basi (STOP sudah menulis state berhenti).
    if (!isCurrent(platform, runId)) return

    // Stream nama unik per chunk supaya daftar terisi bertahap.
    const unique = [...new Set(result.names)].filter((name): name is string => !!name)
    for (let i = 0; i < unique.length; i += 25) {
      if (!isCurrent(platform, runId)) return
      dispatch({ type: 'PROGRESS', runId, names: unique.slice(i, i + 25) })
    }

    // Tutup run hanya setelah semua chunk terkirim (entry masih dipakai loop di atas).
    if (!finishIfCurrent(platform, runId)) return
    if (result.reason === 'error') {
      dispatch({ type: 'FAIL', runId, message: result.detail || 'Gagal mengambil komentar.' })
      return
    }
    dispatch({
      type: 'DONE',
      runId,
      reason: result.reason,
      ...(result.note ? { note: result.note } : {}),
    })
    return
  }

  // ===================== TikTok =====================
  // Main membaca sendiri URL video yang sedang terbuka (dari `getHostUrl`);
  // renderer tidak perlu mengirim videoUrl. Template jadi fallback.
  const fallbackUrl = host.view.webContents.getURL()
  const currentVideoUrl = plausibleScrapeTarget(hostUrl, 'tiktok')
    ? hostUrl
    : plausibleScrapeTarget(fallbackUrl, 'tiktok')
      ? fallbackUrl
      : null

  // Validasi template SEBELUM navigasi — tapi hanya bila URL video tidak ada.
  // Template invalid → FAIL, jangan loadURL.
  let templateUrl: string | null = null
  if (!currentVideoUrl && settings.tiktokTemplateUrl) {
    templateUrl = sanitizeTikTokTemplateForRun(
      settings.tiktokTemplateUrl,
      settings.tiktokTemplateCapturedAt
    )
    if (!templateUrl) {
      fail('Template TikTok tidak valid — periksa URL template di Pengaturan.')
      return
    }
  }

  if (!templateUrl && !currentVideoUrl) {
    fail(
      'Belum ada target. Buka video TikTok di browser aplikasi atau isi URL template di Pengaturan, lalu Proses lagi.'
    )
    return
  }

  dispatch({ type: 'SET_TARGET', hint: currentVideoUrl ?? templateUrl ?? '' })

  const awemeId =
    currentVideoUrl?.match(/\/video\/(\d+)/)?.[1] ??
    templateUrl?.match(/[?&]aweme_id=(\d+)/)?.[1]

  const req: CaptureRequest = {
    templateUrl,
    templateCapturedAt: settings.tiktokTemplateCapturedAt,
    videoUrl: currentVideoUrl,
    awemeId,
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

/** Baca URL host dengan aman — host bisa belum ada / view sudah mati. */
function currentHostUrl(platform: Platform): string {
  try {
    return getHostUrl(platform) || ''
  } catch {
    return ''
  }
}
