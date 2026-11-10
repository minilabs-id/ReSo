/**
 * Skema pengaturan ReSo Native — sumber tunggal untuk default, validasi, dan
 * sanitasi nilai yang masuk lewat IPC.
 *
 * PRINSIP: TIDAK ADA data sensitif di sini. idToken/refresh token/session
 * TIDAK PERNAH ditulis ke disk (lihat electron/ipc/contracts.ts — sesi hanya
 * hidup di memori main process). Store ini murni preferensi operator.
 */

export const STORE_KEYS = [
  'tiktokTemplateUrl',
  'instagramTemplateUrl',
  'maxScrollRounds',
  'scrollDelayMs',
  'captureTimeoutMs',
  'launchAtLogin',
  'minimizeToTray',
  'autoSendToReso',
] as const

export type StoreKey = (typeof STORE_KEYS)[number]

export interface ResoSettings {
  /** URL template feed TikTok yang sudah divalidasi operator ("" = belum diisi). */
  tiktokTemplateUrl: string
  /** URL template postingan Instagram ("" = belum diisi). */
  instagramTemplateUrl: string
  /** Jumlah putaran auto-scroll komentar. */
  maxScrollRounds: number
  /** Jeda antar putaran scroll (ms). */
  scrollDelayMs: number
  /** Batas waktu satu proses scraping (ms). */
  captureTimeoutMs: number
  /** Jalankan otomatis saat login Windows. */
  launchAtLogin: boolean
  /** Tutup jendela → sembunyikan ke tray, bukan keluar. */
  minimizeToTray: boolean
  /** Kirim hasil scraping ke ReSo otomatis (idempotent, ada antrian). */
  autoSendToReso: boolean
}

export const SETTINGS_DEFAULTS: ResoSettings = {
  tiktokTemplateUrl: '',
  instagramTemplateUrl: '',
  maxScrollRounds: 15,
  scrollDelayMs: 1200,
  captureTimeoutMs: 120_000,
  launchAtLogin: false,
  minimizeToTray: true,
  autoSendToReso: true,
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

function sanitizeBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Normalisasi satu entri pengaturan (kunci tak dikenal diabaikan).
 * Mengembalikan `null` bila kunci tidak valid.
 */
export function sanitizeSetting(key: string, value: unknown): ResoSettings[StoreKey] | null {
  switch (key) {
    case 'tiktokTemplateUrl':
      return sanitizeUrl(value, SETTINGS_DEFAULTS.tiktokTemplateUrl)
    case 'instagramTemplateUrl':
      return sanitizeUrl(value, SETTINGS_DEFAULTS.instagramTemplateUrl)
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
    case 'launchAtLogin':
      return sanitizeBool(value, SETTINGS_DEFAULTS.launchAtLogin)
    case 'minimizeToTray':
      return sanitizeBool(value, SETTINGS_DEFAULTS.minimizeToTray)
    case 'autoSendToReso':
      return sanitizeBool(value, SETTINGS_DEFAULTS.autoSendToReso)
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
