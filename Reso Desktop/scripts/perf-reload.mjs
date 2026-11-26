const t = (await (await fetch('http://127.0.0.1:9223/json/list')).json()).find(x => x.url.includes('out/renderer'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise(r => { ws.onopen = r })
let seq = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const cmd = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
await cmd('Performance.enable')
await cmd('Page.enable')
await cmd('Page.reload', { ignoreCache: true })
const t0 = Date.now()
for (let i = 0; i < 60; i++) {
  const r = await cmd('Runtime.evaluate', { expression: `document.readyState==='complete' && !!document.querySelector('h1')`, returnByValue: true })
  if (r.result.value) break
  await new Promise(r => setTimeout(r, 200))
}
const ms = Date.now() - t0
const metrics = Object.fromEntries((await cmd('Performance.getMetrics')).metrics.map(x => [x.name, x.value]))
console.log(JSON.stringify({
  reloadMs: ms,
  scriptSec: +(metrics.ScriptDuration || 0).toFixed(3),
  layoutSec: +(metrics.LayoutDuration || 0).toFixed(3),
  recalcStyleSec: +(metrics.RecalcStyleDuration || 0).toFixed(3),
  taskSec: +(metrics.TaskDuration || 0).toFixed(3),
  jsHeapMB: +((metrics.JSHeapUsedSize || 0) / 1048576).toFixed(2),
}, null, 2))
ws.close()
