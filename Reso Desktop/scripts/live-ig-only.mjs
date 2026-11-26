const PORT = 9223
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function connect(url) { return new Promise(async (resolve) => { const ws = new WebSocket(url); await new Promise((r) => { ws.onopen = r }); let seq = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id) } }; const send = (method, params = {}) => new Promise((r) => { const id = ++seq; p.set(id, r); ws.send(JSON.stringify({ id, method, params })) }); const ev = async (e, a = false) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: a })).result.value; resolve({ ws, ev }) }) }
const app = await connect((await list()).find((t) => t.url.includes('out/renderer')).webSocketDebuggerUrl)
await app.ev(`window.reso.settings.set({maxScrollRounds:6, scrollDelayMs:900, captureTimeoutMs:45000})`, true)
await app.ev(`window.reso.browser.openBrowser('instagram', {x:80,y:80,width:1100,height:760})`, true)
await app.ev(`window.reso.browser.navigate('instagram','https://www.instagram.com/p/Df5WFYiJXmA/')`, true)
let v = null
for (let i = 0; i < 10; i++) { await sleep(3000); const t = (await list()).find((x) => x.url.includes('instagram.com/p/')); if (!t) continue; v = await connect(t.webSocketDebuggerUrl); if (await v.ev(`document.querySelectorAll('a[href^="/"]').length`) > 30) break }
const runId = 'igfinal_' + Date.now()
await app.ev(`window.reso.scrape.applyEvent('instagram', {type:'START',runId:${JSON.stringify(runId)},includeReplies:false})`, true)
let st
for (let i = 0; i < 25; i++) { await sleep(2000); st = await app.ev(`(async()=>{const a=await window.reso.scrape.getAll();return a.instagram})()`, true); if (st && st.status !== 'running') break }
console.log(JSON.stringify({ status: st?.status, reason: st?.stopReason, count: st?.count, names: st?.names }, null, 2))
v.ws.close(); app.ws.close()
