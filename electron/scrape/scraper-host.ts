/**
 * ScraperHost — satu WebContentsView persisten per platform (pengganti
 * `chrome.tabs` + content script ekstensi lama).
 *
 * KENAPA view persisten: login sosial operator (cookie) harus bertahan antar
 * run. Partition `persist:reso-<platform>` menyimpan cookie di userData, jadi
 * operator login SEKALI, bukan tiap kali rekap.
 *
 * KEAMANAN: view ini memuat halaman pihak ketiga. contextIsolation aktif,
 * nodeIntegration mati, dan TIDAK ada preload yang diekspos ke halaman itu.
 */
import { BrowserWindow, WebContentsView, session, type Session } from 'electron'
import type { Platform } from '../../src/shared/types'

/** Ukuran view tersembunyi — halaman butuh viewport wajar agar lazy-load jalan. */
const VIEW_WIDTH = 1280
const VIEW_HEIGHT = 900

export interface HostHandle {
  view: WebContentsView
  ses: Session
}

const hosts = new Map<Platform, HostHandle>()

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

/**
 * Ambil (atau buat) host untuk platform. View TIDAK ditambahkan ke window →
 * benar-benar offscreen secara visual, tapi tetap "terlihat" oleh Chromium
 * sehingga request/rAF/timer berjalan normal (WebContentsView tidak di-throttle
 * bila viewport-nya ada).
 */
export function getHost(win: BrowserWindow, platform: Platform): HostHandle {
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
  win.contentView.addChildView(view)
  view.setVisible(false)

  const handle: HostHandle = { view, ses }
  hosts.set(platform, handle)
  return handle
}

export function destroyHost(platform: Platform): void {
  const host = hosts.get(platform)
  if (!host) return
  hosts.delete(platform)
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
