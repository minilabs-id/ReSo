/**
 * Store pengaturan ReSo Native (JSON di userData/settings.json).
 *
 * HANYA preferensi — tidak ada token/sesi di sini. Semua tulisan melewati
 * `sanitizeSettingsPatch` supaya renderer tidak bisa menyuntik data kotor.
 */
import Store from 'electron-store'
import {
  SETTINGS_DEFAULTS,
  sanitizeSettingsPatch,
  type ResoSettings,
} from './settings-schema'

let store: Store<ResoSettings> | null = null

/** Lazy init — `app` harus sudah ready saat Store pertama dipakai. */
function getStore(): Store<ResoSettings> {
  if (!store) {
    store = new Store<ResoSettings>({
      name: 'settings',
      defaults: SETTINGS_DEFAULTS,
      // Tulis atomik + rapi agar tidak korup kalau proses mati mendadak.
      clearInvalidConfig: true,
    })
  }
  return store
}

export function getSettings(): ResoSettings {
  const raw = getStore().store
  // Sanitasi saat baca: file bisa saja diedit manual oleh operator.
  return { ...SETTINGS_DEFAULTS, ...sanitizeSettingsPatch(raw) }
}

export function setSettings(patch: unknown): ResoSettings {
  const clean = sanitizeSettingsPatch(patch)
  const s = getStore()
  for (const [key, value] of Object.entries(clean)) {
    s.set(key as keyof ResoSettings, value as ResoSettings[keyof ResoSettings])
  }
  return getSettings()
}

export function resetSettings(): ResoSettings {
  getStore().clear()
  return { ...SETTINGS_DEFAULTS }
}

export function getSettingsPath(): string {
  return getStore().path
}
