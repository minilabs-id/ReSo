/**
 * Database lokal ReSo (SQLite via better-sqlite3).
 *
 * Satu file di `userData/reso.db` — pengganti tunggal Firestore (#10).
 * Semua query disiapkan (prepared statement) dan berjalan sinkron; SQLite
 * lokal jauh lebih cepat dari IPC sehingga blocking kecil tidak masalah.
 *
 * Driver di-load lazily agar kegagalan native module (ABI mismatch / prebuild
 * hilang) tidak menjatuhkan proses main saat startup — error muncul saat DB
 * pertama kali dipakai.
 */
import type BetterSqlite3 from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import {
  SCHEMA_SQL,
  SCHEMA_VERSION,
  dailyFromRow,
  dailyPatchToColumns,
  employeeFromRow,
  employeeToRow,
  cleanText,
  type DailyRow,
  type EmployeeRow,
} from './schema'
import type { Employee, DailyEngagement } from '../../src/shared/types'

let db: BetterSqlite3.Database | null = null
let DatabaseCtor: typeof BetterSqlite3 | null = null

function getDatabaseCtor(): typeof BetterSqlite3 {
  if (DatabaseCtor) return DatabaseCtor
  // Lazy require: jangan jatuhkan proses main saat startup jika native
  // module (ABI Electron) belum tersedia — error muncul saat DB dipakai.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DatabaseCtor = require('better-sqlite3') as typeof BetterSqlite3
  return DatabaseCtor
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Buka (sekali) + pastikan skema ada. Aman dipanggil berkali-kali. */
export function openDb(): BetterSqlite3.Database {
  if (db) return db
  const Database = getDatabaseCtor()
  const dbPath = join(app.getPath('userData'), 'reso.db')
  const conn = new Database(dbPath)
  conn.pragma('journal_mode = WAL')
  conn.pragma('foreign_keys = ON')
  conn.exec(SCHEMA_SQL)
  conn
    .prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(String(SCHEMA_VERSION))
  db = conn
  return conn
}

export function closeDb(): void {
  if (!db) return
  db.close()
  db = null
}

export function getDbPath(): string {
  return join(app.getPath('userData'), 'reso.db')
}

// ===================== Pegawai =====================

export function listEmployees(): Employee[] {
  const rows = openDb()
    .prepare('SELECT * FROM employees ORDER BY name COLLATE NOCASE')
    .all() as EmployeeRow[]
  return rows.map(employeeFromRow)
}

export function getEmployee(id: string): Employee | null {
  const row = openDb().prepare('SELECT * FROM employees WHERE id = ?').get(id) as
    | EmployeeRow
    | undefined
  return row ? employeeFromRow(row) : null
}

/** Insert atau replace penuh satu pegawai. */
export function upsertEmployee(input: Employee): Employee {
  const now = nowIso()
  const row = employeeToRow(input, now)
  openDb()
    .prepare(
      `INSERT INTO employees (
         id, name, nip, bidang, ig_username, ig_username2, fb_name, fb_name2,
         tiktok_name, tiktok_name2, aliases, created_at, updated_at
       ) VALUES (
         @id, @name, @nip, @bidang, @ig_username, @ig_username2, @fb_name, @fb_name2,
         @tiktok_name, @tiktok_name2, @aliases, @created_at, @updated_at
       )
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         nip = excluded.nip,
         bidang = excluded.bidang,
         ig_username = excluded.ig_username,
         ig_username2 = excluded.ig_username2,
         fb_name = excluded.fb_name,
         fb_name2 = excluded.fb_name2,
         tiktok_name = excluded.tiktok_name,
         tiktok_name2 = excluded.tiktok_name2,
         aliases = excluded.aliases,
         updated_at = excluded.updated_at`
    )
    .run(row)
  return getEmployee(row.id) as Employee
}

/** Replace seluruh master pegawai dalam satu transaksi (jalur import). */
export function replaceAllEmployees(list: Employee[]): Employee[] {
  const conn = openDb()
  const now = nowIso()
  const tx = conn.transaction((items: Employee[]) => {
    conn.prepare('DELETE FROM employees').run()
    for (const item of items) {
      const row = employeeToRow(item, now)
      conn
        .prepare(
          `INSERT INTO employees (
             id, name, nip, bidang, ig_username, ig_username2, fb_name, fb_name2,
             tiktok_name, tiktok_name2, aliases, created_at, updated_at
           ) VALUES (
             @id, @name, @nip, @bidang, @ig_username, @ig_username2, @fb_name, @fb_name2,
             @tiktok_name, @tiktok_name2, @aliases, @created_at, @updated_at
           )`
        )
        .run(row)
    }
  })
  tx(list)
  return listEmployees()
}

export function deleteEmployee(id: string): boolean {
  return openDb().prepare('DELETE FROM employees WHERE id = ?').run(id).changes > 0
}

// ===================== Rekap harian =====================

export function getDaily(date: string): DailyEngagement | null {
  const row = openDb().prepare('SELECT * FROM daily_engagement WHERE date = ?').get(date) as
    | DailyRow
    | undefined
  return row ? dailyFromRow(row) : null
}

export function listDailyRange(from: string, to: string): DailyEngagement[] {
  const rows = openDb()
    .prepare('SELECT * FROM daily_engagement WHERE date >= ? AND date <= ? ORDER BY date')
    .all(from, to) as DailyRow[]
  return rows.map(dailyFromRow)
}

export function listAllDaily(): DailyEngagement[] {
  const rows = openDb()
    .prepare('SELECT * FROM daily_engagement ORDER BY date')
    .all() as DailyRow[]
  return rows.map(dailyFromRow)
}

/**
 * Upsert sebagian: kolom di luar `patch` TIDAK tersentuh. Jalur utama
 * (rekap manual + kiriman scraper) memakai ini agar tidak saling menimpa.
 */
export function upsertDaily(date: string, patch: Partial<DailyEngagement>): DailyEngagement {
  const conn = openDb()
  const cols = dailyPatchToColumns({ ...patch, date }, nowIso())
  const names = Object.keys(cols)
  const tx = conn.transaction(() => {
    conn
      .prepare('INSERT INTO daily_engagement (date) VALUES (?) ON CONFLICT(date) DO NOTHING')
      .run(date)
    const sets = names.map((n) => `${n} = @${n}`).join(', ')
    conn
      .prepare(`UPDATE daily_engagement SET ${sets} WHERE date = @date`)
      .run({ ...cols, date })
  })
  tx()
  return getDaily(date) as DailyEngagement
}

export function deleteDaily(date: string): boolean {
  return openDb().prepare('DELETE FROM daily_engagement WHERE date = ?').run(date).changes > 0
}

// ===================== Settings / meta =====================

export function getSetting(key: string): string | null {
  const row = openDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined
  return row ? row.value : null
}

export function setSetting(key: string, value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  openDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, text)
}

export function deleteSetting(key: string): void {
  openDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

/** Daftar key pengaturan yang tersimpan (value tidak dikembalikan). */
export function listSettingKeys(): string[] {
  const rows = openDb().prepare('SELECT key FROM settings ORDER BY key').all() as {
    key: string
  }[]
  return rows.map((r) => r.key)
}

// ===================== Statistik / pemeliharaan =====================

export interface DbStats {
  employees: number
  days: number
  path: string
  schemaVersion: number
}

export function stats(): DbStats {
  const conn = openDb()
  const emp = conn.prepare('SELECT COUNT(*) AS c FROM employees').get() as { c: number }
  const days = conn.prepare('SELECT COUNT(*) AS c FROM daily_engagement').get() as { c: number }
  const ver = conn.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  return {
    employees: emp.c,
    days: days.c,
    path: getDbPath(),
    schemaVersion: Number(ver?.value ?? SCHEMA_VERSION),
  }
}

/** Ekspor seluruh data (untuk backup JSON manual / debugging). */
export function exportAll(): { employees: Employee[]; daily: DailyEngagement[] } {
  return { employees: listEmployees(), daily: listAllDaily() }
}

export { cleanText }
