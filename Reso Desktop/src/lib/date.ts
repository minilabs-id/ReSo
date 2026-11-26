/**
 * Formatter dipakai ulang — `toLocaleDateString` membuat Intl formatter baru
 * tiap panggil dan ternyata jadi hot spot saat profil CPU (≈18x lebih lambat).
 * Output `en-CA` sudah berbentuk YYYY-MM-DD.
 */
const ISO_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Local calendar date as YYYY-MM-DD (WIB). */
export function getLocalISODate(date: Date = new Date()): string {
  return ISO_FORMATTER.format(date);
}

/** Parse YYYY-MM-DD as WIB midnight (avoids UTC shift). */
export function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return new Date(NaN);
  const dt = new Date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+07:00`);
  if (isNaN(dt.getTime())) return new Date(NaN);
  if (ISO_FORMATTER.format(dt) !== iso) return new Date(NaN);
  return dt;
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
