/**
 * ScraperHost — satu WebContentsView persisten per platform (pengganti
 * `chrome.tabs` + content script ekstensi lama).
 *
 * KENAPA view persisten: login sosial operator (cookie) harus bertahan antar
 * run. Partition `persist:reso-<platform>` menyimpan cookie di userData, jadi
 * operator login SEKALI, bukan tiap kali rekap.
 *
 * Tampilan: view default-nya disembunyikan (dipakai runner), tapi bisa diangkat
 * jadi browser embedded yang terlihat lewat showHost()/hideHost()/setHostBounds().
 */
import {
  BrowserWindow,
  WebContentsView,
  session,
  type Session,
  type WebContents,
} from 'electron'
import { IPC } from '../ipc/contracts'
import type { Platform } from '../../src/shared/types'
import { isAllowedScrapeUrl } from '../../src/shared/platform'
import {
  OWN_PROFILE_ENTRY,
  instagramOwnUsernameFromHtml,
  tiktokOwnHrefFromHtml,
} from '../../src/shared/own-profile'

/** Ukuran awal view tersembunyi — halaman butuh viewport wajar agar lazy-load jalan. */
const VIEW_WIDTH = 1280
const VIEW_HEIGHT = 900

/**
 * UA Chrome biasa (tanpa "Electron/xx") dipakai supaya TikTok/Instagram tidak
 * menganggap browser sebagai klien otomatis dan memaksa logout/checkpoint.
 */
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

/** Cookie sesi yang tidak punya expiry tidak tersimpan di disk — ubah jadi persisten. */
const COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60
const lastCookieSync = new Map<Platform, number>()

export interface HostHandle {
  view: WebContentsView
  ses: Session
}

const hosts = new Map<Platform, HostHandle>()

/** Platform yang view-nya sedang terlihat (WebContentsView tak punya isVisible()). */
const visiblePlatforms = new Set<Platform>()

/**
 * Jendela induk. API publik showHost/loadHost tidak menerima BrowserWindow,
 * jadi kita ingat jendela yang dipakai runner lewat getHost(), dengan fallback
 * ke jendela utama pertama yang masih hidup.
 */
let ownerWindow: BrowserWindow | null = null

function rememberWindow(win: BrowserWindow): void {
  if (win && !win.isDestroyed()) ownerWindow = win
}

function resolveWindow(): BrowserWindow | null {
  if (ownerWindow && !ownerWindow.isDestroyed()) return ownerWindow
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (win) ownerWindow = win
  return win ?? null
}

/** Hanya navigasi http(s) yang diizinkan. */
function isHttpUrl(raw: string): boolean {
  if (!raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function partitionFor(platform: Platform): string {
  return `persist:reso-${platform}`
}

function ensureSession(platform: Platform): Session {
  const ses = session.fromPartition(partitionFor(platform))
  // Halaman rekap tidak butuh kamera/mikrofon/notifikasi/geolokasi.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setUserAgent(DESKTOP_UA)
  return ses
}

/**
 * Simpan cookie "session" ke disk dengan expiry jauh di depan. Tanpa ini,
 * cookie auth yang tidak punya expirationDate hilang setiap aplikasi ditutup
 * dan operator harus login ulang (terasa seperti sering logout).
 */
function persistSessionCookies(platform: Platform): void {
  const now = Date.now()
  if (now - (lastCookieSync.get(platform) ?? 0) < 60_000) return
  lastCookieSync.set(platform, now)
  const ses = session.fromPartition(partitionFor(platform))
  void ses.cookies.get({}).then((cookies) => {
    for (const cookie of cookies) {
      if (cookie.expirationDate && cookie.expirationDate > now / 1000) continue
      const domain = cookie.domain.replace(/^\./, '')
      const url = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`
      void ses.cookies
        .set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: Math.floor(now / 1000) + COOKIE_TTL_SECONDS,
        })
        .catch(() => {
          /* cookie khusus yang tidak bisa ditulis ulang — abaikan */
        })
    }
  }).catch(() => {
    /* session belum siap — coba lagi saat halaman berikutnya */
  })
}

/** Kirim status browser ke renderer (address bar + spinner). */
function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function broadcastNav(platform: Platform, wc: WebContents): void {
  notifyRenderer(IPC.scrapeBrowserNavigated, { platform, url: wc.getURL() || '' })
}

/** Event host: siaran navigasi & jaga sesi login. */
function wireHostEvents(platform: Platform, view: WebContentsView): void {
  const wc = view.webContents

  // Pasang ulang tombol setiap halaman selesai dimuat / berpindah di dalam SPA.
  const onSettled = (): void => {
    if (!isHttpUrl(wc.getURL())) return
    persistSessionCookies(platform)
    broadcastNav(platform, wc)
    notifyRenderer(IPC.scrapeBrowserLoading, { platform, loading: false })
  }
  wc.on('did-finish-load', onSettled)
  wc.on('did-navigate-in-page', onSettled)
  wc.on('did-navigate', () => {
    broadcastNav(platform, wc)
  })
  wc.on('did-start-loading', () => {
    notifyRenderer(IPC.scrapeBrowserLoading, { platform, loading: true })
  })
}

/**
 * Ambil (atau buat) host untuk platform. View ditambahkan ke window;
 * visibilitas diatur terpisah lewat showHost/hideHost.
 */
export function getHost(win: BrowserWindow, platform: Platform): HostHandle {
  rememberWindow(win)
  const existing = hosts.get(platform)
  if (existing && !existing.view.webContents.isDestroyed()) return existing

  const ses = ensureSession(platform)
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(platform),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  view.setBounds({ x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT })
  // setAudioMuted: halaman sosial bisa autoplay; jangan berisik.
  view.webContents.setAudioMuted(true)
  wireHostEvents(platform, view)
  win.contentView.addChildView(view)
  view.setVisible(false)

  const handle: HostHandle = { view, ses }
  hosts.set(platform, handle)
  return handle
}

/* ------------------------------------------------------------------ */
/* API browser embedded (dipakai IPC / parent agent)                    */
/* ------------------------------------------------------------------ */

/** Buat/pakai host, pasang bounds, lalu tampilkan. */
export function showHost(
  platform: Platform,
  bounds: { x: number; y: number; width: number; height: number }
): void {
  const win = resolveWindow()
  if (!win) return
  // Pastikan hanya satu WebContentsView yang terlihat — jika tidak, view lama
  // tetap menumpuk di atas konten saat operator berpindah menu/platform.
  hideHost()
  const host = getHost(win, platform)
  host.view.setBounds(bounds)
  host.view.setVisible(true)
  visiblePlatforms.add(platform)
}

/** Sembunyikan SEMUA host aktif. */
export function hideHost(): void {
  for (const host of hosts.values()) {
    if (!host.view.webContents.isDestroyed()) host.view.setVisible(false)
  }
  visiblePlatforms.clear()
}

/** Ubah bounds host-host yang sedang terlihat. */
export function setHostBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  for (const platform of visiblePlatforms) {
    const host = hosts.get(platform)
    if (host && !host.view.webContents.isDestroyed()) host.view.setBounds(bounds)
  }
}

/** Muat URL ke view platform — HANYA domain social yang diizinkan. */
export function loadHost(platform: Platform, url: string): void {
  if (!isAllowedScrapeUrl(url, platform)) return
  const win = resolveWindow()
  if (!win) return
  const host = getHost(win, platform)
  if (host.view.webContents.isDestroyed()) return
  try {
    void host.view.webContents.loadURL(url).catch(() => {
      /* navigasi dibatalkan / halaman tutup */
    })
  } catch {
    /* URL tidak bisa dimuat */
  }
}

/** Script deteksi profil — fungsi murni diserialisasi supaya uji & runtime sama. */
const IG_OWN_JS = `(() => {
  const user = (${instagramOwnUsernameFromHtml.toString()})(document.documentElement.innerHTML);
  return user ? '/' + user + '/' : '';
})()`

const TT_OWN_JS = `(() => {
  const html = document.documentElement.innerHTML;
  let href = (${tiktokOwnHrefFromHtml.toString()})(html);
  if (!href) {
    const a = document.querySelector('a[data-e2e="nav-profile"][href^="/@"]')
      || document.querySelector('a[href^="/@"]');
    href = a ? (a.getAttribute('href') || '') : '';
  }
  return href;
})()`

async function findOwnHref(wc: WebContents, script: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = await wc.executeJavaScript(script, true)
      if (typeof v === 'string' && v.startsWith('/')) return v
    } catch {
      /* halaman belum selesai hidrasi */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return ''
}

/**
 * Default pembukaan browser: profil akun yang sedang login, bukan feed/homepage.
 * Mengembalikan URL akhir agar UI bisa menampilkannya.
 */
export async function navigateToOwnProfile(platform: Platform): Promise<string> {
  const host = hosts.get(platform)
  if (!host || host.view.webContents.isDestroyed()) return ''
  const wc = host.view.webContents
  const entry = OWN_PROFILE_ENTRY[platform]
  try {
    await wc.loadURL(entry)
  } catch {
    return getHostUrl(platform) || ''
  }
  if (platform === 'facebook') return getHostUrl(platform) || entry

  const href = await findOwnHref(wc, platform === 'instagram' ? IG_OWN_JS : TT_OWN_JS, 8000)
  if (href) {
    const absolute = new URL(href, entry).toString()
    if (isAllowedScrapeUrl(absolute, platform)) {
      try {
        await wc.loadURL(absolute)
      } catch {
        /* biarkan halaman sebelumnya */
      }
      return getHostUrl(platform) || absolute
    }
  }
  return getHostUrl(platform) || entry
}

/** URL saat ini di view platform, atau '' bila belum ada. */
export function getHostUrl(platform: Platform): string {
  const host = hosts.get(platform)
  if (!host || host.view.webContents.isDestroyed()) return ''
  return host.view.webContents.getURL() || ''
}

/** Platform asal sebuah webContents (dipakai main saat menerima IPC klik). */
export function platformForContents(contents: WebContents): Platform | null {
  for (const [platform, host] of hosts) {
    if (!host.view.webContents.isDestroyed() && host.view.webContents === contents) return platform
  }
  return null
}

export function navigateHost(platform: Platform, action: 'back' | 'forward' | 'reload'): void {
  const host = hosts.get(platform)
  if (!host || host.view.webContents.isDestroyed()) return
  const wc = host.view.webContents
  try {
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (action === 'reload') wc.reloadIgnoringCache()
  } catch {
    /* navigasi dibatalkan */
  }
}

export function hostNavState(platform: Platform): { canBack: boolean; canForward: boolean } {
  const host = hosts.get(platform)
  if (!host || host.view.webContents.isDestroyed()) return { canBack: false, canForward: false }
  try {
    return {
      canBack: host.view.webContents.navigationHistory.canGoBack(),
      canForward: host.view.webContents.navigationHistory.canGoForward(),
    }
  } catch {
    return { canBack: false, canForward: false }
  }
}

/** Main process memakai ini agar navigasi view scraper tidak dibuka ke browser OS. */
export function isScrapeHostContents(contents: WebContents): boolean {
  for (const host of hosts.values()) {
    if (!host.view.webContents.isDestroyed() && host.view.webContents === contents) return true
  }
  return false
}
