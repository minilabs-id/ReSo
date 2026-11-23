// Uji coba langsung handoff scraper → rekap di renderer sungguhan (CDP).
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes('out/renderer'))
if (!page) throw new Error('Renderer target tidak ditemukan')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id)
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
  }
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const ev = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, cond, detail = '') => results.push([cond, label, detail])

await send('Runtime.enable')
// Pastikan panel Ambil Nama terbuka & tab Facebook aktif.
await ev(`(() => {
  const data=[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].find(x=>x.textContent.trim()==='Data'); if(data) data.click();
  const sub=[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].find(x=>x.textContent.trim()==='Ambil Nama'); if(sub) sub.click();
  return true;
})()`)
await sleep(400)
await ev(`(() => {
  const b=[...document.querySelectorAll('[role="group"][aria-label="Pilih platform"] button')].find(x=>x.textContent.includes('Facebook'));
  if(b) b.click(); return !!b;
})()`)
await sleep(500)

// Seed状态 lewat IPC: START → PROGRESS → STOP (engine dibatalkan segera).
const seeded = await ev(`(async () => {
  const s=window.reso.scrape;
  // Arahkan host ke URL postingan yang lolos validasi agar engine tidak FAIL
  // sebelum PROGRESS terkirim (offline: halaman tidak perlu benar-benar load).
  await window.reso.settings.set({captureTimeoutMs: 5000});
  await window.reso.browser.navigate('facebook','https://www.facebook.com/posts/12345');
  await new Promise(r=>setTimeout(r,800)); // tunggu getURL() mencerminkan navigasi
  const runId='live_'+Date.now();
  await s.applyEvent('facebook',{type:'START',runId,includeReplies:false});
  await s.applyEvent('facebook',{type:'PROGRESS',runId,names:['Andi Uji Handoff','Budi Uji Handoff']});
  const mid=await s.getState('facebook');
  await s.applyEvent('facebook',{type:'STOP'});
  return {count:mid.count, names:mid.names};
})()`, true)
check('PROGRESS lewat IPC', seeded.count === 2, JSON.stringify(seeded))

// Simpan tanggal dari date picker SEBELUM klik (setelah klik panel scraper
// akan pindah ke tab Rekap Harian dan date picker tidak lagi terpasang).
const handoffDate = await ev(`document.querySelector('input[type="date"]')?.value`)
// Bersihkan field FB tanggal itu agar verifikasi benar-benar menguji tulisan baru.
await ev(`window.reso.data.upsertDaily(${JSON.stringify(handoffDate)}, {fbRawText:''})`, true)

// Klik tombol handoff sungguhan di renderer.
const clicked = await ev(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Masukkan ke rekap');
  if(!b) return false; b.click(); return true;
})()`)
check('tombol handoff ada', clicked)
await sleep(900)

const verify = await ev(`(async () => {
  const d=${JSON.stringify(handoffDate)};
  const doc=await window.reso.data.getDaily(d);
  const st=await window.reso.scrape.getState('facebook');
  return {date:d, fb:doc?.fbRawText||'', ig:doc?.igRawText||'', tt:doc?.tiktokRawText||'', scraperCount:st.count};
})()`, true)
check('tanggal handoff = YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(verify.date || ''), verify.date)
check('nama masuk ke fbRawText', verify.fb.includes('Andi Uji Handoff') && verify.fb.includes('Budi Uji Handoff'), verify.fb.slice(0, 120))
check('tidak menimpa igRawText', !verify.ig.includes('Uji Handoff'), verify.ig.slice(0, 80))
check('tidak menimpa tiktokRawText', !verify.tt.includes('Uji Handoff'), verify.tt.slice(0, 80))
check('daftar scraper dikosongkan', verify.scraperCount === 0, String(verify.scraperCount))

const modal = await ev(`document.body.innerText.includes('Input Rekapitulasi')`)
check('modal rekap terbuka setelah handoff', modal)

const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
const out = 'C:\\Users\\zo\\AppData\\Local\\Temp\\opencode\\live-handoff.png'
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))

for (const [ok, label, detail] of results) console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
console.log('screenshot: ' + out)
ws.close()
process.exit(results.some((r) => !r[0]) ? 1 : 0)
