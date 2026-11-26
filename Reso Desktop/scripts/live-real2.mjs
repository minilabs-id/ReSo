const PORT = 9223
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function connect(url) {
  return new Promise(async (resolve) => {
    const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    let seq = 0; const p = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id) } }
    const send = (method, params = {}) => new Promise((r) => { const id = ++seq; p.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
    const ev = async (e, awaitPromise = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
    resolve({ ws, send, ev })
  })
}
const app = await connect((await list()).find((t) => t.url.includes('out/renderer')).webSocketDebuggerUrl)
await app.ev(`window.reso.settings.set({maxScrollRounds:6, scrollDelayMs:900, captureTimeoutMs:45000})`, true)

const POSTS = {
  instagram: { url: 'https://www.instagram.com/p/Df5WFYiJXmA/', match: 'instagram.com/p/' },
  tiktok: { url: 'https://www.tiktok.com/@desajember/video/7677158485993377044', match: '/video/' },
}
const out = {}
for (const [platform, cfg] of Object.entries(POSTS)) {
  await app.ev(`window.reso.browser.openBrowser(${JSON.stringify(platform)}, {x:80,y:80,width:1100,height:760})`, true)
  await app.ev(`window.reso.browser.navigate(${JSON.stringify(platform)}, ${JSON.stringify(cfg.url)})`, true)
  let view = null, url = ''
  for (let i = 0; i < 20; i++) {
    await sleep(3000)
    const t = (await list()).find((x) => x.url.includes(cfg.match))
    if (!t) continue
    view = await connect(t.webSocketDebuggerUrl)
    url = t.url
    const ready = await view.ev(`({txt:(document.body?document.body.innerText.slice(0,80):''),buttons:document.querySelectorAll('button,div[role="button"],[aria-label]').length})`)
    if (!ready.txt.includes('Please wait...') && ready.buttons > 10) break
  }
  if (!view) { out[platform] = { error: 'target tidak ditemukan' }; continue }
  await view.send('Page.enable')
  await view.ev(`(() => { for (const e of document.querySelectorAll('button,[role="button"],a,div,[aria-label],[data-e2e]')) { const t=(e.textContent||'').trim(); if (/^(comments?|komentar|\\d+\\s*comments?)$/i.test(t)) { try{e.click();return true;}catch(_){} } } return false; })()`)
  await sleep(2500)
  const runId = `r2_${platform}_${Date.now()}`
  await app.ev(`window.reso.scrape.applyEvent(${JSON.stringify(platform)}, {type:'START',runId:${JSON.stringify(runId)},includeReplies:false})`, true)
  let st = null
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    st = await app.ev(`(async()=>{const a=await window.reso.scrape.getAll();return a[${JSON.stringify(platform)}]})()`, true)
    if (st && st.status !== 'running') break
  }
  out[platform] = { url, status: st?.status, reason: st?.stopReason, count: st?.count, message: st?.message, names: (st?.names || []).slice(0, 20) }
  try { const s = await view.send('Page.captureScreenshot', { format: 'png' }); const fs = await import('node:fs'); fs.writeFileSync(`C:\\Users\\zo\\AppData\\Local\\Temp\\opencode\\real2-${platform}.png`, Buffer.from(s.data, 'base64')) } catch {}
  view.ws.close()
}
console.log(JSON.stringify(out, null, 2))
app.ws.close()
