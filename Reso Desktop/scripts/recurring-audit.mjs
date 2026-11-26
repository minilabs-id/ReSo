/**
 * Audit berkala ReSo Desktop — dijalankan automation (tanpa model).
 * Memeriksa: working tree, unit test, budget bundle, artefak rilis lokal,
 * dan keselarasan versi rilis GitHub terbaru.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const project = join(import.meta.dirname, '..')
const repo = join(project, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

let issues = 0
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) issues++
}
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] })

try {
  const dirty = run('git', ['status', '--porcelain'], repo).trim()
  check(!dirty, 'working tree bersih', dirty.split('\n')[0] ?? '')
} catch (e) {
  check(false, 'git status', e.message)
}

try {
  const out = run(npm, ['test'], project)
  const total = (out.match(/checks OK/g) || []).length
  check(total >= 9, 'unit test', `${total} kelas OK`)
} catch (e) {
  check(false, 'unit test', String(e.stdout || e.message).slice(-300))
}

try {
  const out = run(npm, ['run', 'verify:bundle'], project)
  check(out.includes('BUDGET OK'), 'budget bundle')
} catch (e) {
  check(false, 'budget bundle', String(e.stdout || e.message).slice(-300))
}

const version = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).version
try {
  const out = run(npm, ['run', 'verify:release'], project)
  check(out.includes('RELEASE READY'), 'artefak rilis lokal', `v${version}`)
} catch (e) {
  check(false, 'artefak rilis lokal', String(e.stdout || e.message).slice(-300))
}

try {
  const tag = run('gh', ['release', 'view', '--repo', 'minilabs-id/ReSo', '--json', 'tagName'], repo)
  const latest = JSON.parse(tag).tagName
  check(latest === `v${version}`, 'rilis GitHub = versi lokal', `${latest} vs v${version}`)
} catch (e) {
  check(false, 'rilis GitHub', String(e.message).slice(-300))
}

console.log(issues === 0 ? `\nAUDIT BERKALA OK — v${version}` : `\n${issues} masalah ditemukan — v${version}`)
process.exit(issues === 0 ? 0 : 1)
