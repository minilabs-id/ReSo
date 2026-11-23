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
import { getAllStates, getState, setState } from '../store/state-store'
import { cancelRun, setMainWindow, startRun } from '../scrape/runner'
import { handoffScrapeToRekap, type HandoffResult } from '../scrape/auto-handoff'
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

function broadcastHandoff(result: HandoffResult): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.scrapeHandoff, result)
  }
}

/** Satu tempat penulisan hasil → rekap, dipakai DONE/STOP/FAIL/supersede. */
function handoff(platform: Platform, names: string[]): void {
  if (!names.length) return
  const result = handoffScrapeToRekap(platform, names)
  if (result) broadcastHandoff(result)
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
        // runId baru menyusul: simpan dulu nama dari run lama supaya tidak
        // hilang, lalu reset. Pemutusan engine lama dilakukan runner.startRun()
        // yang menunggu `done`-nya sebelum menyentuh WebContentsView yang sama.
        handoff(platform, current.names)
        runController.reset(platform)
      }
    }

    const prev = getState(platform)
    const wasRunning = prev.status === 'running'
    const { state, changed } = reduce(platform, prev, event)
    if (!changed) return prev

    setState(platform, state)
    broadcast(platform, state)

    // Handoff tepat sekali saat run berakhir (DONE / STOP / FAIL) — termasuk
    // nama parsial saat operator menekan Hentikan. Tidak ada langkah salin/paste;
    // input manual tetap tersedia di modal rekap.
    if (wasRunning && state.status !== 'running') handoff(platform, state.names)

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

  /** Kembalikan ke state default total. */
  reset(platform: Platform): NameState {
    const state = defaultStateFor(platform)
    setState(platform, state)
    broadcast(platform, state)
    return state
  },
}
