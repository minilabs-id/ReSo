/** Local calendar date as YYYY-MM-DD (WIB). */
export function getLocalISODate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** Parse YYYY-MM-DD as WIB midnight (avoids UTC shift). */
export function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return new Date(NaN);
  const dt = new Date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+07:00`);
  if (isNaN(dt.getTime())) return new Date(NaN);
  if (dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) !== iso) return new Date(NaN);
  return dt;
}

/** Previous calendar day as YYYY-MM-DD (WIB). */
export function addLocalDays(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const newUtc = utc + deltaDays * 86400000;
  return new Date(newUtc).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** Bagian kalender WIB (Asia/Jakarta, UTC+7, tanpa DST sejak 1988). */
export interface WibDateParts {
  /** Tahun kalender, mis. 2026. */
  year: number;
  /** Bulan 1–12. */
  month: number;
  /** Tanggal 1–31. */
  day: number;
  /** Nama hari bahasa Indonesia, mis. 'Kamis', 'Jumat'. */
  weekday: string;
}

const WIB_PARTS_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'long',
});

/**
 * Ambil tanggal/kalendar WIB dari sebuah Date — bukan dari UTC ataupun zona
 * lokal mesin. Pakai formatToParts (bukan toLocaleDateString('en-CA')) supaya
 * bentuk keluaran tidak bergantung versi ICU. Contoh: 2026-01-01T17:30:00Z
 * sudah masuk 2026-01-02 (Jumat) di WIB.
 */
export function getWibDateParts(date: Date): WibDateParts {
  const parts = WIB_PARTS_FORMATTER.formatToParts(date);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    weekday: value('weekday'),
  };
}

/**
 * Geser tanggal kalender WIB 'YYYY-MM-DD' sebanyak delta hari.
 * Aman di sekitar tengah malam: acuan UTC 00:00 = 07:00 WIB, jauh dari batas
 * hari WIB, jadi tidak ada off-by-one saat konversi. Asia/Jakarta tidak punya
 * DST, sehingga penambahan 86400000 ms selalu tepat satu hari kalender WIB.
 * Input bukan tanggal kalender nyata (atau delta bukan bilangan bulat) → ''.
 */
export function addWibDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (!Number.isInteger(delta) || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const base = new Date(
    `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`
  );
  if (isNaN(base.getTime())) return '';
  // Tolak tanggal kalender palsu, mis. 2026-02-30 (Date.UTC akan menggulung).
  const norm = getWibDateParts(base);
  if (norm.year !== y || norm.month !== m || norm.day !== d) return '';
  const target = new Date(base.getTime() + delta * 86400000);
  if (isNaN(target.getTime())) return '';
  const p = getWibDateParts(target);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
