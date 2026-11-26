/**
 * Audit performa mendalam: CPU profile, latensi IPC, dan biaya render
 * dengan data sintetis. Prasyarat: app berjalan di CDP port 9223.
 */
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

// --- 1. Latensi IPC (baseline, data saat ini) ---
out.ipcBaseline = await ev(`(async()=>{
  const bench = async (fn, n=12) => { const t0=performance.now(); for(let i=0;i<n;i++) await fn(); return +((performance.now()-t0)/n).toFixed(2) };
  return {
    getAllMs: await bench(()=>window.reso.scrape.getAll()),
    employeesMs: await bench(()=>window.reso.data.listEmployees()),
    dailyRangeMs: await bench(()=>window.reso.data.listDailyRange('1970-01-01','2999-12-31')),
    settingsMs: await bench(()=>window.reso.data.getAllSettings()),
    getDailyMs: await bench(()=>window.reso.data.getDaily(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'}))),
  };
})()`, true)

// --- 2. CPU profile saat perpindahan menu ---
await cmd('Profiler.enable')
await cmd('Profiler.start')
const nav = (label) => ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); })()`)
const sub = (label) => ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); })()`)
for (let i = 0; i < 3; i++) {
  await nav('Laporan'); await sleep(500); await sub('Bulanan'); await sleep(600)
  await nav('Rekap Harian'); await sleep(500); await sub('Kalender'); await sleep(600)
  await nav('Beranda'); await sleep(500)
}
const profile = (await cmd('Profiler.stop')).profile
const byFn = new Map()
for (let i = 0; i < profile.samples.length; i++) {
  const node = profile.nodes.find((n) => n.id === profile.samples[i])
  if (!node) continue
  const name = node.callFrame.functionName || '(anonymous)'
  const dt = profile.timeDeltas[i] || 0
  byFn.set(name, (byFn.get(name) || 0) + dt / 1000)
}
out.cpuTop = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, ms]) => ({ name, ms: +ms.toFixed(1) }))

// --- 3. Data sintetis: 200 pegawai + 120 hari ---
out.heapBefore = await ev(`performance.memory ? +(performance.memory.usedJSHeapSize/1048576).toFixed(2) : null`)
out.seed = await ev(`(async()=>{
  const ops=[]; const today=new Date();
  const iso=(d)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  for(let i=0;i<200;i++) ops.push({collection:'employees',id:'perf_e'+i,data:{name:'Pegawai '+i,nip:String(1000000000000000+i),bidang:'B'+ (i%8),igUsername:'perf_'+i,fbName:'Perf '+i,tiktokName:'perf_'+i,aliases:[]}});
  const ids=['perf_e0','perf_e1','perf_e2'];
  for(let d=0;d<120;d++){ const day=new Date(today); day.setDate(day.getDate()-d);
    ops.push({collection:'dailyEngagement',id:iso(day),data:{date:iso(day),igRawText:'a\\nb\\nc',igEngagedEmployeeIds:ids,fbEngagedEmployeeIds:ids.slice(0,2),tiktokEngagedEmployeeIds:ids.slice(1)}});
  }
  const t0=performance.now(); const r=await window.reso.data.batchSave(ops); return {ok:r.ok,ms:+(performance.now()-t0).toFixed(1),ops:ops.length};
})()`, true)
await sleep(1800)

// --- 4. Biaya render dengan data besar ---
const renderTime = async (menu, submenu) => {
  await nav(menu); await sleep(350)
  if (submenu) { await sub(submenu); await sleep(250) }
  return ev(`(async()=>{ const t0=performance.now(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return +(performance.now()-t0).toFixed(1) })()`, true)
}
out.render = {
  beranda: await renderTime('Beranda'),
  laporanBulanan: await renderTime('Laporan', 'Bulanan'),
  rekapKalender: await renderTime('Rekap Harian', 'Kalender'),
  dataPegawai: await renderTime('Data'),
}

// --- 5. Latensi IPC & heap setelah data besar ---
out.ipcLarge = await ev(`(async()=>{
  const bench = async (fn, n=8) => { const t0=performance.now(); for(let i=0;i<n;i++) await fn(); return +((performance.now()-t0)/n).toFixed(2) };
  return { employeesMs: await bench(()=>window.reso.data.listEmployees()), dailyRangeMs: await bench(()=>window.reso.data.listDailyRange('1970-01-01','2999-12-31')) };
})()`, true)
out.heapAfter = await ev(`performance.memory ? +(performance.memory.usedJSHeapSize/1048576).toFixed(2) : null`)
out.domNodes = await ev(`document.querySelectorAll('*').length`)

console.log(JSON.stringify(out, null, 2))
ws.close()
