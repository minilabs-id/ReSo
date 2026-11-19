import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { IPC, isPlatform, parseEmployee, parseEmployeeList, parseDate, parseDailyPatch, parseSettingKey, parseSettingValue, parseBatchSave, parseMetaPath, parseBrowserBounds } from './ipc/contracts'
import { getSettings, setSettings, resetSettings } from './store/settings-store'
import { runController, setScrapeMainWindow } from './ipc/run-controller'
import { getHostUrl, hideHost, isScrapeHostContents, loadHost, onScrapClick, setHostBounds, showHost } from './scrape/scraper-host'
import { newRunId } from '../src/shared/state'
import type { Platform } from '../src/shared/types'
import * as db from './db/database'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
/** Opsi terakhir dari UI — dipakai saat tombol Scrap di halaman ditekan. */
const lastIncludeReplies: Record<Platform, boolean> = {
  facebook: false,
  tiktok: false,
  instagram: false,
}

function isHttp(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/** Key yang isinya rahasia — tidak pernah dikembalikan ke renderer lewat bridge umum. */
const SECRET_SETTING_KEYS = new Set(['meta_api'])

function readSettingValue(key: string): unknown {
  const raw = db.getSetting(key)
  if (raw === null) return null
  try {
    if (raw.startsWith('enc:')) {
      const plain = safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
      return JSON.parse(plain) as unknown
    }
    // Format lama (plaintext) tetap terbaca sampai ditulis ulang.
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function writeSettingValue(key: string, value: unknown): void {
  const text = JSON.stringify(value ?? null)
  if (SECRET_SETTING_KEYS.has(key) && safeStorage.isEncryptionAvailable()) {
    db.setSetting(key, `enc:${safeStorage.encryptString(text).toString('base64')}`)
  } else {
    db.setSetting(key, text)
  }
}

function metaToken(): string {
  const value = readSettingValue('meta_api')
  if (!value || typeof value !== 'object') return ''
  const token = (value as { value?: unknown }).value
  return typeof token === 'string' ? token.trim() : ''
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
  setScrapeMainWindow(win)

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
  safeHandle(IPC.appGetMeta, () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: true,
  }))

  // Pengaturan (JSON store). Payload renderer DIVALIDASI di settings-store.
  safeHandle(IPC.settingsGet, () => getSettings())
  safeHandle(IPC.settingsSet, (_event, patch: unknown) => setSettings(patch))
  safeHandle(IPC.settingsReset, () => resetSettings())

  // State scraping (main process = pemilik tunggal).
  safeHandle(IPC.scrapeGetState, (_event, platform: unknown) =>
    isPlatform(platform) ? runController.get(platform) : null
  )
  safeHandle(IPC.scrapeGetAll, () => runController.getAll())
  safeHandle(IPC.scrapeApplyEvent, (_event, platform: unknown, event: unknown) => {
    if (!isPlatform(platform)) return null
    if (event && typeof event === 'object' && (event as { type?: unknown }).type === 'START') {
      const inc = (event as { includeReplies?: unknown }).includeReplies
      lastIncludeReplies[platform] = inc === true
    }
    return runController.apply(platform, event)
  })
  safeHandle(IPC.scrapeClearNames, (_event, platform: unknown) =>
    isPlatform(platform) ? runController.clearNames(platform) : null
  )
  safeHandle(IPC.scrapeReset, (_event, platform: unknown) =>
    isPlatform(platform) ? runController.reset(platform) : null
  )

  // Browser internal yang terlihat + tombol Scrap di halaman postingan.
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
    loadHost(platform, url)
    return true
  })
  safeHandle(IPC.scrapeGetUrl, (_event, platform: unknown) =>
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
  safeHandle(IPC.dbReplaceEmployees, (_event, payload: unknown) => {
    const list = parseEmployeeList(payload)
    if (!list) return { ok: false as const, reason: 'invalid-list' }
    const employees = db.replaceAllEmployees(list)
    broadcastDbChanged()
    return { ok: true as const, employees }
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
    if (SECRET_SETTING_KEYS.has(k)) {
      // Jangan pernah mengirim token ke renderer lewat bridge umum.
      return metaToken() ? { configured: true, value: '' } : null
    }
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
  safeHandle(IPC.dbListSettings, () => db.listSettingKeys())
  safeHandle(IPC.dbExportAll, () => {
    const settings: Record<string, unknown> = {}
    for (const key of db.listSettingKeys()) settings[key] = readSettingValue(key)
    // Cadangan bergerak bersama token Meta yang sudah didekripsi — operator
    // wajib menyimpannya di lokasi terlindungi.
    return { ...db.exportAll(), settings, schemaVersion: 1 }
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
    const parsedSettings: Array<{ key: string; value: unknown }> = []
    if (payload.settings !== undefined) {
      if (!isRecord(payload.settings)) return { ok: false as const, reason: 'invalid-settings' }
      for (const [key, value] of Object.entries(payload.settings)) {
        const k = parseSettingKey(key)
        const parsed = parseSettingValue(value)
        if (!k || !parsed.ok) return { ok: false as const, reason: 'invalid-settings' }
        parsedSettings.push({ key: k, value: parsed.value })
      }
    }
    const conn = db.openDb()
    const tx = conn.transaction(() => {
      db.replaceAllEmployees(employees)
      // Restore = ganti seluruh data, bukan sekadar tambah: hapus rekap lama
      // yang tidak ada di cadangan (kalau tidak, hari basi ikut terbawa).
      db.clearAllDaily()
      for (const row of parsedDaily) db.upsertDaily(row.date, row.patch)
      for (const s of parsedSettings) writeSettingValue(s.key, s.value)
    })
    tx()
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

  // Token Meta tidak pernah dikirim ke renderer: status + proxy fetch dari main.
  safeHandle(IPC.metaStatus, () => ({ configured: !!metaToken() }))
  safeHandle(IPC.metaRequest, async (_event, path: unknown, tokenOverride?: unknown) => {
    const safePath = parseMetaPath(path)
    if (!safePath) return { error: { message: 'Path Meta tidak valid' } }
    const override = typeof tokenOverride === 'string' && tokenOverride.length <= 4096
      ? tokenOverride.trim()
      : ''
    const token = override || metaToken()
    if (!token) return { error: { message: 'Token Meta belum diatur' } }
    try {
      // /debug_token butuh input_token — diisi main dari token yang sama,
      // tidak pernah dikirim dari renderer lewat URL.
      const finalPath = safePath.startsWith('/debug_token')
        ? `${safePath}?input_token=${encodeURIComponent(token)}`
        : safePath
      const resp = await fetch(`https://graph.facebook.com/v19.0${finalPath}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60000),
      })
      return await resp.json() as unknown
    } catch (err) {
      return { error: { message: err instanceof Error ? err.message : 'Gagal menghubungi Meta' } }
    }
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
  // Tombol "Scrap" yang di-inject ke halaman memicu run platform itu.
  onScrapClick((platform) => {
    runController.apply(platform, {
      type: 'START',
      runId: newRunId(),
      includeReplies: lastIncludeReplies[platform],
    })
  })
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

  // Semua contents (termasuk WebContentsView scraper) dilarang membuka jendela baru.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event, url) => {
    const isMain = mainWindow !== null && contents.id === mainWindow.webContents.id
    if (isMain) return // navigasi jendela utama diatur di createWindow

    // WebContentsView scraper boleh navigasi ke situs sosial di session sendiri.
    if (isScrapeHostContents(contents)) return

    event.preventDefault()
    if (isHttp(url)) void shell.openExternal(url).catch(() => {})
  })
})