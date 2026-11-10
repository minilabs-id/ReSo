/**
 * Skema state scraping di disk — sanitasi + default.
 * Dipisah dari state-store supaya bisa diuji tanpa Electron (`app` belum ready).
 */
import {
  DEFAULT_STATES,
  applyStatePatch,
  isRunStatus,
} from '../../src/shared/state'
import type { NameState, Platform, StopReason } from '../../src/shared/types'

export function defaultStateFor(platform: Platform): NameState {
  return { ...DEFAULT_STATES[platform], names: [] }
}

/** Batas jumlah nama yang boleh masuk dari file (jaga memori). */
const MAX_NAMES = 5000
const MAX_MESSAGE = 500

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.slice(0, MAX_MESSAGE) : fallback
}

/** Sanitasi state dari disk/IPC → bentuk NameState yang pasti aman. */
export function sanitizeState(v: unknown, platform: Platform): NameState {
  const def = defaultStateFor(platform)
  if (typeof v !== 'object' || v === null) return def
  const o = v as Record<string, unknown>

  const names = Array.isArray(o['names'])
    ? o['names'].filter((x): x is string => typeof x === 'string').slice(0, MAX_NAMES)
    : []

  const status = isRunStatus(o['status']) ? o['status'] : 'idle'
  const stopReason = typeof o['stopReason'] === 'string' ? (o['stopReason'] as StopReason) : null

  // applyStatePatch menormalkan nama (dedupe) + menghitung ulang count.
  return applyStatePatch(
    def,
    {
      status,
      names,
      stopReason,
      message: str(o['message'], def.message),
      postHint: str(o['postHint']),
      videoHint: str(o['videoHint']),
      includeReplies: typeof o['includeReplies'] === 'boolean' ? o['includeReplies'] : def.includeReplies,
      hasTemplate: typeof o['hasTemplate'] === 'boolean' ? o['hasTemplate'] : def.hasTemplate,
      runId: typeof o['runId'] === 'string' ? o['runId'].slice(0, 80) : null,
    },
    platform
  )
}
