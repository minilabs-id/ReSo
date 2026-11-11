/**
 * Skema database lokal ReSo (SQLite) + konversi baris ↔ tipe domain.
 *
 * PRINSIP:
 * - Ini pengganti tunggal Firestore (keputusan #10 di specify.md). Tidak ada
 *   tabel admin/user — aplikasi tanpa login.
 * - Kolom & konversi di sini PURE (tanpa better-sqlite3) supaya bisa diuji
 *   di Node biasa tanpa Electron.
 * - Nama kolom snake_case; tipe domain tetap camelCase.
 */
import type { Employee, DailyEngagement, UnmatchedName } from '../../src/shared/types'

export const SCHEMA_VERSION = 1

/**
 * DDL. `employees.id` TEXT (uuid dari renderer) — bukan autoincrement, supaya
 * data hasil import/ekspor Excel tetap punya identitas stabil.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  nip           TEXT NOT NULL DEFAULT '',
  bidang        TEXT,
  ig_username   TEXT,
  ig_username2  TEXT,
  fb_name       TEXT,
  fb_name2      TEXT,
  tiktok_name   TEXT,
  tiktok_name2  TEXT,
  aliases       TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT,
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);

CREATE TABLE IF NOT EXISTS daily_engagement (
  date                       TEXT PRIMARY KEY,
  ig_raw_text                TEXT,
  fb_raw_text                TEXT,
  tiktok_raw_text            TEXT,
  ig_engaged_employee_ids    TEXT NOT NULL DEFAULT '[]',
  fb_engaged_employee_ids    TEXT NOT NULL DEFAULT '[]',
  tiktok_engaged_employee_ids TEXT NOT NULL DEFAULT '[]',
  ig_links                   TEXT NOT NULL DEFAULT '[]',
  fb_links                   TEXT NOT NULL DEFAULT '[]',
  tiktok_links               TEXT NOT NULL DEFAULT '[]',
  unmatched_names            TEXT NOT NULL DEFAULT '[]',
  posted_at                  TEXT NOT NULL DEFAULT '[]',
  auto_filled_at             TEXT,
  auto_filled_count          INTEGER,
  verified_at                TEXT,
  updated_at                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_engagement(date);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
`

/** Baris mentah dari SQLite (semua nilai TEXT/INTEGER/NULL). */
export interface EmployeeRow {
  id: string
  name: string
  nip: string
  bidang: string | null
  ig_username: string | null
  ig_username2: string | null
  fb_name: string | null
  fb_name2: string | null
  tiktok_name: string | null
  tiktok_name2: string | null
  aliases: string
  created_at: string | null
  updated_at: string | null
}

export interface DailyRow {
  date: string
  ig_raw_text: string | null
  fb_raw_text: string | null
  tiktok_raw_text: string | null
  ig_engaged_employee_ids: string
  fb_engaged_employee_ids: string
  tiktok_engaged_employee_ids: string
  ig_links: string
  fb_links: string
  tiktok_links: string
  unmatched_names: string
  posted_at: string
  auto_filled_at: string | null
  auto_filled_count: number | null
  verified_at: string | null
  updated_at: string | null
}

/** JSON.parse yang tidak pernah melempar — data lokal bisa saja diedit tangan. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

function nullishToUndefined(v: string | null): string | undefined {
  return v === null || v === '' ? undefined : v
}

/** Hanya simpan string non-kosong; kosong → undefined (bukan ""). */
export function cleanText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}

export function employeeFromRow(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    nip: row.nip,
    bidang: nullishToUndefined(row.bidang),
    igUsername: nullishToUndefined(row.ig_username),
    igUsername2: nullishToUndefined(row.ig_username2),
    fbName: nullishToUndefined(row.fb_name),
    fbName2: nullishToUndefined(row.fb_name2),
    tiktokName: nullishToUndefined(row.tiktok_name),
    tiktokName2: nullishToUndefined(row.tiktok_name2),
    aliases: parseJson<string[]>(row.aliases, []),
    createdAt: nullishToUndefined(row.created_at),
    updatedAt: nullishToUndefined(row.updated_at),
  }
}

export function employeeToRow(e: Employee, now: string): EmployeeRow {
  return {
    id: e.id,
    name: e.name,
    nip: e.nip ?? '',
    bidang: cleanText(e.bidang) ?? null,
    ig_username: cleanText(e.igUsername) ?? null,
    ig_username2: cleanText(e.igUsername2) ?? null,
    fb_name: cleanText(e.fbName) ?? null,
    fb_name2: cleanText(e.fbName2) ?? null,
    tiktok_name: cleanText(e.tiktokName) ?? null,
    tiktok_name2: cleanText(e.tiktokName2) ?? null,
    aliases: JSON.stringify(Array.isArray(e.aliases) ? e.aliases.filter((a) => cleanText(a)) : []),
    created_at: cleanText(e.createdAt as string) ?? now,
    updated_at: now,
  }
}

export function dailyFromRow(row: DailyRow): DailyEngagement {
  return {
    id: row.date,
    date: row.date,
    igRawText: nullishToUndefined(row.ig_raw_text),
    fbRawText: nullishToUndefined(row.fb_raw_text),
    tiktokRawText: nullishToUndefined(row.tiktok_raw_text),
    igEngagedEmployeeIds: parseJson<string[]>(row.ig_engaged_employee_ids, []),
    fbEngagedEmployeeIds: parseJson<string[]>(row.fb_engaged_employee_ids, []),
    tiktokEngagedEmployeeIds: parseJson<string[]>(row.tiktok_engaged_employee_ids, []),
    igLinks: parseJson<string[]>(row.ig_links, []),
    fbLinks: parseJson<string[]>(row.fb_links, []),
    tiktokLinks: parseJson<string[]>(row.tiktok_links, []),
    unmatchedNames: parseJson<UnmatchedName[]>(row.unmatched_names, []),
    postedAt: parseJson<string[]>(row.posted_at, []),
    autoFilledAt: row.auto_filled_at ?? undefined,
    autoFilledCount: row.auto_filled_count ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  }
}

/**
 * Patch harian → baris. HANYA field yang ada di patch yang di-set, supaya
 * merge parsial (mis. kiriman scraper hanya menambah raw TikTok) tidak
 * menghapus kolom lain.
 */
export function dailyPatchToColumns(
  patch: Partial<DailyEngagement>,
  now: string
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = { updated_at: now }
  const text: Array<[keyof DailyEngagement, string]> = [
    ['igRawText', 'ig_raw_text'],
    ['fbRawText', 'fb_raw_text'],
    ['tiktokRawText', 'tiktok_raw_text'],
    ['autoFilledAt', 'auto_filled_at'],
    ['verifiedAt', 'verified_at'],
  ]
  for (const [key, col] of text) {
    if (key in patch) out[col] = (patch[key] as string | undefined) ?? null
  }
  const lists: Array<[keyof DailyEngagement, string]> = [
    ['igEngagedEmployeeIds', 'ig_engaged_employee_ids'],
    ['fbEngagedEmployeeIds', 'fb_engaged_employee_ids'],
    ['tiktokEngagedEmployeeIds', 'tiktok_engaged_employee_ids'],
    ['igLinks', 'ig_links'],
    ['fbLinks', 'fb_links'],
    ['tiktokLinks', 'tiktok_links'],
    ['unmatchedNames', 'unmatched_names'],
    ['postedAt', 'posted_at'],
  ]
  for (const [key, col] of lists) {
    if (key in patch) out[col] = JSON.stringify(patch[key] ?? [])
  }
  if ('autoFilledCount' in patch) {
    const n = patch.autoFilledCount
    out.auto_filled_count = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null
  }
  return out
}
