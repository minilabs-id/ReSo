/**
 * Uji cepat skema pengaturan ReSo Native (M2).
 * Jalankan: npx tsx electron/store/settings-schema.test.ts
 */
import {
  SETTINGS_DEFAULTS,
  sanitizeSetting,
  sanitizeSettingsPatch,
} from './settings-schema'

let n = 0
function eq(actual: unknown, expected: unknown, label: string): void {
  n++
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`✗ ${label}: dapat ${a}, harusnya ${b}`)
}

// --- klamp angka ---
eq(sanitizeSetting('maxScrollRounds', 0), 1, 'rounds di bawah batas → min')
eq(sanitizeSetting('maxScrollRounds', 9999), 200, 'rounds di atas batas → max')
eq(sanitizeSetting('maxScrollRounds', 12.9), 12, 'rounds dibulatkan ke bawah')
eq(sanitizeSetting('maxScrollRounds', '12'), SETTINGS_DEFAULTS.maxScrollRounds, 'string ditolak')
eq(sanitizeSetting('maxScrollRounds', NaN), SETTINGS_DEFAULTS.maxScrollRounds, 'NaN ditolak')
eq(sanitizeSetting('scrollDelayMs', 1), 200, 'delay terlalu kecil → min')
eq(sanitizeSetting('captureTimeoutMs', 5_000_000), 900_000, 'timeout terlalu besar → max')

// --- url ---
eq(sanitizeSetting('tiktokTemplateUrl', '  https://www.tiktok.com/@a  '), 'https://www.tiktok.com/@a', 'url di-trim')
eq(sanitizeSetting('tiktokTemplateUrl', 'javascript:alert(1)'), SETTINGS_DEFAULTS.tiktokTemplateUrl, 'skema ditolak')
eq(sanitizeSetting('tiktokTemplateUrl', 'x'.repeat(3000)), SETTINGS_DEFAULTS.tiktokTemplateUrl, 'terlalu panjang ditolak')
eq(sanitizeSetting('instagramTemplateUrl', ''), '', 'string kosong tetap kosong')
eq(sanitizeSetting('instagramTemplateUrl', 42), SETTINGS_DEFAULTS.instagramTemplateUrl, 'non-string ditolak')

// --- boolean ---
eq(sanitizeSetting('launchAtLogin', true), true, 'bool diterima')
eq(sanitizeSetting('launchAtLogin', 'true'), SETTINGS_DEFAULTS.launchAtLogin, 'string "true" ditolak')
eq(sanitizeSetting('minimizeToTray', 0), SETTINGS_DEFAULTS.minimizeToTray, 'angka ditolak')

// --- kunci tak dikenal ---
eq(sanitizeSetting('evilKey', 'x'), null, 'kunci tak dikenal ditolak')
eq(sanitizeSetting('__proto__', { polluted: true }), null, 'proto pollution ditolak')
eq(Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, 'evilKey'), false, 'default bersih')

// --- patch ---
eq(sanitizeSettingsPatch(null), {}, 'patch null → {}')
eq(sanitizeSettingsPatch([1, 2]), {}, 'patch array → {}')
eq(
  sanitizeSettingsPatch({ maxScrollRounds: 30, evil: 1 }),
  { maxScrollRounds: 30 },
  'patch hanya menyaring kunci dikenal'
)

console.log(`settings-schema: ${n} checks OK`)
