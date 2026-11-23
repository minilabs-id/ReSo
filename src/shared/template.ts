/**
 * Validasi/sanitasi template API komentar + opsi engine.
 *
 * PORT 1:1 dari `tmp-shared.js` (baris 872–1034 template, 1036–1128 options).
 */
import type { EngineOptions, Platform } from './types'
import { isHostAllowed } from './platform'

/** TTL template TikTok (menit → ms). */
export const TEMPLATE_TTL_MS = 45 * 60 * 1000

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
      return isHostAllowed(new URL(u).hostname, 'tiktok.com')
    } catch {
      return false
    }
  }
  const isIgHost = (u: string): boolean => {
    try {
      return isHostAllowed(new URL(u).hostname, 'instagram.com')
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
