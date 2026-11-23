// Cari kandidat postingan lain dari halaman yang sudah login.
const PORT = 9223
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function connect(url) {
  return new Promise(async (resolve) => {
    const ws = new WebSocket(url); await new Promise((r) => { ws.onopen = r })
    let seq = 0; const p = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id) } }
    const ev = async (e) => (await new Promise((r) => { const id = ++seq; p.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true } })) })).result.value
    resolve({ ws, ev })
  })
}
const app = await connect((await list()).find((t) => t.url.includes('out/renderer')).webSocketDebuggerUrl)

const targets = [
  { platform: 'facebook', url: 'https://www.facebook.com/KominfoJember', match: 'facebook.com' },
  { platform: 'instagram', url: 'https://www.instagram.com/', match: 'instagram.com' },
  { platform: 'tiktok', url: 'https://www.tiktok.com/@tiktok', match: 'tiktok.com' },
]
for (const cfg of targets) {
  await app.ev(`window.reso.browser.openBrowser(${JSON.stringify(cfg.platform)}, {x:80,y:80,width:1100,height:760})`, true)
  await app.ev(`window.reso.browser.navigate(${JSON.stringify(cfg.platform)}, ${JSON.stringify(cfg.url)})`, true)
  let v = null
  for (let i = 0; i < 16; i++) {
    await sleep(3000)
    const t = (await list()).find((x) => x.url.includes(cfg.match))
    if (!t) continue
    v = await connect(t.webSocketDebuggerUrl)
    const n = await v.ev(`document.querySelectorAll('a').length`)
    if (n > 20) break
  }
  if (!v) { console.log(cfg.platform, 'NO VIEW'); continue }
  const code = cfg.platform === 'facebook'
    ? `(() => {
        const out=[];
        for (const a of document.querySelectorAll('a[href]')) {
          let h=a.getAttribute('href')||'';
          try { h=new URL(h, location.href).toString(); } catch(_) {}
          if (/facebook\\.com\\/(.*(posts|permalink\\.php|reel|story\\.php|photos))/.test(h)) {
            out.push({h:h.split('?')[0], text:(a.textContent||'').trim().slice(0,60)});
          }
        }
        const uniq=[...new Map(out.map(x=>[x.h,x])).values()].slice(0,20);
        return {url:location.href, text:(document.body?document.body.innerText.slice(0,200):''), links:uniq};
      })()`
    : cfg.platform === 'instagram'
      ? `(() => {
          const out=[...new Set([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')||'').filter(h=>/^\\/(p|reel|tv)\\//.test(h)))].slice(0,20).map(h=>'https://www.instagram.com'+h);
          return {url:location.href, links:out};
        })()`
      : `(() => {
          const out=[...new Set([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')||'').filter(h=>/\\/@[^/]+\\/video\\//.test(h)))].slice(0,20).map(h=>'https://www.tiktok.com'+h);
          return {url:location.href, links:out};
        })()`
  console.log(cfg.platform, JSON.stringify(await v.ev(code), null, 2))
  v.ws.close()
}
app.ws.close()
