const started = Date.now()
let targets = []
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9223/json/list')).json(); if (targets.some(x => x.url.includes('out/renderer'))) break } catch {}
  await new Promise(r => setTimeout(r, 250))
}
const t = targets.find(x => x.url.includes('out/renderer'))
if (!t) { console.error('renderer tidak ditemukan'); process.exit(1) }
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise(r => { ws.onopen = r })
let seq = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const cmd = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => (await cmd('Runtime.evaluate', { expression, returnByValue: true })).result.value

for (let i = 0; i < 40; i++) {
  const ready = await ev(`document.readyState === 'complete' && !!document.querySelector('h1')`)
  if (ready) break
  await new Promise(r => setTimeout(r, 250))
}
const bootMs = Date.now() - started
const metrics = await cmd('Performance.getMetrics')
const m = Object.fromEntries(metrics.metrics.map(x => [x.name, x.value]))
const dom = await ev(`({
  nodes: document.querySelectorAll('*').length,
  resources: performance.getEntriesByType('resource').map(r=>({name:r.name.split('/').pop(),size:r.transferSize,dur:Math.round(r.duration)})).slice(0,12),
  heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null,
  heapLimitMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit/1048576) : null,
})`)
console.log(JSON.stringify({
  bootMs,
  scriptSec: Math.round((m.ScriptDuration || 0) * 100) / 100,
  layoutSec: Math.round((m.LayoutDuration || 0) * 100) / 100,
  taskSec: Math.round((m.TaskDuration || 0) * 100) / 100,
  nodes: dom.nodes,
  heapMB: dom.heapMB,
  heapLimitMB: dom.heapLimitMB,
  resources: dom.resources,
}, null, 2))
ws.close()
