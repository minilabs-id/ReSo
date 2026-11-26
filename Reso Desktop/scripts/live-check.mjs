// Uji coba langsung app Electron terpaket lewat CDP (Node 22+ WebSocket global).
const TARGET = 'http://127.0.0.1:9222/json/list'

const targets = await (await fetch(TARGET)).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes('out/renderer'))
if (!page) throw new Error('Renderer target tidak ditemukan')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let seq = 0
const pending = new Map()
const events = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) reject(new Error(JSON.stringify(m.error)))
    else resolve(m.result)
  } else {
    events.push(m)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pass = []
const fail = []
function check(label, cond, detail = '') {
  ;(cond ? pass : fail).push(label + (detail ? ` — ${detail}` : ''))
}

await send('Runtime.enable')
await send('Page.enable')
await send('Log.enable')

// Tunggu shell siap.
let nav = []
for (let i = 0; i < 40; i++) {
  nav = await evaluate(`[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].map(b=>b.textContent.trim())`)
  if (Array.isArray(nav) && nav.length >= 5) break
  await sleep(250)
}
check('sidebar 5 item', Array.isArray(nav) && nav.length === 5, JSON.stringify(nav))
check('label Beranda/Rekap/Laporan/Data/Pengaturan',
  JSON.stringify(nav) === JSON.stringify(['Beranda', 'Rekap Harian', 'Laporan', 'Data', 'Pengaturan']),
  JSON.stringify(nav))

// Navigasi ke Data → Ambil Nama.
await evaluate(`(() => {
  const b=[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].find(x=>x.textContent.trim()==='Data');
  if(b) b.click(); return !!b;
})()`)
await sleep(300)
const sub = await evaluate(`[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].map(b=>b.textContent.trim())`)
check('sub-tab Data', JSON.stringify(sub) === JSON.stringify(['Pegawai', 'Ambil Nama']), JSON.stringify(sub))
await evaluate(`(() => {
  const b=[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].find(x=>x.textContent.trim()==='Ambil Nama');
  if(b) b.click(); return !!b;
})()`)
await sleep(500)

const scraperText = await evaluate(`document.body.innerText`)
check('judul panel scraper', scraperText.includes('Ambil Nama Komentar'))
check('tombol handoff tanpa kata "hari ini"', scraperText.includes('Masukkan ke rekap') && !scraperText.includes('Masukkan ke rekap hari ini'))
check('tombol Proses halaman ini', scraperText.includes('Proses halaman ini'))
check('checkbox Sertakan balasan', scraperText.includes('Sertakan balasan'))
const platformPressed = await evaluate(`[...document.querySelectorAll('[role="group"][aria-label="Pilih platform"] button')].map(b=>b.getAttribute('aria-pressed'))`)
check('aria-pressed tab platform', Array.isArray(platformPressed) && platformPressed.length === 3, JSON.stringify(platformPressed))

// State scrape lewat IPC sungguhan: SET_OPTIONS harus mengubah state main.
const ipc = await evaluate(`(async () => {
  const before = await window.reso.scrape.getState('facebook');
  const next = !before.includeReplies;
  const after = await window.reso.scrape.applyEvent('facebook', {type:'SET_OPTIONS', includeReplies: next});
  const all = await window.reso.scrape.getAll();
  return { before: before.includeReplies, after: after.includeReplies, platforms: Object.keys(all) };
})()`, true)
check('SET_OPTIONS lewat IPC', !!ipc && ipc.after !== ipc.before && ipc.after === !ipc.before, JSON.stringify(ipc))
check('3 platform di getAll', !!ipc && JSON.stringify(ipc.platforms) === JSON.stringify(['facebook', 'tiktok', 'instagram']), JSON.stringify(ipc?.platforms))

// Kembalikan opsi semula.
await evaluate(`window.reso.scrape.applyEvent('facebook', {type:'SET_OPTIONS', includeReplies: ${ipc.before}})`, true)

// Pastikan tidak ada exception/console.error saat interaksi.
const errors = events
  .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error'))
  .map((e) => JSON.stringify(e.params).slice(0, 200))
check('tanpa error konsol', errors.length === 0, errors.join(' | '))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const fs = await import('node:fs')
const out = 'C:\\Users\\zo\\AppData\\Local\\Temp\\opencode\\live-scraper.png'
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))

console.log('PASS:')
for (const p of pass) console.log('  ✓ ' + p)
if (fail.length) {
  console.log('FAIL:')
  for (const f of fail) console.log('  ✗ ' + f)
}
console.log('screenshot: ' + out)
ws.close()
process.exit(fail.length ? 1 : 0)
