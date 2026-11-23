const t = (await (await fetch('http://127.0.0.1:9223/json/list')).json()).find((x) => x.url.includes('out/renderer'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let seq = 0; const p = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id) } }
const ev = async (e, a = false) => {
  const r = await new Promise((res) => { const id = ++seq; p.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: a } })) })
  if (r.exceptionDetails) console.log('EXC', r.exceptionDetails.text, r.exceptionDetails.exception?.description?.slice(0, 200))
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const id = 'quick_' + Date.now()
console.log('start', await ev(`window.reso.scrape.applyEvent('facebook',{type:'START',runId:'${id}',includeReplies:false})`, true)?.then?.(() => 'ok') ?? 'sent')
await ev(`window.reso.scrape.applyEvent('facebook',{type:'PROGRESS',runId:'${id}',names:['uji_automatik_satu','uji_automatik_dua']})`, true)
await ev(`window.reso.scrape.applyEvent('facebook',{type:'DONE',runId:'${id}',reason:'complete'})`, true)
await sleep(1000)
console.log('text', (await ev(`document.body.innerText`)).split('\n').filter((l) => l.includes('masuk rekap')).slice(-2))
console.log('daily', await ev(`(async()=>{try{const d=await window.reso.data.getDaily('2026-11-22'); return {fb:(d?.fbRawText||'').split('\\n').filter(Boolean)};}catch(e){return {err:String(e)}}})()`, true))
ws.close()
