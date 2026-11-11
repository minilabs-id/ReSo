/**
 * Rebuild better-sqlite3 untuk ABI Electron (Windows, tanpa CLI yargs).
 *
 * `npx electron-rebuild` GAGAL di repo ini: package.json bertipe "module"
 * sehingga CLI yargs-nya crash ("require is not defined in ES module scope").
 * Skrip ini memakai API @electron/rebuild langsung — tidak lewat CLI.
 *
 * Jalankan: node scripts/rebuild-native.cjs
 */
const path = require('path')
const { rebuild } = require(path.join(__dirname, '..', 'node_modules', '@electron', 'rebuild'))

async function main() {
  await rebuild({
    buildPath: path.join(__dirname, '..'),
    electronVersion: require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json'))
      .version,
    arch: process.arch,
    onlyModules: ['better-sqlite3'],
    force: true,
  })
  console.log('rebuild selesai')
}

main().catch((err) => {
  console.error('rebuild gagal:', err && err.message ? err.message : err)
  process.exit(1)
})
