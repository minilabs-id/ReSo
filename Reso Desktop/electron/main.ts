import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { createRequire } from 'module'

// electron-updater adalah paket CommonJS — named import ESM gagal di runtime.
const nodeRequire = createRequire(import.meta.url)
const { autoUpdater } = nodeRequire('electron-updater') as typeof import('electron-updater')
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { IPC, isPlatform, parseEmployee, parseEmployeeList, parseDate, parseDailyPatch, parseSettingKey, parseSettingValue, parseBatchSave, parseBrowserBounds } from './ipc/contracts'
import { getSettings, setSettings, resetSettings, restoreSettings } from './store/settings-store'
import { SCHEMA_VERSION } from './db/schema'
import { runController, setScrapeMainWindow } from './ipc/run-controller'
import { getHostUrl, hideHost, hostNavState, isScrapeHostContents, loadHost, navigateHost, navigateToOwnProfile, platformForContents, setHostBounds, showHost } from './scrape/scraper-host'
import { isAllowedScrapeUrl } from '../src/shared/platform'
import type { Platform } from '../src/shared/types'
import * as db from './db/database'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

function isHttp(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/** Preferensi disimpan sebagai JSON biasa — tidak ada lagi secret di sini. */
function readSettingValue(key: string): unknown {
  const raw = db.getSetting(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function writeSettingValue(key: string, value: unknown): void {
  db.setSetting(key, JSON.stringify(value ?? null))
}

/** Hanya jendela utama yang boleh memanggil IPC — pertahanan berlapis. */
function safeHandle(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      throw new Error('IPC channel hanya tersedia untuk jendela utama')
    }
    return listener(event, ...args)
  })
}

/** Perbandingan URL eksak — `startsWith` rawan prefix bypass. */
function isAllowedNavigation(url: string): boolean {
  try {
    const target = new URL(url)
    if (isDev) {
      const dev = process.env['ELECTRON_RENDERER_URL']
      if (!dev) return false
      return target.origin === new URL(dev).origin
    }
    return target.href === pathToFileURL(join(__dirname, '../renderer/index.html')).href
  } catch {
    return false
  }
}

/** Beri tahu renderer bahwa data lokal berubah (agar onSnapshot segar). */
function broadcastDbChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.dbChanged)
  }
}

// ===================== Log error lokal (tanpa telemetri jaringan) =====================

const LOG_MAX_BYTES = 1024 * 1024
const LOG_KEEP = 3

function rotateLog(path: string): void {
  try {
    if (!existsSync(path) || statSync(path).size < LOG_MAX_BYTES) return
    const oldest = `${path}.${LOG_KEEP}`
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? path : `${path}.${i}`
      if (existsSync(from)) renameSync(from, `${path}.${i + 1}`)
    }
  } catch {
    /* rotasi gagal — log tetap ditulis ke file utama */
  }
}

export function getErrorLogPath(): string {
  return join(app.getPath('userData'), 'reso-error.log')
}

/** Tulis ke %APPDATA%\reso\reso-error.log — bisa dikirim operator saat melapor. */
export function logError(scope: string, err: unknown): void {
  try {
    const path = getErrorLogPath()
    rotateLog(path)
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    const stamp = new Date().toISOString()
    appendFileSync(path, `[${stamp}] [${scope}] ${message.replace(/\n/g, ' | ')}\n`, 'utf8')
  } catch {
    /* menulis log tidak boleh menghentikan aplikasi */
  }
}

process.on('uncaughtException', (err) => logError('uncaught', err))
process.on('unhandledRejection', (err) => logError('unhandled', err))
app.on('render-process-gone', (_event, _wc, details) =>
  logError('render-process-gone', `${details.reason} (exit ${details.exitCode})`)
)

// ===================== Auto-update (GitHub Releases) =====================

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'not-available'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
  message?: string
}

let updateState: UpdateState = { status: 'idle' }

function setUpdateState(patch: Partial<UpdateState>): void {
  updateState = { ...updateState, ...patch }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.updateStateChanged, updateState)
  }
}

async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setUpdateState({
      status: 'error',
      message: err instanceof Error ? err.message : 'Gagal memeriksa update',
    })
  }
}

/** Dipanggil sekali setelah app ready: cek otomatis tiap kali aplikasi dibuka. */
function setupAutoUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () =>
    setUpdateState({ status: 'checking', message: 'Memeriksa update…' })
  )
  autoUpdater.on('update-available', (info) =>
    setUpdateState({ status: 'available', version: info.version, message: `Versi ${info.version} tersedia` })
  )
  autoUpdater.on('update-not-available', (info) =>
    setUpdateState({ status: 'not-available', version: info.version, message: 'Sudah versi terbaru' })
  )
  autoUpdater.on('download-progress', (progress) =>
    setUpdateState({
      status: 'downloading',
      progress: Math.round(progress.percent),
      message: `Mengunduh update… ${Math.round(progress.percent)}%`,
    })
  )
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState({ status: 'ready', version: info.version, message: `Versi ${info.version} siap dipasang` })
  )
  autoUpdater.on('error', (err) =>
    setUpdateState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
  )

  // Jeda beberapa detik agar startup tidak menunggu jaringan.
  setTimeout(() => void checkForUpdates(), 4000)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    // Harus >= breakpoint `lg` (1024px) Tailwind, kalau tidak sidebar desktop
    // berubah jadi hamburger+bottom nav pada jendela minimum 960px.
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'assets/icons/icon128.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win
  setScrapeMainWindow(win)
  // level 3 = console.error di renderer — simpan untuk diagnosis lapangan.
  win.webContents.on('console-message', (_event, level, message) => {
    if (level === 3) logError('renderer', message)
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      setScrapeMainWindow(null)
      hideHost()
    }
  })

  // Tanpa login/OAuth: semua tautan eksternal dibuka di browser OS, bukan
  // jendela app baru.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  // Jendela utama tidak boleh berpindah ke URL asing (perbandingan origin/path eksak).
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(): void {
  // Pengaturan (JSON store). Payload renderer DIVALIDASI di settings-store.
  safeHandle(IPC.settingsGet, () => getSettings())
  safeHandle(IPC.settingsSet, (_event, patch: unknown) => setSettings(patch))
  safeHandle(IPC.settingsReset, () => resetSettings())

  // State scraping (main process = pemilik tunggal).
  safeHandle(IPC.scrapeGetAll, () => runController.getAll())
  safeHandle(IPC.scrapeApplyEvent, (_event, platform: unknown, event: unknown) => {
    if (!isPlatform(platform)) return null
    return runController.apply(platform, event)
  })
  // Browser internal yang terlihat — aksi ambil nama dipicu dari panel.
  safeHandle(IPC.scrapeOpenBrowser, (_event, platform: unknown, bounds: unknown) => {
    if (!isPlatform(platform)) return false
    const b = parseBrowserBounds(bounds)
    if (!b) return false
    showHost(platform, b)
    return true
  })
  safeHandle(IPC.scrapeCloseBrowser, () => {
    hideHost()
    return true
  })
  safeHandle(IPC.scrapeSetBounds, (_event, bounds: unknown) => {
    const b = parseBrowserBounds(bounds)
    if (!b) return false
    setHostBounds(b)
    return true
  })
  safeHandle(IPC.scrapeNavigate, (_event, platform: unknown, url: unknown) => {
    if (!isPlatform(platform) || typeof url !== 'string') return false
    if (!isAllowedScrapeUrl(url, platform)) return false
    loadHost(platform, url)
    return true
  })
  safeHandle(IPC.scrapeBrowserOwnProfile, async (_event, platform: unknown) => {
    if (!isPlatform(platform)) return ''
    return navigateToOwnProfile(platform)
  })
  safeHandle(IPC.scrapeBrowserBack, (_event, platform: unknown) => {
    if (!isPlatform(platform)) return false
    navigateHost(platform, 'back')
    return true
  })
  safeHandle(IPC.scrapeBrowserForward, (_event, platform: unknown) => {
    if (!isPlatform(platform)) return false
    navigateHost(platform, 'forward')
    return true
  })
  safeHandle(IPC.scrapeBrowserReload, (_event, platform: unknown) => {
    if (!isPlatform(platform)) return false
    navigateHost(platform, 'reload')
    return true
  })
  safeHandle(IPC.scrapeBrowserNavState, (_event, platform: unknown) =>
    isPlatform(platform) ? hostNavState(platform) : { canBack: false, canForward: false }
  )
  safeHandle(IPC.scrapeBrowserGetUrl, (_event, platform: unknown) =>
    isPlatform(platform) ? getHostUrl(platform) : ''
  )

  // Data lokal (SQLite). SQL hanya lewat prepared statement; payload divalidasi.
  safeHandle(IPC.dbListEmployees, () => db.listEmployees())
  safeHandle(IPC.dbUpsertEmployee, (_event, payload: unknown) => {
    const emp = parseEmployee(payload)
    if (!emp) return { ok: false as const, reason: 'invalid-employee' }
    const employee = db.upsertEmployee(emp)
    broadcastDbChanged()
    return { ok: true as const, employee }
  })
  safeHandle(IPC.dbDeleteEmployee, (_event, id: unknown) => {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key || key.length > 128) return { ok: false as const }
    const ok = db.deleteEmployee(key)
    if (ok) broadcastDbChanged()
    return { ok }
  })
  safeHandle(IPC.dbGetDaily, (_event, date: unknown) => {
    const d = parseDate(date)
    return d ? db.getDaily(d) : null
  })
  safeHandle(IPC.dbListDailyRange, (_event, from: unknown, to: unknown) => {
    const f = parseDate(from)
    const t = parseDate(to)
    if (!f || !t) return []
    return db.listDailyRange(f, t)
  })
  safeHandle(IPC.dbUpsertDaily, (_event, date: unknown, patch: unknown) => {
    const d = parseDate(date)
    if (!d) return null
    const result = db.upsertDaily(d, parseDailyPatch(patch))
    broadcastDbChanged()
    return result
  })
  safeHandle(IPC.dbStats, () => db.stats())

  // Pengaturan dokumen tunggal (settings/{id}) — pengganti
  // `dinas/{uid}/settings/{id}` di Firestore. Nilai disimpan sebagai JSON.
  safeHandle(IPC.dbGetSetting, (_event, key: unknown) => {
    const k = parseSettingKey(key)
    if (!k) return null
    return readSettingValue(k)
  })
  safeHandle(IPC.dbSetSetting, (_event, key: unknown, value: unknown) => {
    const k = parseSettingKey(key)
    if (!k) return { ok: false as const, reason: 'invalid-key' }
    const parsed = parseSettingValue(value)
    if (!parsed.ok) return { ok: false as const, reason: 'invalid-value' }
    writeSettingValue(k, parsed.value)
    broadcastDbChanged()
    return { ok: true as const }
  })
  safeHandle(IPC.dbDeleteSetting, (_event, key: unknown) => {
    const k = parseSettingKey(key)
    if (!k) return { ok: false as const }
    db.deleteSetting(k)
    broadcastDbChanged()
    return { ok: true as const }
  })
  safeHandle(IPC.dbGetAllSettings, () => {
    const out: Record<string, unknown> = {}
    for (const key of db.listSettingKeys()) out[key] = readSettingValue(key)
    return out
  })
  safeHandle(IPC.dbListSettings, () => db.listSettingKeys())
  safeHandle(IPC.dbExportAll, () => {
    // Preferensi yang benar-benar dipakai UI ada di electron-store (settings.json),
    // bukan di tabel SQLite lama. Cadangan harus memuat keduanya agar restore
    // benar-benar mengembalikan keadaan operator.
    const legacy: Record<string, unknown> = {}
    for (const key of db.listSettingKeys()) legacy[key] = readSettingValue(key)
    return {
      ...db.exportAll(),
      settings: getSettings(),
      legacySettings: legacy,
      schemaVersion: SCHEMA_VERSION,
    }
  })
  safeHandle(IPC.dbImportAll, (_event, payload: unknown) => {
    if (!isRecord(payload)) return { ok: false as const, reason: 'invalid-payload' }
    if (!Array.isArray(payload.employees) || !Array.isArray(payload.daily)) {
      return { ok: false as const, reason: 'invalid-payload' }
    }
    const employees = parseEmployeeList(payload.employees)
    // Tolak import daripada membuang entri cacat secara diam-diam.
    if (!employees || employees.length !== payload.employees.length) {
      return { ok: false as const, reason: 'invalid-employees' }
    }
    if (employees.length === 0 && payload.allowEmpty !== true) {
      return { ok: false as const, reason: 'empty-employees' }
    }
    const parsedDaily: Array<{ date: string; patch: ReturnType<typeof parseDailyPatch> }> = []
    for (const row of payload.daily) {
      if (!isRecord(row)) return { ok: false as const, reason: 'invalid-daily' }
      const date = parseDate(row.date ?? row.id)
      if (!date) return { ok: false as const, reason: 'invalid-daily' }
      parsedDaily.push({ date, patch: parseDailyPatch(row) })
    }
    if (payload.settings !== undefined && !isRecord(payload.settings)) {
      return { ok: false as const, reason: 'invalid-settings' }
    }
    if (payload.legacySettings !== undefined && !isRecord(payload.legacySettings)) {
      return { ok: false as const, reason: 'invalid-settings' }
    }
    const legacySettings = (payload.legacySettings ?? {}) as Record<string, unknown>
    for (const [key, value] of Object.entries(legacySettings)) {
      const k = parseSettingKey(key)
      const parsed = parseSettingValue(value)
      if (!k || !parsed.ok) return { ok: false as const, reason: 'invalid-settings' }
    }
    const conn = db.openDb()
    const tx = conn.transaction(() => {
      db.replaceAllEmployees(employees)
      // Restore = ganti seluruh data, bukan sekadar tambah: hapus rekap lama
      // yang tidak ada di cadangan (kalau tidak, hari basi ikut terbawa).
      db.clearAllDaily()
      for (const row of parsedDaily) db.upsertDaily(row.date, row.patch)
      for (const [key, value] of Object.entries(legacySettings)) {
        writeSettingValue(key, value)
      }
    })
    tx()
    // Preferensi scraper dipulihkan ke settings.json (bukan tabel SQLite).
    restoreSettings(payload.settings ?? {})
    broadcastDbChanged()
    return { ok: true as const, stats: db.stats() }
  })

  // Batch tulis atomik dari shim Firestore-like di renderer.
  safeHandle(IPC.dbBatchSave, (_event, payload: unknown) => {
    const ops = parseBatchSave(payload)
    if (!ops) return { ok: false as const, reason: 'invalid-payload' }
    const conn = db.openDb()
    const tx = conn.transaction(() => {
      for (const op of ops) {
        if (op.collection === 'employees') {
          if (op.delete) db.deleteEmployee(op.id)
          else {
            const emp = parseEmployee({ ...(op.data as Record<string, unknown>), id: op.id })
            if (!emp) throw new Error('invalid-employee')
            db.upsertEmployee(emp)
          }
        } else if (op.collection === 'dailyEngagement') {
          if (op.delete) db.deleteDaily(op.id)
          else db.upsertDaily(op.id, parseDailyPatch(op.data))
        } else {
          if (op.delete) db.deleteSetting(op.id)
          else {
            const parsed = parseSettingValue(op.data)
            if (!parsed.ok) throw new Error('invalid-setting')
            writeSettingValue(op.id, parsed.value)
          }
        }
      }
    })
    try {
      tx()
    } catch (err) {
      return { ok: false as const, reason: err instanceof Error ? err.message : 'batch-failed' }
    }
    broadcastDbChanged()
    return { ok: true as const }
  })

  safeHandle(IPC.appGetErrorLog, () => {
    try {
      return readFileSync(getErrorLogPath(), 'utf8')
    } catch {
      return ''
    }
  })

  // Auto-update: cek manual & pasang versi yang sudah terunduh.
  safeHandle(IPC.updateGetState, () => updateState)
  safeHandle(IPC.updateCheck, () => {
    if (!app.isPackaged) return false
    void checkForUpdates()
    return true
  })
  safeHandle(IPC.updateInstall, () => {
    if (!app.isPackaged || updateState.status !== 'ready') return false
    autoUpdater.quitAndInstall(false, true)
    return true
  })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function hardenSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}

app.whenReady().then(() => {
  hardenSession()
  registerIpc()
  createWindow()
  // Pekerjaan yang tidak terlihat: jendela lebih dulu, baru cleanup DB &
  // hangatkan preferensi di background.
  setTimeout(() => {
    db.deleteSetting('meta_api')
    getSettings()
  }, 0)
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Tutup SQLite rapi (WAL ter-flush) sebelum proses keluar.
app.on('will-quit', () => {
  try {
    db.closeDb()
  } catch {
    /* sudah tertutup */
  }
})

// Buka tautan eksternal di browser OS, bukan di dalam app (offline: tanpa
// popup login/OAuth).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())

  // Semua contents (termasuk WebContentsView scraper) dilarang membuka jendela baru.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event, url) => {
    const isMain = mainWindow !== null && contents.id === mainWindow.webContents.id
    if (isMain) return // navigasi jendela utama diatur di createWindow

    // WebContentsView scraper hanya boleh tetap di domain platformnya.
    if (isScrapeHostContents(contents)) {
      const platform = platformForContents(contents)
      if (platform && !isAllowedScrapeUrl(url, platform)) event.preventDefault()
      return
    }

    event.preventDefault()
    if (isHttp(url)) void shell.openExternal(url).catch(() => {})
  })
})