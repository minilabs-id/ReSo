import { app } from 'electron'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** Simpan salinan `.bak` bila berkas JSON korup sebelum electron-store meresetnya. */
export function backupIfInvalid(name: string): void {
  const file = join(app.getPath('userData'), `${name}.json`)
  if (!existsSync(file)) return
  try {
    JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    try {
      copyFileSync(file, `${file}.bak`)
    } catch {
      /* gagal membuat cadangan */
    }
  }
}
