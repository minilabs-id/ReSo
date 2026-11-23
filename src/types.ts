/**
 * Satu definisi tipe domain — sumber kebenaran ada di `src/shared/types.ts`
 * (dipakai main process, renderer, dan scraper). File ini tersisa sebagai
 * shim kompatibilitas agar import lama `../types` tidak perlu diubah.
 */
export type {
  UnmatchedName,
  Employee,
  DailyEngagement,
} from './shared/types';
