import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import { IPC, isPlatform, parseEmployee, parseEmployeeList, parseDate, parseDailyPatch, parseSettingKey, parseSettingValue } from './ipc/contracts'
import { getSettings, setSettings, resetSettings } from './store/settings-store'
import { runController } from './ipc/run-controller'
import * as db from './db/database'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

function isHttp(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/** Beri tahu renderer bahwa data lokal berubah (agar onSnapshot segar). */
function broadcastDbChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.dbChanged)
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
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

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Tanpa login/OAuth: semua tautan eksternal dibuka di browser OS, bukan
  // jendela app baru.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  // Jendela utama tidak boleh berpindah ke URL asing.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev
      ? url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '')
      : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(): void {
  ipcMain.handle(IPC.appGetMeta, () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: true,
  }))

  // Pengaturan (JSON store). Payload renderer DIVALIDASI di settings-store.
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_event, patch: unknown) => setSettings(patch))
  ipcMain.handle(IPC.settingsReset, () => resetSettings())

  // State scraping (main process = pemilik tunggal).
  ipcMain.handle(IPC.scrapeGetState, (_event, platform: unknown) =>
    isPlatform(platform) ? runController.get(platform) : null
  )
  ipcMain.handle(IPC.scrapeGetAll, () => runController.getAll())
  ipcMain.handle(IPC.scrapeApplyEvent, (_event, platform: unknown, event: unknown) =>
    isPlatform(platform) ? runController.apply(platform, event) : null
  )
  ipcMain.handle(IPC.scrapeClearNames, (_event, platform: unknown) =>
    isPlatform(platform) ? runController.clearNames(platform) : null
  )
  ipcMain.handle(IPC.scrapeReset, (_event, platform: unknown) =>
    isPlatform(platform) ? runController.reset(platform) : null
  )

  // Data lokal (SQLite). SQL hanya lewat prepared statement; payload divalidasi.
  ipcMain.handle(IPC.dbListEmployees, () => db.listEmployees())
  ipcMain.handle(IPC.dbUpsertEmployee, (_event, payload: unknown) => {
    const emp = parseEmployee(payload)
    if (!emp) return { ok: false as const, reason: 'invalid-employee' }
    const employee = db.upsertEmployee(emp)
    broadcastDbChanged()
    return { ok: true as const, employee }
  })
  ipcMain.handle(IPC.dbReplaceEmployees, (_event, payload: unknown) => {
    const list = parseEmployeeList(payload)
    if (!list) return { ok: false as const, reason: 'invalid-list' }
    const employees = db.replaceAllEmployees(list)
    broadcastDbChanged()
    return { ok: true as const, employees }
  })
  ipcMain.handle(IPC.dbDeleteEmployee, (_event, id: unknown) => {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key || key.length > 128) return { ok: false as const }
    const ok = db.deleteEmployee(key)
    if (ok) broadcastDbChanged()
    return { ok }
  })
  ipcMain.handle(IPC.dbGetDaily, (_event, date: unknown) => {
    const d = parseDate(date)
    return d ? db.getDaily(d) : null
  })
  ipcMain.handle(IPC.dbListDailyRange, (_event, from: unknown, to: unknown) => {
    const f = parseDate(from)
    const t = parseDate(to)
    if (!f || !t) return []
    return db.listDailyRange(f, t)
  })
  ipcMain.handle(IPC.dbUpsertDaily, (_event, date: unknown, patch: unknown) => {
    const d = parseDate(date)
    if (!d) return null
    const result = db.upsertDaily(d, parseDailyPatch(patch))
    broadcastDbChanged()
    return result
  })
  ipcMain.handle(IPC.dbStats, () => db.stats())

  // Pengaturan dokumen tunggal (settings/{id}) — pengganti
  // `dinas/{uid}/settings/{id}` di Firestore. Nilai disimpan sebagai JSON.
  ipcMain.handle(IPC.dbGetSetting, (_event, key: unknown) => {
    const k = parseSettingKey(key)
    if (!k) return null
    const raw = db.getSetting(k)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return raw
    }
  })
  ipcMain.handle(IPC.dbSetSetting, (_event, key: unknown, value: unknown) => {
    const k = parseSettingKey(key)
    if (!k) return { ok: false as const, reason: 'invalid-key' }
    const parsed = parseSettingValue(value)
    if (!parsed.ok) return { ok: false as const, reason: 'invalid-value' }
    db.setSetting(k, parsed.value)
    broadcastDbChanged()
    return { ok: true as const }
  })
  ipcMain.handle(IPC.dbDeleteSetting, (_event, key: unknown) => {
    const k = parseSettingKey(key)
    if (!k) return { ok: false as const }
    db.deleteSetting(k)
    broadcastDbChanged()
    return { ok: true as const }
  })
  ipcMain.handle(IPC.dbListSettings, () => db.listSettingKeys())
  ipcMain.handle(IPC.dbExportAll, () => db.exportAll())
  ipcMain.handle(IPC.dbImportAll, (_event, payload: unknown) => {
    if (!isRecord(payload)) return { ok: false as const, reason: 'invalid-payload' }
    const employees = parseEmployeeList(payload.employees)
    if (!employees) return { ok: false as const, reason: 'invalid-employees' }
    const daily = Array.isArray(payload.daily) ? payload.daily : []
    const conn = db.openDb()
    const tx = conn.transaction(() => {
      db.replaceAllEmployees(employees)
      for (const row of daily) {
        if (!isRecord(row)) continue
        const date = parseDate(row.date ?? row.id)
        if (!date) continue
        db.upsertDaily(date, parseDailyPatch(row))
      }
    })
    tx()
    broadcastDbChanged()
    return { ok: true as const, stats: db.stats() }
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

  contents.on('will-navigate', (event, url) => {
    const isMain = mainWindow !== null && contents.id === mainWindow.webContents.id
    if (isMain) return // navigasi jendela utama diatur di createWindow

    event.preventDefault()
    if (isHttp(url)) void shell.openExternal(url).catch(() => {})
  })
})