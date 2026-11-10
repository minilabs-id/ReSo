/**
 * Run state machine ReSo Native — pengganti lifecycle run di `background.js`
 * ekstensi lama, TANPA chrome.* dan TANPA I/O.
 *
 * Semua transisi murni (state masuk → state keluar) supaya bisa diuji tanpa
 * Electron. Pemanggil (RunController) yang menjalankan efek: menavigasi
 * WebContentsView, menyuntik engine, menyimpan ke store, dan mengirim hasil.
 */
import { mergeNames } from './normalize'
import { reasonToMessage } from './messages'
import { applyStatePatch, defaultStateFor, isRunStatus, MAX_NAMES } from './state'
import type { NameState, Platform, RunStatus, StopReason } from './types'

/** Pesan dari engine/UI yang menentukan transisi. */
export type RunEvent =
  | { type: 'START'; runId: string; includeReplies: boolean }
  | { type: 'PROGRESS'; runId: string; names: string[] }
  | { type: 'DONE'; runId: string; reason: StopReason; names?: string[] }
  | { type: 'STOP'; reason?: StopReason }
  | { type: 'FAIL'; runId?: string; message: string }
  | { type: 'RESET' }

export interface TransitionResult {
  state: NameState
  /** true bila state berubah (pemanggil boleh melewati tulis ulang bila false). */
  changed: boolean
}

function isActive(state: NameState): boolean {
  return state.status === 'running'
}

/**
 * Terapkan satu event ke state.
 * Aturan penting (parity dengan background.js lama):
 * - Pesan dari run lain DITOLAK saat run aktif (anti race dua tab).
 * - PROGRESS hanya menambah nama (dedupe), tidak pernah mengurangi.
 * - STOP selama running → `stopped`; DONE → status dari reason.
 */
export function reduce(
  platform: Platform,
  prev: NameState | null | undefined,
  event: RunEvent
): TransitionResult {
  const state = prev ?? defaultStateFor(platform)

  if (event.type === 'RESET') {
    return { state: defaultStateFor(platform), changed: true }
  }

  if (event.type === 'START') {
    if (isActive(state)) return { state, changed: false }
    const next = applyStatePatch(
      state,
      {
        status: 'running' as RunStatus,
        names: [],
        count: 0,
        stopReason: null,
        runId: event.runId,
        includeReplies: event.includeReplies,
        message: platform === 'tiktok' ? 'Mengambil komentar TikTok…' : 'Memproses…',
      },
      platform
    )
    return { state: next, changed: true }
  }

  if (event.type === 'PROGRESS') {
    if (event.runId !== state.runId) return { state, changed: false }
    const merged = mergeNames(state.names, event.names, platform).slice(0, MAX_NAMES)
    if (merged.length === state.names.length) return { state, changed: false }
    return {
      state: { ...state, names: merged, count: merged.length, updatedAt: Date.now() },
      changed: true,
    }
  }

  if (event.type === 'DONE') {
    if (event.runId !== state.runId) return { state, changed: false }
    const names = mergeNames(state.names, event.names ?? [], platform).slice(0, MAX_NAMES)
    const status: RunStatus =
      event.reason === 'stopped' ? 'stopped' : event.reason === 'error' ? 'error' : 'done'
    const next: NameState = {
      ...state,
      names,
      count: names.length,
      status,
      stopReason: event.reason,
      runId: null,
      updatedAt: Date.now(),
      message: reasonToMessage(event.reason, names.length, platform),
    }
    return { state: next, changed: true }
  }

  if (event.type === 'STOP') {
    if (!isActive(state)) return { state, changed: false }
    const reason: StopReason = event.reason ?? 'stopped'
    return {
      state: {
        ...state,
        status: 'stopped',
        stopReason: reason,
        runId: null,
        updatedAt: Date.now(),
        message: reasonToMessage(reason, state.count, platform),
      },
      changed: true,
    }
  }

  // FAIL
  if (event.runId && event.runId !== state.runId) return { state, changed: false }
  return {
    state: {
      ...state,
      status: 'error',
      stopReason: 'error',
      runId: null,
      updatedAt: Date.now(),
      message: reasonToMessage('error', state.count, platform, event.message),
    },
    changed: true,
  }
}

/** Guard untuk data yang datang dari renderer/engine (bentuk tak dipercaya). */
export function parseRunEvent(v: unknown): RunEvent | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const type = o['type']
  if (type === 'RESET') return { type: 'RESET' }
  if (type === 'START') {
    if (typeof o['runId'] !== 'string' || !o['runId']) return null
    return { type: 'START', runId: o['runId'], includeReplies: o['includeReplies'] === true }
  }
  if (type === 'PROGRESS') {
    if (typeof o['runId'] !== 'string') return null
    if (!Array.isArray(o['names'])) return null
    return {
      type: 'PROGRESS',
      runId: o['runId'],
      names: o['names'].filter((x): x is string => typeof x === 'string').slice(0, MAX_NAMES),
    }
  }
  if (type === 'DONE') {
    if (typeof o['runId'] !== 'string') return null
    const reason = typeof o['reason'] === 'string' ? o['reason'] : 'complete'
    const names = Array.isArray(o['names'])
      ? o['names'].filter((x): x is string => typeof x === 'string').slice(0, MAX_NAMES)
      : undefined
    return { type: 'DONE', runId: o['runId'], reason, names }
  }
  if (type === 'STOP') {
    const reason = typeof o['reason'] === 'string' ? o['reason'] : undefined
    return { type: 'STOP', reason }
  }
  if (type === 'FAIL') {
    const message = typeof o['message'] === 'string' ? o['message'].slice(0, 500) : 'error'
    const runId = typeof o['runId'] === 'string' ? o['runId'] : undefined
    return { type: 'FAIL', message, runId }
  }
  return null
}

export { isRunStatus }
