/**
 * Tipe bersama ReSo Native (main + renderer).
 *
 * Ini port TypeScript dari `tmp-shared.js` (logika ekstensi Chrome lama) —
 * lihat src/shared/README.md untuk peta port.
 */

export type Platform = 'facebook' | 'tiktok' | 'instagram'

/** Status run — mencerminkan lifecycle engine lama (background.js). */
export type RunStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error'

export type StopReason =
  | 'complete'
  | 'idle'
  | 'stopped'
  | 'timeout'
  | 'incomplete'
  | 'error'
  | 'rate_limit'
  | 'blocked'
  | 'checkpoint'
  | 'no_template'
  | 'no_video'
  | 'no_login'
  | 'no_media'
  | 'live'
  | 'synthetic_failed'
  | string

export interface NameState {
  status: RunStatus
  names: string[]
  count: number
  message: string
  updatedAt: number
  stopReason: StopReason | null
  includeReplies: boolean
  hasTemplate: boolean
  runId: string | null
  /** Hint post/video (ditampilkan sebagai "Target:"). */
  postHint: string
  videoHint: string
}

export interface FbFeedbackCandidate {
  /** Kandidat id (urut prioritas). */
  ids: string[]
}

export interface PlatformGroup {
  platform: Platform
  names: string[]
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
