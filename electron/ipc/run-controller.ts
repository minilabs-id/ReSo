/**
 * RunController — pemilik tunggal state scraping di main process.
 *
 * Semua perubahan state lewat `src/shared/run-state.ts` (murni, teruji), lalu
 * dipersistensikan ke JSON (state-store) dan disiarkan ke renderer
 * (`scrapeStateChanged`). Renderer TIDAK menyimpan state sendiri, sehingga
 * dua jendela tidak pernah berbeda pandangan.
 */
import { BrowserWindow } from 'electron'
import { IPC } from '../ipc/contracts'
import { reduce, parseRunEvent, type RunEvent } from '../../src/shared/run-state'
import { defaultStateFor } from '../store/state-schema'
import { clearState, getAllStates, getState, setState } from '../store/state-store'
import { cancelRun, setMainWindow, startRun } from '../scrape/runner'
import type { NameState, Platform } from '../../src/shared/types'

/**
 * main.ts menyuplai jendela utama tempat WebContentsView scraper dipasang.
 * Dipanggil sekali saat jendela dibuat, dan dengan `null` saat ditutup.
 */
export function setScrapeMainWindow(win: BrowserWindow | null): void {
  setMainWindow(win)
}

function broadcast(platform: Platform, state: NameState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.scrapeStateChanged, { platform, state })
  }
}

export const runController = {
  get(platform: Platform): NameState {
    return getState(platform)
  },

  getAll(): Record<Platform, NameState> {
    return getAllStates()
  },

  /** Terapkan event (dari renderer atau runner) → persist → siarkan. */
  apply(platform: Platform, rawEvent: unknown): NameState {
    const event: RunEvent | null = parseRunEvent(rawEvent)
    if (!event) return getState(platform)

    // START: pastikan hanya satu run aktif per platform.
    if (event.type === 'START') {
      const current = getState(platform)
      if (current.status === 'running') {
        if (current.runId === event.runId) return current // duplikat → abaikan
        // runId baru menyusul: putus run lama, bersihkan state, lalu START baru.
        cancelRun(platform)
        runController.reset(platform)
      }
    }

    const prev = getState(platform)
    const { state, changed } = reduce(platform, prev, event)
    if (!changed) return prev

    setState(platform, state)
    broadcast(platform, state)

    // Efek nyata: START menyalakan engine, STOP memotong run yang berjalan.
    if (event.type === 'START') {
      startRun(platform, event.runId, event.includeReplies, (e) =>
        runController.apply(platform, e)
      )
    } else if (event.type === 'STOP') {
      cancelRun(platform)
    }

    return state
  },

  /** Buang hasil (nama) tapi pertahankan preferensi platform. */
  clearNames(platform: Platform): NameState {
    const state = clearState(platform)
    broadcast(platform, state)
    return state
  },

  /** Kembalikan ke state default total. */
  reset(platform: Platform): NameState {
    const state = defaultStateFor(platform)
    setState(platform, state)
    broadcast(platform, state)
    return state
  },
}
