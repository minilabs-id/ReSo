/**
 * Buat assets/icon.ico untuk electron-builder (Windows) dari logo ReSo.
 * electron-builder mengabaikan PNG pada opsi win.icon dan jatuh ke ikon
 * default Electron, jadi harus memakai .ico eksplisit.
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const root = path.join(__dirname, '..')
const source = path.join(root, 'assets', 'icons', 'icon256.png')
const target = path.join(root, 'assets', 'icon.ico')

async function main() {
  const entries = []
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const data = await sharp(source).resize(size, size).png().toBuffer()
    entries.push({ size, data })
  }
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = 6 + entries.length * 16
  const dir = Buffer.alloc(entries.length * 16)
  entries.forEach((e, i) => {
    const o = i * 16
    dir[o] = e.size >= 256 ? 0 : e.size
    dir[o + 1] = e.size >= 256 ? 0 : e.size
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(e.data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += e.data.length
  })
  fs.writeFileSync(target, Buffer.concat([header, dir, ...entries.map((e) => e.data)]))
  console.log('assets/icon.ico', fs.statSync(target).size, 'bytes')
}
main().catch((e) => { console.error(e); process.exit(1) })
