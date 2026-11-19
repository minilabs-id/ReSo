/**
 * ScraperHost — satu WebContentsView persisten per platform (pengganti
 * `chrome.tabs` + content script ekstensi lama).
 *
 * KENAPA view persisten: login sosial operator (cookie) harus bertahan antar
 * run. Partition `persist:reso-<platform>` menyimpan cookie di userData, jadi
 * operator login SEKALI, bukan tiap kali rekap.
 *
 * KEAMANAN: view ini memuat halaman pihak ketiga. contextIsolation aktif,
 * nodeIntegration mati, sandbox aktif. Satu-satunya jalan balik adalah
 * `window.resoScrap.click(nonce)` dari preload khusus; main memverifikasi nonce
 * yang di-inject ulang setiap halaman dimuat (tidak bisa dipalsukan console.log).
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
import { join } from 'path'
import { randomUUID } from 'crypto'
import { IPC } from '../ipc/contracts'
import type { Platform } from '../../src/shared/types'

/** Ukuran awal view tersembunyi — halaman butuh viewport wajar agar lazy-load jalan. */
const VIEW_WIDTH = 1280
const VIEW_HEIGHT = 900

/** id elemen tombol — dipakai untuk idempotensi injeksi. */
const SCRAP_BUTTON_ID = '__reso_scrap_btn'

/** Nonce per platform, diganti tiap kali halaman selesai dimuat. */
const scrapNonce = new Map<Platform, string>()

function nonceFor(platform: Platform): string {
  let value = scrapNonce.get(platform)
  if (!value) {
    value = randomUUID()
    scrapNonce.set(platform, value)
  }
  return value
}

/**
 * Script injeksi. Tombol fixed di kanan-atas, kontras tinggi, z-index maksimal.
 * Klik mengirim nonce lewat preload `window.resoScrap.click`. MutationObserver
 * memasang ulang tombol bila halaman SPA mengganti DOM tanpa navigasi.
 */
function buildScrapButtonScript(nonce: string): string {
  return `
(function () {
  var ID = '${SCRAP_BUTTON_ID}';
  var NONCE = ${JSON.stringify(nonce)};
  function mount() {
    if (document.getElementById(ID)) return;
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
      e.preventDefault();
      e.stopPropagation();
      try { if (window.resoScrap) window.resoScrap.click(NONCE); } catch (_) {}
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
  return ses
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

/** Injeksi script dengan nonce baru ke satu webContents. */
function injectInto(wc: WebContents, platform: Platform): void {
  if (!wc || wc.isDestroyed()) return
  try {
    void wc.executeJavaScript(buildScrapButtonScript(nonceFor(platform))).catch(() => {
      /* halaman navigasi sebelum injeksi selesai */
    })
  } catch {
    /* view sudah mati */
  }
}

/** Event host: nonce baru + injeksi tiap load, dan siaran navigasi/loading. */
function wireHostEvents(platform: Platform, view: WebContentsView): void {
  const wc = view.webContents

  const onSettled = (): void => {
    if (!isHttpUrl(wc.getURL())) return
    // Regenerate nonce pada setiap halaman baru.
    scrapNonce.set(platform, randomUUID())
    injectInto(wc, platform)
    broadcastNav(platform, wc)
    notifyRenderer(IPC.scrapeBrowserLoading, { platform, loading: false })
  }
  wc.on('did-finish-load', onSettled)
  wc.on('did-navigate-in-page', onSettled)
  wc.on('did-navigate', () => broadcastNav(platform, wc))
  wc.on('did-start-loading', () =>
    notifyRenderer(IPC.scrapeBrowserLoading, { platform, loading: true })
  )
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
      preload: join(app.getAppPath(), 'assets', 'webview-preload.cjs'),
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

/** Muat URL http(s) ke view platform (diabaikan kalau bukan http(s)). */
export function loadHost(platform: Platform, url: string): void {
  if (!isHttpUrl(url)) return
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

/** Injeksi manual tombol Scrap ke halaman yang sedang dimuat. */
export function injectScrapButton(platform: Platform): void {
  const host = hosts.get(platform)
  if (host) injectInto(host.view.webContents, platform)
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

/** Verifikasi nonce klik terhadap nonce halaman aktif platform. */
export function verifyScrapClick(platform: Platform, nonce: unknown): boolean {
  return typeof nonce === 'string' && nonce.length > 8 && scrapNonce.get(platform) === nonce
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
    else if (action === 'reload') wc.reload()
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

/* ------------------------------------------------------------------ */
/* Export lama (dipertahankan)                                         */
/* ------------------------------------------------------------------ */

export function destroyHost(platform: Platform): void {
  const host = hosts.get(platform)
  if (!host) return
  hosts.delete(platform)
  visiblePlatforms.delete(platform)
  if (!host.view.webContents.isDestroyed()) {
    try {
      host.view.webContents.close()
    } catch {
      /* sudah mati */
    }
  }
}

export function destroyAllHosts(): void {
  for (const platform of [...hosts.keys()]) destroyHost(platform)
}

/** Berapa host aktif — dipakai smoke test & diagnosa UI. */
export function activeHostCount(): number {
  return hosts.size
}

/** Main process memakai ini agar navigasi view scraper tidak dibuka ke browser OS. */
export function isScrapeHostContents(contents: WebContents): boolean {
  for (const host of hosts.values()) {
    if (!host.view.webContents.isDestroyed() && host.view.webContents === contents) return true
  }
  return false
}
