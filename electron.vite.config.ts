import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

/**
 * ReSo Native — build desktop (dashboard renderer + Electron main/preload).
 * Renderer memakai root index.html + src/ (Vite React + Tailwind), sedangkan
 * main & preload dibangun dari electron/ secara terpisah.
 */
export default defineConfig({
main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // Kunci "index" wajib: electron-vite mengeluarkan out/main/index.js
        // (sesuai "main" di package.json + path preload di electron/main.ts).
        input: { index: resolve(__dirname, 'electron/main.ts') },
      },
    },
  },
preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') },
        output: {
          // Preload WAJIB CommonJS saat `sandbox: true` (ESM .mjs tidak dimuat
          // di sandboxed preload). Ekstensi .cjs memaksa CJS meski package.json
          // bertipe "module".
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // Sinkron dengan vite.config.ts (web) — src memakai import "@/lib/ui" dst.
        '@': resolve(__dirname, '.'),
      },
    },
    define: {
      // Sinkron dengan vite.config.ts (web) supaya Settings desktop menampilkan
      // versi rilisan, bukan hardcoded 'dev'.
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
  },
})