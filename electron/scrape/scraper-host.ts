/**
 * ScraperHost — satu WebContentsView persisten per platform (pengganti
 * `chrome.tabs` + content script ekstensi lama).
 *
 * KENAPA view persisten: login sosial operator (cookie) harus bertahan antar
 * run. Partition `persist:reso-<platform>` menyimpan cookie di userData, jadi
 * operator login SEKALI, bukan tiap kali rekap.
 *
 * KEAMANAN: view ini memuat halaman pihak ketiga. contextIsolation aktif,
 * nodeIntegration mati, sandbox aktif, dan TIDAK ada preload / ipcRenderer yang
 * diekspos ke halaman itu. Satu-satunya jalan balik dari halaman ke main adalah
 * marker `__RESO_SCRAP__` lewat console.log yang ditangkap di file ini.
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
import type { Platform } from '../../src/shared/types'

/** Ukuran awal view tersembunyi — halaman butuh viewport wajar agar lazy-load jalan. */
const VIEW_WIDTH = 1280
const VIEW_HEIGHT = 900

/** Marker yang dikirim tombol "Scrap" lewat console.log ke main process. */
const SCRAP_MARKER = '__RESO_SCRAP__'

/** id elemen tombol — dipakai untuk idempotensi injeksi. */
const SCRAP_BUTTON_ID = '__reso_scrap_btn'

/**
 * Script injeksi. Tombol fixed di kanan-atas, kontras tinggi, z-index maksimal.
 * Pasang hanya kalau belum ada (idempoten). Kalau `document.body` belum ada,
 * pasang listener DOMContentLoaded; retry did-finish-load juga dilakukan dari
 * main process sebagai jaring pengaman.
 */
const SCRAP_BUTTON_SCRIPT = `
(function () {
  var ID = '${SCRAP_BUTTON_ID}';
  if (document.getElementById(ID)) return;
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
      try { console.log('${SCRAP_MARKER}'); } catch (_) {}
    }, true);
    document.body.appendChild(btn);
  }
  mount();
  if (!document.getElementById(ID)) {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
`

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

/** Injeksi script ke satu webContents (dipakai manual & auto saat load). */
function injectInto(wc: WebContents): void {
  if (!wc || wc.isDestroyed()) return
  try {
    void wc.executeJavaScript(SCRAP_BUTTON_SCRIPT).catch(() => {
      /* halaman navigasi sebelum injeksi selesai */
    })
  } catch {
    /* view sudah mati */
  }
}

/**
 * Pasang event tiap host:
 *  - console-message → deteksi marker, kabari subscriber.
 *  - did-finish-load → injeksi awal (body sudah ada).
 *  - did-navigate-in-page → injeksi ulang untuk SPA.
 */
function wireHostEvents(platform: Platform, view: WebContentsView): void {
  const wc = view.webContents

  wc.on('console-message', (_event, _level, message) => {
    if (typeof message !== 'string' || message.indexOf(SCRAP_MARKER) === -1) return
    for (const cb of scrapSubscribers) {
      try {
        cb(platform)
      } catch {
        /* subscriber yang error tidak boleh memutus yang lain */
      }
    }
  })

  const maybeInject = (): void => {
    if (isHttpUrl(wc.getURL())) injectInto(wc)
  }
  wc.on('did-finish-load', maybeInject)
  wc.on('did-navigate-in-page', maybeInject)
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
  if (host) injectInto(host.view.webContents)
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
