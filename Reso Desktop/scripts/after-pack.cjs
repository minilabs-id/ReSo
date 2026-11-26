/**
 * electron-builder afterPack: tanamkan assets/icon.ico ke resource ReSo.exe.
 * Diperlukan karena signAndEditExecutable=false (winCodeSign butuh symlink),
 * sehingga rcedit tidak dijalankan electron-builder. Hook ini memanggil
 * rcedit-x64.exe langsung dari cache electron-builder.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function findRCedit(dir) {
  if (!fs.existsSync(dir)) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === 'rcedit-x64.exe') return full
    if (entry.isDirectory()) {
      const found = findRCedit(full)
      if (found) return found
    }
  }
  return null
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign')
  const rcedit = findRCedit(cache)
  if (!rcedit) {
    console.warn('[afterPack] rcedit-x64 tidak ditemukan; ikon exe memakai default Electron')
    return
  }
  const icon = path.join(__dirname, '..', 'assets', 'icon.ico')
  const product = context.packager.appInfo.productFilename || 'ReSo'
  const exe = path.join(context.appOutDir, `${product}.exe`)
  if (!fs.existsSync(exe) || !fs.existsSync(icon)) return
  execFileSync(rcedit, [exe, '--set-icon', icon], { stdio: 'ignore' })
  console.log('[afterPack] ikon ReSo ditanamkan ke', path.basename(exe))
}
