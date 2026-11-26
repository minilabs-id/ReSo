/**
 * Skema pengaturan ReSo Native — sumber tunggal untuk default, validasi, dan
 * sanitasi nilai yang masuk lewat IPC.
 *
 * PRINSIP: TIDAK ADA data sensitif di sini. idToken/refresh token/session
 * TIDAK PERNAH ditulis ke disk (lihat electron/ipc/contracts.ts — sesi hanya
 * hidup di memori main process). Store ini murni preferensi operator.
 */
import { isAllowedScrapeUrl } from '../../src/shared/platform'
import type { Platform } from '../../src/shared/types'

export const STORE_KEYS = [
  'homeUrlFacebook',
  'homeUrlInstagram',
  'homeUrlTiktok',
  'tiktokTemplateUrl',
  /** Waktu (epoch ms) template TikTok disimpan — 0 = warisan tanpa metadata. */
  'tiktokTemplateCapturedAt',
  'maxScrollRounds',
  'scrollDelayMs',
  'captureTimeoutMs',
] as const

export type StoreKey = (typeof STORE_KEYS)[number]

export interface ResoSettings {
  /** Halaman awal browser internal per platform (profil/postingan operator). */
  homeUrlFacebook: string
  homeUrlInstagram: string
  homeUrlTiktok: string
  /** URL template feed TikTok yang sudah divalidasi operator ("" = belum diisi). */
  tiktokTemplateUrl: string
  /** Kapan template disimpan (epoch ms), dipakai validasi TTL 45 menit. */
  tiktokTemplateCapturedAt: number
  /** Jumlah putaran auto-scroll komentar. */
  maxScrollRounds: number
  /** Jeda antar putaran scroll (ms). */
  scrollDelayMs: number
  /** Batas waktu satu proses scraping (ms). */
  captureTimeoutMs: number
}

export const SETTINGS_DEFAULTS: ResoSettings = {
  homeUrlFacebook: '',
  homeUrlInstagram: '',
  homeUrlTiktok: '',
  tiktokTemplateUrl: '',
  tiktokTemplateCapturedAt: 0,
  maxScrollRounds: 15,
  scrollDelayMs: 1200,
  captureTimeoutMs: 120_000,
}

/** Batas keras (clamp) — mencegah operator/typo mematikan mesin scraper. */
const LIMITS = {
  maxScrollRounds: { min: 1, max: 200 },
  scrollDelayMs: { min: 200, max: 10_000 },
  captureTimeoutMs: { min: 5_000, max: 900_000 },
  urlLength: 2048,
} as const

function clampNumber(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(v)))
}

function sanitizeUrl(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const trimmed = v.trim()
  if (!trimmed) return ''
  if (trimmed.length > LIMITS.urlLength) return fallback
  if (!/^https?:\/\//i.test(trimmed)) return fallback
  return trimmed
}

/** Halaman awal hanya boleh berada di domain platform yang bersangkutan. */
function sanitizeHomeUrl(value: unknown, platform: Platform): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > LIMITS.urlLength) return ''
  return isAllowedScrapeUrl(trimmed, platform) ? trimmed : ''
}

/**
 * Normalisasi satu entri pengaturan (kunci tak dikenal diabaikan).
 * Mengembalikan `null` bila kunci tidak valid.
 */
export function sanitizeSetting(key: string, value: unknown): ResoSettings[StoreKey] | null {
  switch (key) {
    case 'homeUrlFacebook':
      return sanitizeHomeUrl(value, 'facebook')
    case 'homeUrlInstagram':
      return sanitizeHomeUrl(value, 'instagram')
    case 'homeUrlTiktok':
      return sanitizeHomeUrl(value, 'tiktok')
    case 'tiktokTemplateUrl':
      return sanitizeUrl(value, SETTINGS_DEFAULTS.tiktokTemplateUrl)
    case 'tiktokTemplateCapturedAt':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.trunc(value)
        : 0
    case 'maxScrollRounds':
      return clampNumber(
        value,
        SETTINGS_DEFAULTS.maxScrollRounds,
        LIMITS.maxScrollRounds.min,
        LIMITS.maxScrollRounds.max
      )
    case 'scrollDelayMs':
      return clampNumber(
        value,
        SETTINGS_DEFAULTS.scrollDelayMs,
        LIMITS.scrollDelayMs.min,
        LIMITS.scrollDelayMs.max
      )
    case 'captureTimeoutMs':
      return clampNumber(
        value,
        SETTINGS_DEFAULTS.captureTimeoutMs,
        LIMITS.captureTimeoutMs.min,
        LIMITS.captureTimeoutMs.max
      )
    default:
      return null
  }
}

/** Patch dari renderer: hanya kunci dikenal, sudah disanitasi. */
export function sanitizeSettingsPatch(patch: unknown): Partial<ResoSettings> {
  if (typeof patch !== 'object' || patch === null) return {}
  const out: Partial<ResoSettings> = {}
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const clean = sanitizeSetting(key, raw)
    if (clean !== null) (out as Record<string, unknown>)[key] = clean
  }
  return out
}
