const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const t = list.find((x) => x.url.includes('out/renderer'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let seq = 0; const p = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id) } }
const ev = async (e) => (await new Promise((r) => { const id = ++seq; p.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true } })) })).result.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const audit = `(() => {
  const all=[...document.querySelectorAll('body *')].filter(e=>e.offsetParent!==null);
  const textEls=all.filter(e=>e.children.length===0 && (e.textContent||'').trim());
  const tiny=textEls.filter(e=>parseFloat(getComputedStyle(e).fontSize)<11).map(e=>({tag:e.tagName,size:getComputedStyle(e).fontSize,txt:(e.textContent||'').trim().slice(0,40)}));
  const overflow=all.filter(e=>e.scrollWidth>e.clientWidth+2 && e.clientWidth>0).map(e=>({tag:e.tagName,cls:String(e.className||'').slice(0,60),sw:e.scrollWidth,cw:e.clientWidth})).slice(0,10);
  const buttons=[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null);
  const unnamed=buttons.filter(b=>!(b.textContent||'').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
  const headings=[...document.querySelectorAll('h1,h2,h3')].filter(e=>e.offsetParent!==null).map(e=>e.tagName+':'+e.textContent.trim().slice(0,40));
  const inputs=[...document.querySelectorAll('input,textarea,select')].filter(e=>e.offsetParent!==null).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')||'',ph:e.getAttribute('placeholder')||''}));
  return {
    url:location.href,
    visibleElements:all.length,
    tinyCount:tiny.length, tiny:tiny.slice(0,8),
    overflow,
    buttons:buttons.length, unnamedButtons:unnamed,
    headings,
    inputs:inputs.length, unlabeledInputs:inputs.filter(i=>!i.label&&!i.ph).length,
    bodyText:document.body.innerText.slice(0,150)
  };
})()`
const clickNav = (label) => ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); return !!b; })()`)
const clickSub = (label) => ev(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b?.click(); return !!b; })()`)
const out = {}
const screens = [
  ['beranda', async()=>{await clickNav('Beranda')}],
  ['rekap', async()=>{await clickNav('Rekap Harian')}],
  ['laporan-harian', async()=>{await clickNav('Laporan'); await clickSub('Harian')}],
  ['laporan-mingguan', async()=>{await clickSub('Mingguan')}],
  ['laporan-bulanan', async()=>{await clickSub('Bulanan')}],
  ['pegawai', async()=>{await clickNav('Data'); await clickSub('Pegawai')}],
  ['scraper', async()=>{await clickSub('Ambil Nama')}],
  ['pengaturan', async()=>{await clickNav('Pengaturan')}],
]
for (const [name, fn] of screens) {
  await fn(); await sleep(3000)
  out[name] = await ev(audit)
}
console.log(JSON.stringify(out, null, 2))
ws.close()
