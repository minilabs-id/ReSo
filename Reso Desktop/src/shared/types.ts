/**
 * Tipe bersama ReSo Native (main + renderer).
 *
 * Ini port TypeScript dari `tmp-shared.js` (logika ekstensi Chrome lama) —
 * lihat src/shared/README.md untuk peta port.
 */

export type Platform = 'facebook' | 'tiktok' | 'instagram'

/** Status run — mencerminkan lifecycle engine lama (background.js). */
export type RunStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error'

export const STOP_REASONS = [
  'complete',
  'idle',
  'stopped',
  'timeout',
  'incomplete',
  'error',
  'rate_limit',
  'blocked',
  'checkpoint',
  'no_template',
  'no_video',
  'no_login',
  'no_media',
  'live',
  'synthetic_failed',
] as const

export type StopReason = (typeof STOP_REASONS)[number] | string

export function isStopReason(v: unknown): v is StopReason {
  return typeof v === 'string' && (STOP_REASONS as readonly string[]).includes(v)
}

export interface NameState {
  status: RunStatus
  names: string[]
  count: number
  message: string
  updatedAt: number
  stopReason: StopReason | null
  includeReplies: boolean
  runId: string | null
  /** Hint post/video (ditampilkan sebagai "Target:"). */
  postHint: string
  videoHint: string
}

export interface TemplateMeta {
  capturedAt?: number
  awemeId?: string | null
  mediaId?: string | null
}

export interface EngineOptions {
  maxMs: number
  includeReplies: boolean
  runId: string | null
  awemeId?: string | null
  mediaId?: string | null
  templateUrl?: string | null
}

// ===================== Domain rekap (database lokal) =====================
// Pindahan dari src/types.ts (versi Firestore) ke sini supaya main process &
// renderer memakai SATU definisi. Timestamp Firestore diganti ISO string
// (SQLite menyimpan TEXT) — lihat electron/db/schema.ts.

/** Nama di rekap yang belum cocok dengan pegawai mana pun (antrian review). */
export interface UnmatchedName {
  name: string
  platform: 'ig' | 'fb' | 'tiktok'
}

export interface Employee {
  id: string
  name: string
  nip: string
  bidang?: string
  igUsername?: string
  igUsername2?: string
  fbName?: string
  fbName2?: string
  tiktokName?: string
  tiktokName2?: string
  /** Nama panggilan/varian hasil pemetaan admin (antrian belum terpetakan). */
  aliases?: string[]
  createdAt?: string | null
  updatedAt?: string | null
}

export interface DailyEngagement {
  /** YYYY-MM-DD (primary key di SQLite). */
  id: string
  date: string
  igRawText?: string | null
  fbRawText?: string | null
  tiktokRawText?: string | null
  igEngagedEmployeeIds?: string[]
  fbEngagedEmployeeIds?: string[]
  tiktokEngagedEmployeeIds?: string[]
  updatedAt?: string | null
  /** Diisi otomatis oleh scraper native (pengganti penanda ekstensi). */
  autoFilledAt?: string | null
  autoFilledCount?: number | null
  /** Operator sudah memeriksa rekap otomatis. */
  verifiedAt?: string | null
  /** Nama yang tidak cocok dengan pegawai mana pun (antrian belum terpetakan). */
  unmatchedNames?: UnmatchedName[]
  /** Waktu posting post yang direkap otomatis (ISO lokal "YYYY-MM-DDTHH:MM"). */
  postedAt?: string[]
}
