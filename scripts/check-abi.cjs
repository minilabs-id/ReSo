/**
 * Uji ABI better-sqlite3 di runtime Electron (main process).
 * Jalankan: node_modules\electron\dist\electron.exe scripts\check-abi.cjs
 *
 * Stdout Electron di Windows sering tidak terlihat dari shell, jadi hasil
 * ditulis ke berkas `abi-result.txt` (JSON) — itu bukti yang dibaca manusia.
 * Keluar 0 kalau modul termuat & query dasar jalan; selain itu keluar 1.
 */
const { app } = require('electron')
const { writeFileSync } = require('fs')
const { join } = require('path')

const OUT = join(__dirname, '..', 'abi-result.txt')

function report(ok, detail) {
  writeFileSync(OUT, JSON.stringify({ ok, detail, abi: process.versions.modules }, null, 2))
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