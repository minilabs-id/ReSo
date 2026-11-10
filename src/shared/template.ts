/**
 * Validasi/sanitasi template API komentar + opsi engine.
 *
 * PORT 1:1 dari `tmp-shared.js` (baris 872–1034 template, 1036–1128 options).
 */
import type { EngineOptions, Platform, TemplateMeta } from './types'

/** TTL template TikTok (menit → ms). */
export const TEMPLATE_TTL_MS = 45 * 60 * 1000
/** TTL template Instagram — lebih pendek (lebih rapuh). */
export const IG_TEMPLATE_TTL_MS = 30 * 60 * 1000

/** Buang parameter signing berumur pendek sebelum template disimpan. */
export function sanitizeTikTokTemplateUrl(url: unknown): string | null {
  if (!url || typeof url !== 'string') return null
  try {
    const u = new URL(url)
    for (const key of ['msToken', 'X-Bogus', 'X-Gnarly', 'X-Dynosaur', '_signature', 'signature']) {
      u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return null
  }
}

export function isTikTokTemplateValid(
  url: unknown,
  meta: TemplateMeta | null | undefined,
  requiredAwemeId: string | null = null
): boolean {
  if (!url || typeof url !== 'string') return false
  try {
    if (!new URL(url).hostname.endsWith('tiktok.com')) return false
  } catch {
    return false
  }
  if (!url.toLowerCase().includes('/api/comment/list')) return false
  if (url.toLowerCase().includes('/api/comment/list/reply')) return false
  const capturedAt = meta?.capturedAt
  if (!capturedAt || typeof capturedAt !== 'number') return false
  if (Date.now() - capturedAt > TEMPLATE_TTL_MS) return false
  if (requiredAwemeId && meta?.awemeId && String(meta.awemeId) !== String(requiredAwemeId)) return false
  return true
}

/** Buang parameter pagination/app-noise sebelum template Instagram disimpan. */
export function sanitizeInstagramTemplateUrl(url: unknown): string | null {
  if (!url || typeof url !== 'string') return null
  try {
    const u = new URL(url)
    if (!u.href.includes('instagram.com/api/v1/media/')) return null
    if (!u.href.includes('/comments/')) return null
    if (u.href.includes('/inline_child_comments')) return null
    for (const key of [
      'max_id',
      'min_id',
      'index',
      'a1',
      '__user',
      '__a',
      '__req',
      '__dyn',
      '__csr',
      '__tt',
      '__bfa',
      '__aut',
      '__spin_r',
      '__spin_b',
      '__spin_t',
    ]) {
      u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return null
  }
}

export function isInstagramTemplateValid(
  url: unknown,
  meta: TemplateMeta | null | undefined,
  requiredMediaId: string | null = null
): boolean {
  if (!url || typeof url !== 'string') return false
  try {
    if (!new URL(url).hostname.endsWith('instagram.com')) return false
  } catch {
    return false
  }
  if (!url.includes('/api/v1/media/')) return false
  if (!url.includes('/comments/')) return false
  if (url.includes('/inline_child_comments')) return false
  const capturedAt = meta?.capturedAt
  if (!capturedAt || typeof capturedAt !== 'number') return false
  if (Date.now() - capturedAt > IG_TEMPLATE_TTL_MS) return false
  if (requiredMediaId && meta?.mediaId && String(meta.mediaId) !== String(requiredMediaId)) return false
  return true
}

// ===================== Engine options =====================

/**
 * Sanitasi opsi START / SET_TEMPLATE sebelum dikirim ke engine world.
 * Murni (tanpa chrome.*) sehingga bisa diuji unit.
 */
export function sanitizeEngineOptions(
  cmd: string,
  options: unknown,
  platform: Platform
): Partial<EngineOptions> {
  const raw = options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
  const isTikTokHost = (u: string): boolean => {
    try {
      return new URL(u).hostname.endsWith('tiktok.com')
    } catch {
      return false
    }
  }
  const isIgHost = (u: string): boolean => {
    try {
      return new URL(u).hostname.endsWith('instagram.com')
    } catch {
      return false
    }
  }

  if (cmd === 'SET_TEMPLATE') {
    const url = typeof raw['templateUrl'] === 'string' ? raw['templateUrl'].slice(0, 4000) : null
    if (platform === 'tiktok') {
      return {
        templateUrl:
          url &&
          isTikTokHost(url) &&
          url.toLowerCase().includes('/api/comment/list') &&
          !url.toLowerCase().includes('/list/reply')
            ? url
            : null,
      }
    }
    if (platform === 'instagram') {
      return {
        templateUrl:
          url &&
          isIgHost(url) &&
          url.includes('/api/v1/media/') &&
          url.includes('/comments/') &&
          !url.includes('/inline_child_comments')
            ? url
            : null,
      }
    }
    return { templateUrl: null }
  }

  if (cmd !== 'START') return {}

  const maxMs = Number(raw['maxMs'])
  const out: Partial<EngineOptions> = {
    maxMs: Number.isFinite(maxMs)
      ? Math.min(180_000, Math.max(8_000, maxMs))
      : platform === 'tiktok'
        ? 120_000
        : 150_000,
    includeReplies:
      platform === 'tiktok' || platform === 'instagram'
        ? raw['includeReplies'] === true
        : raw['includeReplies'] !== false,
    runId:
      typeof raw['runId'] === 'string' && raw['runId'].length <= 80 ? raw['runId'] : null,
  }

  if (platform === 'tiktok') {
    const aweme =
      raw['awemeId'] != null ? String(raw['awemeId']).replace(/\D/g, '').slice(0, 32) : ''
    out.awemeId = aweme || null
    const url = typeof raw['templateUrl'] === 'string' ? raw['templateUrl'].slice(0, 4000) : null
    out.templateUrl =
      url &&
      isTikTokHost(url) &&
      url.toLowerCase().includes('/api/comment/list') &&
      !url.toLowerCase().includes('/list/reply')
        ? url
        : null
  }
  if (platform === 'instagram') {
    const media =
      raw['mediaId'] != null ? String(raw['mediaId']).replace(/\D/g, '').slice(0, 32) : ''
    out.mediaId = media || null
    const url = typeof raw['templateUrl'] === 'string' ? raw['templateUrl'].slice(0, 4000) : null
    out.templateUrl =
      url &&
      isIgHost(url) &&
      url.includes('/api/v1/media/') &&
      url.includes('/comments/') &&
      !url.includes('/inline_child_comments')
        ? url
        : null
  }
  return out
}
