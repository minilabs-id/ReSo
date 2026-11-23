const PORT = 9223
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function connect(url) { return new Promise(async (resolve) => { const ws = new WebSocket(url); await new Promise((r) => { ws.onopen = r }); let seq = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id) } }; const ev = async (e) => (await new Promise((r) => { const id = ++seq; p.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true } })) })).result.value; resolve({ ws, ev }) }) }
const app = await connect((await list()).find((t) => t.url.includes('out/renderer')).webSocketDebuggerUrl)
await app.ev(`window.reso.browser.navigate('facebook','https://www.facebook.com/kominfojember/reels_tab')`, true)
let v = null
for (let i = 0; i < 10; i++) { await sleep(3000); const t = (await list()).find((x) => x.url.includes('facebook.com')); if (!t) continue; v = await connect(t.webSocketDebuggerUrl); if (await v.ev(`document.querySelectorAll('a[href*="/reel/"]').length`) > 1) break }
const out = await v.ev(`(() => {
  const links=[...new Set([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')||'').filter(h=>/\\/reel\\/\\d+/.test(h)))].slice(0,20);
  return {url:location.href, links, text:(document.body?document.body.innerText.slice(0,400):'')};
})()`)
console.log(JSON.stringify(out, null, 2))
v.ws.close(); app.ws.close()
