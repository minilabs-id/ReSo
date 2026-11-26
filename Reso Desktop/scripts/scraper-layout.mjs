const t = (await (await fetch('http://127.0.0.1:9223/json/list')).json()).find((x) => x.url.includes('out/renderer'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const ev = async (e, a = false) => {
  const n = ++id
  return new Promise((res) => {
    const h = (m) => { const j = JSON.parse(m.data); if (j.id === n) { ws.removeEventListener('message', h); res(j.result.result.value) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: a } }))
  })
}
await ev(`(async()=>{
  const nav=[...document.querySelectorAll('nav[aria-label="Menu utama"] button')].find(b=>b.textContent.trim()==='Rekap Harian');nav.click();
  await new Promise(r=>setTimeout(r,600));
  const sub=[...document.querySelectorAll('nav[aria-label="Sub-menu"] button')].find(b=>b.textContent.trim()==='Ambil Nama');sub.click();
  await new Promise(r=>setTimeout(r,1800));
})()`, true)
const info = await ev(`(() => {
  const rect = (el) => { if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} };
  const h1 = [...document.querySelectorAll('h1')][0];
  return {
    win:[innerWidth,innerHeight],
    h1: rect(h1),
    platform: rect(document.querySelector('[aria-label="Pilih platform"]')),
    toolbar: rect(document.querySelector('input[aria-label="Alamat postingan"]')?.parentElement),
    action: rect([...document.querySelectorAll('button')].find(b=>b.textContent.includes('Ambil dari halaman ini'))?.parentElement),
    status: rect(document.querySelector('[role="status"]')),
    browser: rect(document.querySelector('[aria-label^="Browser "]')),
    result: rect([...document.querySelectorAll('h2')].find(e=>e.textContent.includes('Terakhir diambil'))?.closest('.rounded-xl')),
    text: document.body.innerText.split('\\n').filter(Boolean).slice(0,26),
  };
})()`)
console.log(JSON.stringify(info, null, 2))
ws.close()
