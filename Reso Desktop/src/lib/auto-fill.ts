/**
 * Tanggal yang rekapnya diisi otomatis (autoFilledAt ada) tapi belum diverifikasi.
 * Dipakai tombol "Terima semua rekap otomatis" di tab Rekap Harian.
 */
export function collectUnverifiedAutoFilled(
  docs:
    | Record<string, { autoFilledAt?: unknown; verifiedAt?: unknown } | undefined>
    | null
    | undefined
): string[] {
  if (!docs) return [];
  return Object.entries(docs)
    .filter(([, d]) => !!d?.autoFilledAt && !d?.verifiedAt)
    .map(([date]) => date)
    .sort();
}
