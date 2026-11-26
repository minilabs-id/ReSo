# ReSo Desktop — Rekap Engagement Sosmed

Aplikasi **desktop Windows offline** untuk merekap engagement pegawai di Instagram,
Facebook, dan TikTok. Tanpa login aplikasi, tanpa Firebase, tanpa server — seluruh
data disimpan di mesin operator.

Proyek ini berada di `D:\Github\ReSo\Reso Desktop`. Arsip proyek web lama
(`api/`, `extension/`, `firebase*.json`, `vercel.json`, `public/`) ada di folder
induk `D:\Github\ReSo\` dan **bukan** bagian aplikasi desktop.

## Fitur

- **Master pegawai** — CRUD, cari/urut, impor Excel/CSV, ekspor, template.
- **Rekap Harian** — kalender + input manual (teks mentah IG/FB/TikTok).
- **Ambil Nama** (sub-tab Rekap Harian) — browser internal dengan tombol
  **Scrap** di halaman; nama otomatis masuk rekap & dicocokkan ke master pegawai.
  Input manual tetap tersedia di modal rekap.
- **Laporan** — harian/mingguan/bulanan + ekspor PDF, gambar, Excel.
- **Data** — khusus master pegawai.
- **Pengaturan** — preferensi scraper + cadangan/pulihkan data.
- Sesi login sosmed dipertahankan (cookie persisten), dengan halaman awal yang
  bisa diatur ke profil/postingan sendiri lewat tombol **Bookmark** di browser.

## Menjalankan

Prasyarat: Node.js 22+ dan npm, dijalankan dari folder `Reso Desktop`.

```bash
npm install
npm run dev:desktop     # Electron + Vite (development)

npm run build           # typecheck + build ke out/
npm run start:desktop   # preview hasil build

npm run dist:win        # installer NSIS ke release/
```

> Tidak ada pipeline web. `npm run build` menghasilkan aplikasi desktop, bukan
> bundle `dist/`.

## Data lokal

| Jenis | Lokasi | Diakses lewat |
|-------|--------|---------------|
| Pegawai & rekap harian | `%APPDATA%\reso\reso.db` (SQLite) | `window.reso.data` |
| Preferensi scraper | `%APPDATA%\reso\settings.json` | `window.reso.settings` |
| State scraping | `%APPDATA%\reso\scrape-state.json` | main process (`runController`) |
| Sesi login sosmed | partisi `persist:reso-<platform>` | browser internal |

Semua akses melewati IPC typed `window.reso` (preload `contextBridge`,
`contextIsolation` + `sandbox` aktif). Payload divalidasi di main process.
Cadangan JSON di menu Pengaturan memuat pegawai, rekap, preferensi scraper, dan
(untuk kompatibilitas) kunci SQLite lama.

`better-sqlite3` 11.10 memakai prebuild Electron ABI 130; `npm run dist:win`
menjalankan `npm run rebuild:native` lebih dulu. Tidak butuh Visual Studio.

## Auto-update

Aplikasi hasil build (packaged) otomatis memeriksa rilis terbaru di
[GitHub Releases](https://github.com/minilabs-id/ReSo/releases) setiap kali
dibuka (jeda 4 detik agar startup tetap cepat). Bila ada versi baru, update
diunduh otomatis dan tombol **"pasang sekarang"** muncul di footer sidebar.
Mode development tidak melakukan pengecekan.

## Arsitektur

```
Renderer (React, src/)
  ├─ src/lib/reso-bridge.ts   deklarasi typed window.reso
  ├─ src/lib/local-db.ts      shim Firestore-like di atas IPC (kompatibilitas)
  ├─ src/features/*           hook pemilik rekap & laporan
  └─ src/components/*         UI + src/app/navConfig.tsx (navigasi tunggal)
        │  IPC invoke/on
        ▼
Preload (electron/preload.ts)
        ▼
Main (electron/main.ts)
  ├─ ipc/contracts.ts     validasi channel & payload
  ├─ ipc/run-controller   pemilik tunggal state scraping
  ├─ scrape/*             ScraperHost, runner, engine IG/FB/TikTok, handoff
  ├─ store/*              preferensi + state JSON
  └─ db/*                 skema & repositori SQLite
```

Aturan bersama (allowlist domain, state machine, pesan, parser) ada di
`src/shared/` dan dipakai **main dan renderer** — satu sumber kebenaran.
Detail audit arsitektur: [`ARCHITECTURE_ALIGNMENT_AUDIT.md`](./ARCHITECTURE_ALIGNMENT_AUDIT.md).

## Script

| Command | Fungsi |
|---------|--------|
| `npm run dev:desktop` | Jalankan Electron mode dev |
| `npm run build` | Typecheck + build desktop ke `out/` |
| `npm run build:desktop` | Build desktop langsung |
| `npm run start:desktop` | Preview hasil build |
| `npm run dist:win` | Build + paket installer NSIS (`release/`) |
| `npm run rebuild:native` | Rebuild `better-sqlite3` untuk ABI Electron |
| `npm run typecheck:desktop` | Typecheck main/preload |
| `npm test` | Seluruh unit test |
| `npm run test:stress` | Stress test matching (dijalankan terpisah) |
| `npm run clean` | Hapus `out/` dan `release/` |

## Catatan

- Skor engagement biner per platform per hari (IG + FB + TikTok, maks 3/hari).
- Versi aplikasi dibaca dari `package.json` saat build dan tampil di sidebar.
- Naikkan versi di `package.json` tiap rilis.
