/**
 * ScraperHost — satu WebContentsView persisten per platform (pengganti
 * `chrome.tabs` + content script ekstensi lama).
 *
 * KENAPA view persisten: login sosial operator (cookie) harus bertahan antar
 * run. Partition `persist:reso-<platform>` menyimpan cookie di userData, jadi
 * operator login SEKALI, bukan tiap kali rekap.
 *
 * KEAMANAN: view ini memuat halaman pihak ketiga. contextIsolation aktif,
 * nodeIntegration mati, sandbox aktif. Klik tombol Scrap diverifikasi di main
 * process (asal WebContents host + domain + debounce). Navigasi dibatasi domain.
 *
 * Tampilan: view default-nya disembunyikan (dipakai runner), tapi bisa diangkat
 * jadi browser embedded yang terlihat lewat showHost()/hideHost()/setHostBounds().
 */
import {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  type Session,
  type WebContents,
} from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { IPC } from '../ipc/contracts'
import type { Platform } from '../../src/shared/types'
import { isAllowedScrapeUrl } from '../../src/shared/platform'

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

/** id elemen tombol — dipakai untuk idempotensi injeksi. */
const SCRAP_BUTTON_ID = '__reso_scrap_btn'

/**
 * Script injeksi. Tombol fixed di kanan-atas, kontras tinggi, z-index maksimal.
 * Klik diteruskan lewat preload `window.resoScrap.click`. MutationObserver
 * memasang ulang tombol bila halaman SPA mengganti DOM tanpa navigasi.
 */
function buildScrapButtonScript(): string {
  return `
(function () {
  var ID = '${SCRAP_BUTTON_ID}';
  function mount() {
    // Injeksi baru mengganti tombol & observer lama supaya tidak ada dua
    // tombol Scrap bertumpuk setelah SPA mengganti DOM.
    try { if (window.__resoScrapMO) window.__resoScrapMO.disconnect(); } catch (_) {}
    var old = document.getElementById(ID);
    if (old && old.remove) old.remove();
    if (!document.body) return;
    var btn = document.createElement('button');
    btn.id = ID;
    btn.type = 'button';
    btn.textContent = 'Scrap';
    btn.setAttribute('style', [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:2147483647',
      'padding:8px 14px',
      'border:2px solid #111111',
      'border-radius:999px',
      'background:#ffffff',
      'color:#111111',
      'font:600 13px/1 system-ui,-apple-system,Segoe UI,sans-serif',
      'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
      'cursor:pointer',
      'opacity:0.94'
    ].join(';'));
    btn.addEventListener('click', function (e) {
      // Tolak klik programatik dari script halaman (el.click()). Hanya klik
      // pengguna sungguhan yang diteruskan ke main process.
      if (!e.isTrusted) return;
      // Main memakai debounce 2 dtk. Beri umpan balik di tombol supaya klik
      // kedua tidak terasa "mati" tanpa sebab.
      if (btn.getAttribute('data-busy') === '1') return;
      e.preventDefault();
      e.stopPropagation();
      btn.setAttribute('data-busy', '1');
      var label = btn.textContent;
      btn.textContent = 'Diproses…';
      window.setTimeout(function () {
        btn.setAttribute('data-busy', '0');
        btn.textContent = label;
      }, 2200);
      try { if (window.resoScrap) window.resoScrap.click(); } catch (_) {}
    }, true);
    document.body.appendChild(btn);
  }
  mount();
  if (!document.getElementById(ID)) {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
  try {
    var mo = new MutationObserver(function () { if (!document.getElementById(ID)) mount(); });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
    window.__resoScrapMO = mo;
  } catch (_) {}
})();
`
}

export interface HostHandle {
  view: WebContentsView
  ses: Session
}

/** Callback tombol Scrap: platform asal klik. */
type ScrapCallback = (platform: Platform) => void

const hosts = new Map<Platform, HostHandle>()

/** Platform yang view-nya sedang terlihat (WebContentsView tak punya isVisible()). */
const visiblePlatforms = new Set<Platform>()

/** Subscriber onScrapClick — multi subscriber lewat Set. */
const scrapSubscribers = new Set<ScrapCallback>()

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

/**
 * Preload browser internal punya beberapa lokasi sah tergantung cara app dijalankan:
 * - packaged: <app.asar>/assets/webview-preload.cjs
 * - dev/preview dari out/main/index.js: <repo>/assets/webview-preload.cjs
 * - root proyek saat dijalankan langsung
 */
function resolveScrapPreload(): string {
  const candidates = [
    join(app.getAppPath(), 'assets', 'webview-preload.cjs'),
    join(__dirname, '..', '..', 'assets', 'webview-preload.cjs'),
    join(__dirname, '..', 'assets', 'webview-preload.cjs'),
    join(process.cwd(), 'assets', 'webview-preload.cjs'),
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!
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

/** Injeksi script tombol Scrap ke satu webContents. */
function injectInto(wc: WebContents, platform: Platform): void {
  if (!wc || wc.isDestroyed()) return
  try {
    void wc.executeJavaScript(buildScrapButtonScript()).catch(() => {
      /* halaman navigasi sebelum injeksi selesai */
    })
  } catch {
    /* view sudah mati */
  }
}

/** Event host: injeksi tombol tiap load, siaran navigasi, & jaga sesi login. */
function wireHostEvents(platform: Platform, view: WebContentsView): void {
  const wc = view.webContents

  // Pasang ulang tombol setiap halaman selesai dimuat / berpindah di dalam SPA.
  const onSettled = (): void => {
    if (!isHttpUrl(wc.getURL())) return
    persistSessionCookies(platform)
    injectInto(wc, platform)
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
      preload: resolveScrapPreload(),
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

/** URL saat ini di view platform, atau '' bila belum ada. */
export function getHostUrl(platform: Platform): string {
  const host = hosts.get(platform)
  if (!host || host.view.webContents.isDestroyed()) return ''
  return host.view.webContents.getURL() || ''
}

/** Main memanggil ini setelah ipc `reso:scrap:click` terveraksi dari host. */
export function notifyScrapClick(platform: Platform): void {
  for (const cb of scrapSubscribers) {
    try {
      cb(platform)
    } catch {
      /* subscriber error tidak boleh memutus yang lain */
    }
  }
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

/** Daftar callback klik Scrap. Return fungsi unsubscribe. */
export function onScrapClick(cb: ScrapCallback): () => void {
  scrapSubscribers.add(cb)
  return () => {
    scrapSubscribers.delete(cb)
  }
}

/** Main process memakai ini agar navigasi view scraper tidak dibuka ke browser OS. */
export function isScrapeHostContents(contents: WebContents): boolean {
  for (const host of hosts.values()) {
    if (!host.view.webContents.isDestroyed() && host.view.webContents === contents) return true
  }
  return false
}
