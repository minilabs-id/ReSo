/**
 * Validasi artefak rilis sebelum/ setelah publish ke GitHub.
 * Pakai: npm run verify:release   (atau node scripts/verify-release.mjs --remote)
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const remote = process.argv.includes('--remote')

let failures = 0
const check = (cond, label, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const installer = join(root, 'release', `ReSoSetup-${version}.exe`)
const blockmap = `${installer}.blockmap`
const latest = join(root, 'release', 'latest.yml')

check(existsSync(installer), 'installer lokal', `ReSoSetup-${version}.exe`)
check(existsSync(blockmap), 'blockmap lokal')
check(existsSync(latest), 'latest.yml lokal')

if (existsSync(latest)) {
  const yml = readFileSync(latest, 'utf8')
  check(new RegExp(`^version:\\s*${version.replace(/\./g, '\\.')}$`, 'm').test(yml), 'versi latest.yml', version)
  check(yml.includes(`ReSoSetup-${version}.exe`), 'nama installer di latest.yml')
}

if (remote) {
  try {
    const raw = execFileSync(
      'gh',
      ['release', 'view', `v${version}`, '--repo', 'minilabs-id/ReSo', '--json', 'assets'],
      { encoding: 'utf8' }
    )
    const assets = JSON.parse(raw).assets.map((a) => a.name)
    for (const name of [`ReSoSetup-${version}.exe`, `ReSoSetup-${version}.exe.blockmap`, 'latest.yml']) {
      check(assets.includes(name), `aset GitHub: ${name}`)
    }
  } catch (err) {
    check(false, 'gh release view', err instanceof Error ? err.message : String(err))
  }
}

console.log(failures === 0 ? '\nRELEASE READY' : `\n${failures} pemeriksaan gagal`)
process.exit(failures === 0 ? 0 : 1)
