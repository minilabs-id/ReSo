/**
 * Smoke test alur utama lewat CDP.
 * Prasyarat: aplikasi berjalan dengan --remote-debugging-port=9223.
 * Pakai: npm run test:e2e
 */
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.find((x) => x.url.includes('out/renderer'))
if (!target) {
  console.error('FAIL renderer target tidak ditemukan (jalankan Electron dengan --remote-debugging-port=9223)')
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const ev = async (expression, awaitPromise = false) =>
  (await new Promise((r) => {
    const id = ++seq
    pending.set(id, r)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } }))
  })).result.value

let failures = 0
const check = (cond, label, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}
const clickNav = (label) => ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); return !!b; })()`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

check(await clickNav('Beranda'), 'menu Beranda tersedia')
await sleep(1200)
const dash = await ev(`({
  h1: [...document.querySelectorAll('h1')].map(e=>e.textContent),
  nav: document.querySelectorAll('nav[aria-label="Menu utama"] button').length,
  tiny: [...document.querySelectorAll('body *')].filter(e=>e.offsetParent!==null&&e.children.length===0&&(e.textContent||'').trim()&&parseFloat(getComputedStyle(e).fontSize)<11).length,
  unnamed: [...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null&&!(b.textContent||'').trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title')).length,
})`)
check(dash.h1.includes('Beranda'), 'H1 Beranda', JSON.stringify(dash.h1))
check(dash.nav === 5, '5 menu utama', String(dash.nav))
check(dash.tiny === 0, 'tanpa teks <11px', String(dash.tiny))
check(dash.unnamed === 0, 'tombol semua bernama', String(dash.unnamed))

for (const [menu, sub, h1] of [
  ['Rekap Harian', 'Ambil Nama', 'Ambil Nama Komentar'],
  ['Laporan', 'Harian', 'Laporan'],
  ['Data', null, 'Data Pegawai'],
  ['Pengaturan', null, 'Pengaturan'],
]) {
  await clickNav(menu)
  await sleep(700)
  if (sub) {
    await ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].find(x=>x.textContent.trim()===${JSON.stringify(sub)}); b?.click(); })()`)
    await sleep(1400)
  } else {
    await sleep(1100)
  }
  const heads = await ev(`[...document.querySelectorAll('h1')].map(e=>e.textContent)`)
  check(heads.includes(h1), `halaman ${menu} → ${sub ?? ''}`, JSON.stringify(heads))
}

const scrape = await ev(`(async()=>{const a=await window.reso.scrape.getAll();return Object.keys(a).sort()})()`, true)
check(JSON.stringify(scrape) === JSON.stringify(['facebook', 'instagram', 'tiktok']), 'IPC scraping aktif', JSON.stringify(scrape))

ws.close()
console.log(failures === 0 ? '\nE2E SMOKE OK' : `\n${failures} pemeriksaan gagal`)
process.exit(failures === 0 ? 0 : 1)
