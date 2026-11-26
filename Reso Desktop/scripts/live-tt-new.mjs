import fs from 'node:fs'
const LOG = 'C:\\Users\\zo\\AppData\\Local\\Temp\\opencode\\tt-progress.log'
const log = (s) => { const line = `${new Date().toISOString()} ${s}\n`; fs.appendFileSync(LOG, line); process.stdout.write(line) }
fs.writeFileSync(LOG, '')
const PORT = 9223
const list = async () => (await fetch(`http://127.0.0.1:9223/json/list`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function connect(url) {
  return new Promise(async (resolve) => {
    const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    let seq = 0; const p = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id) } }
    const send = (method, params = {}) => new Promise((r) => { const id = ++seq; p.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
    const ev = async (e, a = false) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: a })).result.value
    resolve({ ws, ev })
  })
}
try {
  const targets = await list()
  const app = await connect(targets.find((t) => t.url.includes('out/renderer')).webSocketDebuggerUrl)
  log('renderer connected')
  await app.ev(`window.reso.settings.set({maxScrollRounds:6, scrollDelayMs:900, captureTimeoutMs:40000})`, true)
  const url = 'https://www.tiktok.com/@tiktok/video/7710348513128828191'
  await app.ev(`window.reso.browser.openBrowser('tiktok', {x:80,y:80,width:1100,height:760})`, true)
  await app.ev(`window.reso.browser.navigate('tiktok', ${JSON.stringify(url)})`, true)
  log('navigated: ' + url)

  let v = null
  for (let i = 0; i < 20; i++) {
    await sleep(2000)
    const t = (await list()).find((x) => x.url.includes('/video/'))
    if (!t) { log(`wait ${i}: no video target`); continue }
    v = await connect(t.webSocketDebuggerUrl)
    const s = await v.ev(`({txt:(document.body?document.body.innerText.slice(0,60):''), btns:document.querySelectorAll('a,button,div[role="button"]').length})`)
    log(`wait ${i}: ${t.url} | ${JSON.stringify(s)}`)
    if (!s.txt.includes('Please wait...') && s.btns > 10) break
  }
  if (!v) throw new Error('video target tidak ditemukan')

  const clicked = await v.ev(`(() => { const icons=[...document.querySelectorAll('[data-e2e="comment-icon"]')]; icons.sort((a,b)=>{const n=(e)=>Number(((e.getAttribute('aria-label')||'').match(/(\\d+)\\s*comments?/i)||[])[1]||0); return n(b)-n(a);}); if(icons[0]){icons[0].click(); return icons[0].getAttribute('aria-label');} return null; })()`)
  log('clicked comment: ' + clicked)
  await sleep(3500)

  const runId = 'ttnew_' + Date.now()
  await app.ev(`window.reso.scrape.applyEvent('tiktok', {type:'START',runId:${JSON.stringify(runId)},includeReplies:false})`, true)
  log('START ' + runId)
  let st
  for (let i = 0; i < 25; i++) {
    await sleep(2000)
    st = await app.ev(`window.reso.scrape.getState('tiktok')`, true)
    log(`poll ${i}: ${st?.status} count=${st?.count}`)
    if (st && st.status !== 'running') break
  }
  log('RESULT ' + JSON.stringify({ status: st?.status, reason: st?.stopReason, count: st?.count, message: st?.message, names: st?.names }))
  try { const s = await v.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('C:\\Users\\zo\\AppData\\Local\\Temp\\opencode\\new-tiktok.png', Buffer.from(s.data, 'base64')); log('screenshot saved') } catch (e) { log('screenshot error ' + e) }
  app.ws.close(); v.ws.close()
} catch (e) {
  log('ERROR ' + String(e))
}
