/** Ukur cold start: spawn Electron → CDP → H1 tampil. */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exe = join(import.meta.dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
const entry = join(import.meta.dirname, '..', 'out', 'main', 'index.js')
const profile = mkdtempSync(join(tmpdir(), 'reso-cold-'))
const t0 = Date.now()
const child = spawn(exe, [entry, '--remote-debugging-port=9225', `--user-data-dir=${profile}`], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page = null
for (let i = 0; i < 120; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9225/json/list')).json()
    page = list.find((x) => x.url.includes('out/renderer'))
    if (page) break
  } catch {}
  await sleep(100)
}
if (!page) { console.error('renderer tidak muncul'); child.kill(); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const ready = async () => {
  const n = ++id
  return new Promise((res) => {
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === n) { ws.removeEventListener('message', h); res(m.result.result.value) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: `!!document.querySelector('h1')`, returnByValue: true } }))
  })
}
for (let i = 0; i < 100; i++) { if (await ready()) break; await sleep(100) }
console.log(`COLD START → H1: ${Date.now() - t0} ms`)
ws.close()
child.kill()
