/**
 * State run + patch-nya + Run ID.
 *
 * PORT 1:1 dari `tmp-shared.js` (DEFAULT_STATE_*, applyStatePatch, newRunId).
 */
import { mergeNames } from './normalize'
import type { NameState, Platform, RunStatus } from './types'

/** Batas keras jumlah nama per run (cegah state meledak). */
export const MAX_NAMES = 5000

const DEFAULT_STATE_FB: NameState = {
  status: 'idle',
  names: [],
  count: 0,
  message: 'Buka 1 postingan Facebook, lalu klik Ambil nama.',
  updatedAt: 0,
  stopReason: null,
  postHint: '',
  videoHint: '',
  includeReplies: true,
  runId: null,
}

const DEFAULT_STATE_TT: NameState = {
  status: 'idle',
  names: [],
  count: 0,
  message: 'Buka video TikTok, buka panel komentar, lalu klik Ambil nama.',
  updatedAt: 0,
  stopReason: null,
  postHint: '',
  videoHint: '',
  includeReplies: false,
  runId: null,
}

const DEFAULT_STATE_IG: NameState = {
  status: 'idle',
  names: [],
  count: 0,
  message: 'Buka 1 post/reel Instagram, pastikan sudah login, lalu klik Ambil nama.',
  updatedAt: 0,
  stopReason: null,
  postHint: '',
  videoHint: '',
  includeReplies: false,
  runId: null,
}

export function defaultStateFor(platform: Platform): NameState {
  if (platform === 'tiktok') return { ...DEFAULT_STATE_TT }
  if (platform === 'instagram') return { ...DEFAULT_STATE_IG }
  return { ...DEFAULT_STATE_FB }
}

export const DEFAULT_STATES: Record<Platform, NameState> = {
  facebook: DEFAULT_STATE_FB,
  tiktok: DEFAULT_STATE_TT,
  instagram: DEFAULT_STATE_IG,
}

/** Patch state: default → prev → patch, lalu dedupe nama + hitung ulang count. */
export function applyStatePatch(
  prev: Partial<NameState> | null | undefined,
  patch: Partial<NameState> | null | undefined,
  platform: Platform
): NameState {
  const def = defaultStateFor(platform)
  const next: NameState = { ...def, ...(prev ?? {}), ...(patch ?? {}), updatedAt: Date.now() }
  if (Array.isArray(next.names)) {
    next.names = mergeNames([], next.names, platform).slice(0, MAX_NAMES)
    next.count = next.names.length
  }
  return next
}

export function newRunId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/** Status valid yang boleh datang dari engine (whitelist). */
export const RUN_STATUSES: readonly RunStatus[] = ['idle', 'running', 'done', 'stopped', 'error']

export function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (RUN_STATUSES as readonly string[]).includes(v)
}
