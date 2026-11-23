/**
 * Tanggal WIB — regression checks (run: npx tsx src/lib/date.test.ts)
 *
 * Fokus: batas hari WIB (Asia/Jakarta, UTC+7, without DST) dan memastikan
 * helper utama (getLocalISODate/parseLocalISODate/getWibDateParts).
 */
import {
  getLocalISODate,
  parseLocalISODate,
  getWibDateParts,
} from './date';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let n = 0;
function ok(msg: string) {
  n += 1;
  console.log(`  ok ${n} — ${msg}`);
}

// ---- getWibDateParts: batas tengah malam WIB ----
{
  // 17:30 UTC = 00:30 WIB hari berikutnya → sudah Jumat, 2 Januari.
  const p = getWibDateParts(new Date('2026-01-01T17:30:00Z'));
  assert(JSON.stringify(p) === JSON.stringify({ year: 2026, month: 1, day: 2, weekday: 'Jumat' }), '17:30Z → 02/01 Jumat di WIB');
  // Tepat 17:00 UTC = 00:00 WIB → hari berikutnya juga.
  const p2 = getWibDateParts(new Date('2026-01-01T17:00:00Z'));
  assert(p2.day === 2 && p2.weekday === 'Jumat', '17:00Z = 00:00 WIB → masih 2 Januari');
  // 16:59 UTC = 23:59 WIB → masih Kamis, 1 Januari.
  const p3 = getWibDateParts(new Date('2026-01-01T16:59:00Z'));
  assert(p3.day === 1 && p3.weekday === 'Kamis', '16:59Z = 23:59 WIB → masih 1 Januari');
  // 00:00 UTC = 07:00 WIB → tanggal yang sama.
  const p4 = getWibDateParts(new Date('2026-01-01T00:00:00Z'));
  assert(p4.day === 1 && p4.weekday === 'Kamis', '00:00Z = 07:00 WIB → 1 Januari');
  ok('getWibDateParts: parts + weekday WIB di sekitar tengah malam');
}

// ---- getWibDateParts: tidak ada DST sepanjang tahun ----
{
  const p = getWibDateParts(new Date('2026-07-01T17:30:00Z'));
  assert(p.year === 2026 && p.month === 7 && p.day === 2 && p.weekday === 'Kamis', 'Juli tetap +7 (tanpa DST)');
  const p2 = getWibDateParts(new Date('2024-02-28T17:30:00Z'));
  assert(p2.month === 2 && p2.day === 29 && p2.weekday === 'Kamis', '29 Feb 2024 terbaca benar di WIB');
  ok('getWibDateParts: konsisten tanpa DST (Jan/Jul, leap year)');
}

// ---- REGRESI: helper utama ----
{
  assert(getLocalISODate(new Date('2026-01-01T17:30:00Z')) === '2026-01-02', 'getLocalISODate tetap WIB');
  assert(parseLocalISODate('2026-01-02').toISOString() === '2026-01-01T17:00:00.000Z', 'parseLocalISODate tetap WIB midnight');
  assert(isNaN(parseLocalISODate('2026-02-30').getTime()), 'parseLocalISODate tetap tolak tanggal palsu');
  ok('helper tanggal WIB utama tetap stabil');
}

console.log(`\ndate: ${n} checks OK`);
