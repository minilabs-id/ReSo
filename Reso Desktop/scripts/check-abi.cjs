/**
 * Uji ABI better-sqlite3 di runtime Electron (main process).
 * Jalankan: node_modules\electron\dist\electron.exe scripts\check-abi.cjs
 *
 * Stdout Electron di Windows sering tidak terlihat dari shell, jadi hasil
 * ditulis ke `abi-result.txt` (JSON) di folder sementara sistem (os.tmpdir())
 * — itu bukti yang dibaca manusia, tanpa mengotori root repo.
 * Keluar 0 kalau modul termuat & query dasar jalan; selain itu keluar 1.
 */
const { app } = require('electron')
const { writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const OUT = join(tmpdir(), 'abi-result.txt')

function report(ok, detail) {
  try {
    writeFileSync(OUT, JSON.stringify({ ok, detail, abi: process.versions.modules }, null, 2))
  } catch (err) {
    // Tulis gagal (mis. folder read-only) — jangan sampai menutupi hasil uji.
    console.error('gagal menulis abi-result.txt:', err)
  }
}

// Jangan bergantung pada app.whenReady bila proses tidak di-bootstrap Electron
// (mis. dijalankan `node`): laporkan sebagai kegagalan yang jelas, bukan crash.
if (!app || typeof app.whenReady !== 'function') {
  report(false, { error: 'bukan runtime Electron — jalankan dengan electron.exe' })
  process.exit(1)
}

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t (a TEXT)')
    db.prepare('INSERT INTO t VALUES (?)').run('ok')
    const row = db.prepare('SELECT a FROM t').get()
    report(true, {
      electron: process.versions.electron,
      sqlite: db.prepare('SELECT sqlite_version() AS v').get().v,
      result: row.a,
    })
    db.close()
    app.exit(0)
  } catch (err) {
    report(false, { error: err && err.message ? err.message : String(err) })
    app.exit(1)
  }
})
