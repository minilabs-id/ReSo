const t = (await (await fetch('http://127.0.0.1:9223/json/list')).json()).find((x) => x.url.includes('out/renderer'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let seq = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const cmd = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression, awaitPromise = false) =>
  (await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })).result.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

await cmd('Runtime.enable')
await cmd('Page.enable')
await cmd('Page.reload', { ignoreCache: true })
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('h1')`)) break; await sleep(150) }
await sleep(600)

await ev(`(() => {
  window.__perf2 = { events: [], shifts: [], long: [] };
  const mark = (label) => window.__perf2.events.push({ label, at: Math.round(performance.now()) });
  window.__mark = mark;
  new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf2.shifts.push({ v:+e.value.toFixed(4), at:Math.round(e.startTime), sources:(e.sources||[]).slice(0,3).map(s=>s.node?.tagName+'.'+String(s.node?.className||'').slice(0,30)) }) }).observe({type:'layout-shift', buffered:true});
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf2.long.push({ms:Math.round(e.duration), at:Math.round(e.startTime)}) }).observe({type:'longtask', buffered:true});
})()`)

const clickNav = async (label) => { await ev(`window.__mark(${JSON.stringify('nav:' + label)})`); await ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); })()`) }
const clickSub = async (label) => { await ev(`window.__mark(${JSON.stringify('sub:' + label)})`); await ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); })()`) }
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); for (let i = 0; i < ms / 100; i++) { if (await ev(expr)) return Date.now() - t0; await sleep(100) } return -1 }

// pastikan kondisi bersih: Beranda
await clickNav('Beranda'); await sleep(600)

out.dataFirst = (await clickNav('Data'), await waitFor(`[...document.querySelectorAll('h1')].some(e=>e.textContent==='Data Pegawai')`))
out.dataTable = await ev(`(async()=>{
  const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.includes('100')));
  if (sel) { sel.value='100'; sel.dispatchEvent(new Event('change',{bubbles:true})); }
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const rows=document.querySelectorAll('tbody tr').length;
  const scroll=[...document.querySelectorAll('div.overflow-auto')].find(e=>e.scrollHeight>e.clientHeight);
  let frames=0; const t1=performance.now();
  if (scroll) for(let i=0;i<20;i++){ scroll.scrollTop += 150; await new Promise(r=>requestAnimationFrame(r)); frames++ }
  return {rows, scrollMsPerFrame: frames? +((performance.now()-t1)/frames).toFixed(1):null, frames};
})()`, true)

out.settingsFirst = (await clickNav('Pengaturan'), await waitFor(`[...document.querySelectorAll('h1')].some(e=>e.textContent==='Pengaturan')`))
out.beranda = (await clickNav('Beranda'), await waitFor(`[...document.querySelectorAll('h1')].some(e=>e.textContent==='Beranda')`))

// modal: buka → ketik → Batal → Buang perubahan → tutup
await clickNav('Rekap Harian'); await sleep(300); await clickSub('Kalender'); await sleep(1200)
out.modalOpen = await ev(`(async()=>{
  const b=[...document.querySelectorAll('button')].find(x=>/^\\d+$/.test(x.textContent.trim()) && !x.disabled && x.offsetParent!==null);
  const t0=performance.now(); b.click();
  for(let i=0;i<40;i++){ await new Promise(r=>requestAnimationFrame(r)); if(document.querySelector('[role="dialog"]')) return +(performance.now()-t0).toFixed(1) }
  return -1
})()`, true)
out.type = await ev(`(async()=>{
  const ta=document.querySelector('[role="dialog"] textarea'); if(!ta) return null;
  const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
  const t0=performance.now();
  setter.call(ta, 'budi\\nani\\nsandi\\n'.repeat(80)); ta.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>requestAnimationFrame(r)); return +(performance.now()-t0).toFixed(1);
})()`, true)
out.modalClose = await ev(`(async()=>{
  const batal=[...document.querySelectorAll('[role="dialog"] button')].find(x=>x.textContent.trim()==='Batal'); batal.click();
  await new Promise(r=>setTimeout(r,250));
  const buang=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Buang perubahan')); buang?.click();
  const t0=performance.now();
  for(let i=0;i<40;i++){ await new Promise(r=>requestAnimationFrame(r)); if(!document.querySelector('[role="dialog"]')) return +(performance.now()-t0).toFixed(1) }
  return -1
})()`, true)

out.perf = await ev(`({
  events: window.__perf2.events,
  shifts: window.__perf2.shifts,
  long: window.__perf2.long,
})`)
console.log(JSON.stringify(out, null, 2))
ws.close()
