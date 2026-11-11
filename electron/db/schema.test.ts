/**
 * Uji lapisan skema DB lokal (PURE — tanpa better-sqlite3/Electron).
 * Jalankan: npx tsx electron/db/schema.test.ts
 *
 * Fokus: kolom yang ditulis patch parsial TIDAK menghapus kolom lain, dan
 * konversi baris ↔ domain (JSON list, null) benar. Ini yang menjaga data
 * rekap operator tidak rusak saat scraper hanya menambah raw text.
 */
import {
  cleanText,
  dailyFromRow,
  dailyPatchToColumns,
  employeeFromRow,
  employeeToRow,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  type DailyRow,
  type EmployeeRow,
} from './schema'

let n = 0
function eq(actual: unknown, expected: unknown, label: string): void {
  n++
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`✗ ${label}: dapat ${a}, harusnya ${b}`)
}

// --- DDL dasar ---
eq(SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS employees'), true, 'DDL employees ada')
eq(SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS daily_engagement'), true, 'DDL daily ada')
eq(SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS settings'), true, 'DDL settings ada')
// Tanpa login → tidak boleh ada tabel admin/user.
eq(/CREATE TABLE[^;]*(admins|users)/i.test(SCHEMA_SQL), false, 'tanpa tabel admins/users')
eq(SCHEMA_VERSION > 0, true, 'schema version positif')

// --- cleanText ---
// Kontrak: kolom TEXT opsional memakai `null` = kosong (SQL), `undefined`
// dicadangkan sebagai "tidak dikirim" pada patch parsial — lihat
// dailyPatchToColumns. Karena itu kosong → null, bukan undefined.
eq(cleanText(undefined), null, 'undefined → null')
eq(cleanText(null), null, 'null → null')
eq(cleanText('  a  '), 'a', 'string di-trim')
eq(cleanText(''), null, 'string kosong → null')
eq(cleanText('   '), null, 'spasi saja → null')

// --- patch parsial: hanya kolom yang dikirim ---
const p1 = dailyPatchToColumns({ tiktokRawText: 'Budi\nAni' }, 'now')
eq(Object.keys(p1).sort(), ['tiktok_raw_text', 'updated_at'], 'patch 1 kolom saja')
eq(p1['ig_raw_text'], undefined, 'kolom lain TIDAK disentuh')

const p2 = dailyPatchToColumns({ postedAt: ['2026-11-11T09:00'] }, 'now')
eq(p2['posted_at'], '["2026-11-11T09:00"]', 'list → JSON string')

const p3 = dailyPatchToColumns({ fbLinks: null }, 'now')
eq(p3['fb_links'], '[]', 'list null → [] (bukan null)')

const p4 = dailyPatchToColumns({ autoFilledCount: 12.7 }, 'now')
eq(p4['auto_filled_count'], 12, 'count dibulatkan')
const p5 = dailyPatchToColumns({ autoFilledCount: Number.NaN }, 'now')
eq(p5['auto_filled_count'], null, 'count NaN → null')

const p6 = dailyPatchToColumns({ igRawText: 'x' }, 'T0')
eq(p6['updated_at'], 'T0', 'updated_at selalu di-set')

// --- baris → domain ---
const empRow: EmployeeRow = {
  id: 'e1',
  name: 'Budi',
  nip: '',
  bidang: null,
  ig_username: 'budi',
  ig_username2: null,
  fb_name: null,
  fb_name2: null,
  tiktok_name: null,
  tiktok_name2: null,
  aliases: '["Bud"]',
  created_at: null,
  updated_at: null,
}
const emp = employeeFromRow(empRow)
eq(emp.id, 'e1', 'employee id')
eq(emp.aliases, ['Bud'], 'aliases diparse')
eq(emp.bidang, undefined, 'bidang null → undefined')

// aliases rusak di DB tidak boleh melempar.
const empBad = employeeFromRow({ ...empRow, aliases: 'bukan-json' })
eq(Array.isArray(empBad.aliases), true, 'aliases rusak tetap array')

const dailyRow: DailyRow = {
  date: '2026-11-11',
  ig_raw_text: 'ani',
  fb_raw_text: null,
  tiktok_raw_text: 'budi',
  ig_engaged_employee_ids: '["e9"]',
  fb_engaged_employee_ids: '[]',
  tiktok_engaged_employee_ids: '["e1"]',
  ig_links: '[]',
  fb_links: '[]',
  tiktok_links: '["https://tiktok.com/@a/video/1"]',
  unmatched_names: '[{"name":"Orang Lain","platform":"tiktok"}]',
  posted_at: '["2026-11-11T09:00"]',
  auto_filled_at: '2026-11-11T09:05:00.000Z',
  auto_filled_count: 2,
  verified_at: null,
  updated_at: null,
}
const daily = dailyFromRow(dailyRow)
eq(daily.id, '2026-11-11', 'daily id = date')
eq(daily.tiktokEngagedEmployeeIds, ['e1'], 'id pegawai diparse')
eq(daily.unmatchedNames, [{ name: 'Orang Lain', platform: 'tiktok' }], 'unmatchedNames diparse')
eq(daily.verifiedAt, null, 'verifiedAt null dipertahankan')

// --- domain → baris (pegawai import) ---
const row = employeeToRow({ id: 'e2', name: 'Ani', nip: '123', aliases: ['An'] }, 'T1')
eq(row['aliases'], '["An"]', 'aliases disimpan sebagai JSON')
eq(row['nip'], '123', 'nip tersimpan')
eq(employeeToRow({ id: 'e3', name: 'X', nip: '' }, 'T1')['aliases'], '[]', 'aliases default []')

console.log(`db-schema: ${n} checks OK`)
