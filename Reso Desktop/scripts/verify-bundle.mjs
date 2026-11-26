/**
 * Guard ukuran bundle awal. Jalankan setelah `npm run build`.
 * Pakai: npm run verify:bundle
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const assetDir = join(root, 'out', 'renderer', 'assets')
const html = readFileSync(join(root, 'out', 'renderer', 'index.html'), 'utf8')
const entry = html.match(/src="\.\/assets\/(index-[^"]+\.js)"/)?.[1]
const css = html.match(/href="\.\/assets\/(index-[^"]+\.css)"/)?.[1]

let failures = 0
const check = (cond, label, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const LIMIT_JS = 1_300_000
const LIMIT_CSS = 100_000

check(!!entry, 'entry JS ditemukan di index.html', entry ?? '')
if (entry) {
  const bytes = statSync(join(assetDir, entry)).size
  check(bytes <= LIMIT_JS, 'chunk awal <= 1,3 MB', `${(bytes / 1024).toFixed(1)} KB`)
}
check(!!css, 'CSS ditemukan di index.html', css ?? '')
if (css) {
  const bytes = statSync(join(assetDir, css)).size
  check(bytes <= LIMIT_CSS, 'CSS <= 100 KB', `${(bytes / 1024).toFixed(1)} KB`)
}

const chunks = readdirSync(assetDir).filter((f) => f.endsWith('.js'))
check(chunks.length >= 5, 'lazy chunk tersedia', `${chunks.length} file JS`)

console.log(failures === 0 ? '\nBUDGET OK' : `\n${failures} pemeriksaan gagal`)
process.exit(failures === 0 ? 0 : 1)
