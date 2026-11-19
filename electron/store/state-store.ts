/**
 * Store state run per platform (JSON di userData/scrape-state.json).
 *
 * Ini pengganti `chrome.storage.local` [STORAGE_KEY_FB/TT/IG] pada ekstensi
 * lama. Disimpan supaya hasil scraping tidak hilang saat app ditutup sebelum
 * dikirim ke ReSo (antrian kirim ditangani M5).
 */
import Store from 'electron-store'
import { app } from 'electron'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

function backupIfInvalid(name: string): void {
  const file = join(app.getPath('userData'), `${name}.json`)
  if (!existsSync(file)) return
  try {
    JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    try { copyFileSync(file, `${file}.bak`) } catch { /* gagal membuat cadangan */ }
  }
}
import { defaultStateFor, sanitizeState } from './state-schema'
import type { NameState, Platform } from '../../src/shared/types'

const PLATFORMS: readonly Platform[] = ['facebook', 'tiktok', 'instagram']

interface StateShape {
  facebook: NameState
  tiktok: NameState
  instagram: NameState
}

let store: Store<StateShape> | null = null

function getStore(): Store<StateShape> {
  if (!store) {
    backupIfInvalid('scrape-state')
    store = new Store<StateShape>({
      name: 'scrape-state',
      defaults: {
        facebook: defaultStateFor('facebook'),
        tiktok: defaultStateFor('tiktok'),
        instagram: defaultStateFor('instagram'),
      },
      clearInvalidConfig: true,
    })
  }
  return store
}

/** State tersanitasi (file bisa diedit manual / rusak). */
export function getState(platform: Platform): NameState {
  const raw = getStore().get(platform)
  return sanitizeState(raw, platform)
}

export function setState(platform: Platform, state: NameState): void {
  getStore().set(platform, sanitizeState(state, platform))
}

export function getAllStates(): StateShape {
  const out = {} as StateShape
  for (const p of PLATFORMS) out[p] = getState(p)
  return out
}

/** Hapus hasil tersimpan (dipakai UI "Bersihkan"/setelah kirim sukses). */
export function clearState(platform: Platform): NameState {
  const fresh = defaultStateFor(platform)
  getStore().set(platform, fresh)
  return fresh
}
