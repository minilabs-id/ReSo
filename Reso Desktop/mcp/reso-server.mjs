#!/usr/bin/env node
/**
 * ReSo MCP server (stdio, legacy MCP handshake).
 *
 * Mengontrol aplikasi ReSo yang berjalan lewat CDP renderer — agent tidak perlu
 * menulis skrip CDP ad-hoc lagi. Semua aksi memanggil bridge `window.reso`
 * yang sudah ada di aplikasi.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP_DIR = resolve(process.env.RESO_APP_DIR ?? join(process.cwd(), 'Reso Desktop'))
const EXE = process.env.RESO_EXE ?? join(APP_DIR, 'release', 'win-unpacked', 'ReSo.exe')
const ENTRY = join(APP_DIR, 'out', 'main', 'index.js')
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = Number(process.env.RESO_CDP_PORT ?? 9223)
const USER_DATA = process.env.RESO_USER_DATA ?? join(tmpdir(), 'reso-mcp-profile')
const BASE = `http://127.0.0.1:${PORT}`
const PLATFORMS = ['facebook', 'instagram', 'tiktok']

let renderer = null // { ws, ev, send }
let child = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpAlive() {
  try {
    const r = await fetch(`${BASE}/json/version`)
    return r.ok
  } catch {
    return false
  }
}

async function targets() {
  return (await (await fetch(`${BASE}/json/list`)).json())
}

const REQUEST_TIMEOUT_MS = 30_000

function attach(target) {
  return new Promise((resolveAttach, rejectAttach) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const timer = setTimeout(() => rejectAttach(new Error('CDP attach timeout')), REQUEST_TIMEOUT_MS)
    ws.onerror = () => {
      clearTimeout(timer)
      rejectAttach(new Error('CDP WebSocket error'))
    }
    ws.onopen = () => {
      clearTimeout(timer)
      let seq = 0
      const pending = new Map()
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.id && pending.has(m.id)) {
          const { res, timer: t } = pending.get(m.id)
          clearTimeout(t)
          res(m.result)
          pending.delete(m.id)
        }
      }
      ws.onclose = () => {
        for (const { res, timer: t } of pending.values()) {
          clearTimeout(t)
          res({ __resoClosed: true })
        }
        pending.clear()
      }
      const send = (method, params = {}) =>
        new Promise((res) => {
          const id = ++seq
          const timer = setTimeout(() => {
            pending.delete(id)
            res({ __resoTimedOut: true })
          }, REQUEST_TIMEOUT_MS)
          pending.set(id, { res, timer })
          ws.send(JSON.stringify({ id, method, params }))
        })
      const ev = (expression) =>
        send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(
          (r) => {
            if (r?.__resoClosed || r?.__resoTimedOut) {
              throw new Error('Koneksi renderer ReSo terputus — ulangi perintah')
            }
            return r?.result?.value
          }
        )
      resolveAttach({ ws, ev, send })
    }
  })
}

async function ensureApp() {
  if (await cdpAlive()) return 'already-running'
  const exe = existsSync(EXE) ? EXE : ELECTRON
  const args = existsSync(EXE)
    ? [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`]
    : [`"${ENTRY}"`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`]
  child = spawn(exe, args, { cwd: APP_DIR, detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    if (await cdpAlive()) return 'launched'
  }
  throw new Error('ReSo gagal berjalan dengan CDP — cek RESO_EXE / RESO_CDP_PORT')
}

async function getRenderer() {
  await ensureApp()
  let stale = !renderer || renderer.ws.readyState !== WebSocket.OPEN
  if (!stale) {
    try {
      const list = await targets()
      const found = list.find((x) => x.url.includes('out/renderer') || x.url.includes('index.html'))
      stale = !found || found.id !== renderer.id
    } catch {
      stale = true
    }
  }
  if (stale) {
    if (renderer) {
      try { renderer.ws.close() } catch {}
      renderer = null
    }
    const list = await targets()
    const target = list.find((x) => x.url.includes('out/renderer') || x.url.includes('index.html'))
    if (!target) throw new Error('Renderer ReSo tidak ditemukan')
    renderer = await attach(target)
    renderer.id = target.id
  }
  return renderer
}

function assertPlatform(p) {
  if (!PLATFORMS.includes(p)) throw new Error(`platform harus salah satu: ${PLATFORMS.join(', ')}`)
  return p
}

function trustedClick(source, label) {
  return source.send('Runtime.evaluate', {
    expression: `(() => {
      const b=[...document.querySelectorAll(${JSON.stringify(source)})].find(x => x.textContent.includes(${JSON.stringify(label)}));
      if(!b) return false;
      b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect();
      window.__resoClickPoint={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
      return true;
    })()`,
    returnByValue: true,
  }).then(async (r) => {
    if (!r?.result?.value) return false
    const point = await source.send('Runtime.evaluate', {
      expression: 'window.__resoClickPoint',
      returnByValue: true,
    })
    const { x, y } = point.result.value
    await source.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await source.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await source.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    return true
  })
}

async function openPanel(r) {
  await trustedClick(r, 'nav[aria-label="Menu utama"] button', 'Rekap Harian')
  await sleep(500)
  await trustedClick(r, 'nav[aria-label="Sub-menu"] button', 'Ambil Nama')
  await sleep(1800)
}

const tools = [
  {
    name: 'reso_status',
    description: 'Status aplikasi ReSo: state scraping per platform & URL browser internal.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await getRenderer()
      const states = await r.ev(`(async()=>await window.reso.scrape.getAll())()`)
      const urls = {}
      for (const p of PLATFORMS) urls[p] = await r.ev(`window.reso.browser.getUrl(${JSON.stringify(p)})`)
      return { states, urls }
    },
  },
  {
    name: 'reso_open',
    description: 'Buka panel Ambil Nama dan pilih platform (facebook|instagram|tiktok).',
    inputSchema: {
      type: 'object',
      properties: { platform: { type: 'string', enum: PLATFORMS } },
      required: ['platform'],
    },
    run: async ({ platform }) => {
      assertPlatform(platform)
      const r = await getRenderer()
      await openPanel(r)
      const label = platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'TikTok'
      const clicked = await trustedClick(r, '[aria-label="Pilih platform"] button', label)
      await sleep(2500)
      return { platform, clicked }
    },
  },
  {
    name: 'reso_navigate',
    description: 'Arahkan browser internal ReSo ke URL postingan/platform tertentu.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        url: { type: 'string' },
      },
      required: ['platform', 'url'],
    },
    run: async ({ platform, url }) => {
      assertPlatform(platform)
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('URL harus https')
      const r = await getRenderer()
      await r.ev(`window.reso.browser.navigate(${JSON.stringify(platform)},${JSON.stringify(url)})`)
      await sleep(6000)
      return { platform, url: await r.ev(`window.reso.browser.getUrl(${JSON.stringify(platform)})`) }
    },
  },
  {
    name: 'reso_scrape',
    description: 'Jalankan scraping pada platform dan tunggu hasil akhir (nama masuk rekap otomatis).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        includeReplies: { type: 'boolean', default: false },
        timeoutSec: { type: 'number', default: 180 },
      },
      required: ['platform'],
    },
    run: async ({ platform, includeReplies = false, timeoutSec = 180 }) => {
      assertPlatform(platform)
      const r = await getRenderer()
      const runId = `mcp_${platform}_${Date.now()}`
      await r.ev(
        `window.reso.scrape.applyEvent(${JSON.stringify(platform)},{type:'START',runId:${JSON.stringify(runId)},includeReplies:${includeReplies}})`
      )
      let st
      for (let i = 0; i < Math.min(timeoutSec, 600); i++) {
        await sleep(1000)
        st = await r.ev(`(async()=>{const a=await window.reso.scrape.getAll();return a[${JSON.stringify(platform)}]})()`)
        if (st && st.status !== 'running' && st.status !== 'idle') break
      }
      return {
        platform,
        runId,
        status: st?.status,
        count: st?.names?.length ?? st?.count ?? 0,
        message: st?.message,
        names: (st?.names ?? []).slice(0, 30),
      }
    },
  },
  {
    name: 'reso_stop',
    description: 'Hentikan scraping platform yang sedang berjalan.',
    inputSchema: {
      type: 'object',
      properties: { platform: { type: 'string', enum: PLATFORMS } },
      required: ['platform'],
    },
    run: async ({ platform }) => {
      assertPlatform(platform)
      const r = await getRenderer()
      const current = await r.ev(`(async()=>{const a=await window.reso.scrape.getAll();return a[${JSON.stringify(platform)}]})()`)
      if (!current?.runId) return { platform, stopped: false, reason: 'tidak ada run aktif' }
      await r.ev(
        `window.reso.scrape.applyEvent(${JSON.stringify(platform)},{type:'STOP',runId:${JSON.stringify(current.runId)}})`
      )
      return { platform, stopped: true }
    },
  },
  {
    name: 'reso_rekap',
    description: 'Ambil rekap harian (teks mentah, ID engaged, unmatched) untuk tanggal WIB.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD; kosong = hari ini WIB' } },
    },
    run: async ({ date }) => {
      const r = await getRenderer()
      const iso = date || (await r.ev(`new Date(Date.now()+7*3600*1000).toISOString().slice(0,10)`))
      const daily = await r.ev(`window.reso.data.getDaily(${JSON.stringify(iso)})`)
      return { date: iso, daily }
    },
  },
  {
    name: 'reso_employees',
    description: 'Daftar pegawai master dari database lokal ReSo.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await getRenderer()
      const all = await r.ev(`window.reso.data.exportAll()`)
      return { employees: all?.employees ?? [] }
    },
  },
  {
    name: 'reso_settings',
    description: 'Baca atau ubah preferensi scraper ReSo.',
    inputSchema: {
      type: 'object',
      properties: { patch: { type: 'object', description: 'Patch pengaturan; kosong = hanya baca' } },
    },
    run: async ({ patch }) => {
      const r = await getRenderer()
      if (patch && Object.keys(patch).length) {
        await r.ev(`window.reso.settings.set(${JSON.stringify(patch)})`)
      }
      return { settings: await r.ev(`window.reso.settings.get()`) }
    },
  },
  {
    name: 'reso_error_log',
    description: 'Ambil log error lokal ReSo (baris terakhir).',
    inputSchema: { type: 'object', properties: { lines: { type: 'number', default: 40 } } },
    run: async ({ lines = 40 }) => {
      const r = await getRenderer()
      const text = await r.ev(`window.reso.app.getErrorLog()`)
      return { log: String(text ?? '').split('\n').slice(-lines).join('\n') }
    },
  },
]

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.method === 'initialize') {
      reply(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'reso', version: '1.0.0' },
      })
      continue
    }
    if (msg.method === 'notifications/initialized' || msg.method === 'initialized') continue
    if (msg.method === 'ping') {
      reply(msg.id, {})
      continue
    }
    if (msg.method === 'tools/list') {
      reply(msg.id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      })
      continue
    }
    if (msg.method === 'tools/call') {
      const tool = tools.find((t) => t.name === msg.params?.name)
      if (!tool) {
        reply(msg.id, { content: [{ type: 'text', text: `tool tidak ditemukan: ${msg.params?.name}` }], isError: true })
        continue
      }
      try {
        const result = await tool.run(msg.params.arguments ?? {})
        reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      } catch (err) {
        reply(msg.id, {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        })
      }
      continue
    }
    if (msg.id !== undefined) fail(msg.id, -32601, `method not found: ${msg.method}`)
  }
})
