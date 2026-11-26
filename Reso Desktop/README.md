# ReSo — Rekap Engagement Sosmed (Desktop Offline)

Aplikasi **desktop Windows** untuk merekap engagement pegawai ke media sosial
lembaga (Instagram, Facebook, TikTok). Berjalan **offline total**: tanpa login,
tanpa Firebase, tanpa server. Seluruh data disimpan lokal di mesin operator.

Sumber kebenaran produk: [`specify.md`](./specify.md) (keputusan #10–#12:
offline, SQLite lokal, scraping di aplikasi sendiri).

## Apa yang berubah dari versi web

| Dulu (web) | Sekarang (desktop) |
|------------|--------------------|
| Login Google + Firestore multi-tenant | Tanpa login; satu instalasi = satu operator |
| Data di `dinas/{uid}` (Firestore) | SQLite lokal di `app.getPath('userData')/reso.db` |
| Ekstensi Chrome ReSoEx | Scraper bawaan (Chromium Electron + `WebContentsView`) |
| Deploy Vercel + API Functions | Installer NSIS Windows (`ReSoSetup-<versi>.exe`) |
| Token sesi Firebase | Tidak ada — aplikasi offline tanpa login |

Direktori `api/`, `firestore.rules`, dan referensi Firebase lainnya adalah
**arsip versi web** dan bukan bagian aplikasi desktop.

## Fitur utama

- Master pegawai (CRUD, cari/urut, impor Excel/CSV, ekspor, template).
- Input rekap harian: teks mentah IG/FB/TikTok + link, hasil dari browser internal
  (opsional), matching nama/handle (termasuk akun ke-2).
- Ambil Nama: browser internal (Chromium Electron) untuk membuka postingan
  FB/IG/TikTok. Tiap halaman diberi tombol mengambang **Scrap** — klik setelah
  daftar komentar muncul untuk mengambil nama langsung, tanpa paste manual.
  Tombol **Proses halaman ini** tetap tersedia sebagai alternatif. Input manual
  TikTok juga tetap didukung penuh.
- Dashboard, laporan harian/mingguan/bulanan + ekspor PDF / gambar / Excel.
- Pengaturan lokal: preferensi scraper, cadangan/pulihkan data, info versi & lokasi DB.

## Menjalankan

Prasyarat: **Node.js 22+** dan npm.

```bash
npm install
npm run dev:desktop      # Electron + Vite (development)
```

Build & jalankan hasil build:

```bash
npm run build:desktop
npm run start:desktop
```

Buat installer Windows (output di folder `release/`):

```bash
npm run dist:win
```

## Data lokal

- Database: `%APPDATA%\reso\reso.db` (mengikuti `app.getPath('userData')`).
- Preferensi scraper: `settings.json` di folder `userData` yang sama.
- Semua akses data lewat IPC typed `window.reso` (preload `contextBridge`,
  `contextIsolation` + `sandbox` aktif). Payload divalidasi di main process.
- `better-sqlite3` v11.10 memakai prebuild khusus **Electron ABI 130**. Jalankan
  `npm run rebuild:native` (terautomatik di `npm run dist:win`) untuk mengunduh
  prebuild tersebut — tidak perlu Visual Studio.

Export/import seluruh data tersedia lewat layar Pengaturan (backup/restore).

## Script

| Command | Fungsi |
|---------|--------|
| `npm run dev:desktop` | Jalankan Electron mode dev |
| `npm run build:desktop` | Build main/preload/renderer ke `out/` |
| `npm run start:desktop` | Preview hasil build Electron |
| `npm run dist:win` | Build + paket installer NSIS (`release/`) |
| `npm run typecheck:desktop` | Typecheck main/preload (`electron/tsconfig.json`) |
| `npm test` | Semua unit test (matching, DB lokal, API, network) |
| `npm run test:stress` | Stress test matching ekstrem (lolos; dijalankan terpisah, **tidak** termasuk `npm test`) |
| `npm run dev` | Dev server Vite — **pratinjau web only**, bukan aplikasi desktop |
| `npm run build` | Typecheck + build Vite ke `dist/` — **pratinjau web**, bukan produk |
| `npm run preview` | Preview hasil build Vite di `dist/` — **pratinjau web only** |
| `npm run lint` | Typecheck via `tsc --noEmit` |
| `npm run clean` | Menghapus `dist/`, `out/`, dan `release/` |

## Arsitektur singkat

```
Renderer (React, src/)  ── window.reso (typed IPC) ──►  Main (electron/)
Dashboard • Rekap • Laporan • Pegawai • Ambil Nama • Pengaturan
                                                   • SQLite (repo data)
                                                   • RunController + ScraperHost
                                                   • electron-store (preferensi)
```

Struktur penting:

- `src/components/LocalProvider.tsx` — pengganti `FirebaseProvider`, identitas
  operator tetap (tanpa auth).
- `src/lib/local-db.ts` — shim API Firestore-like di atas IPC (`window.reso.data`).
- `electron/db/` — skema & repositori SQLite.
- `electron/ipc/` — kontrak payload + validasi.
- `electron/scrape/` — mesin scraping & state machine.

## Catatan

- Mode pengembangan: **penyempurnaan**, bukan rombak alur kerja operator.
- Skor engagement: biner per platform per hari (IG + FB + TikTok, maks 3/hari).
- Window operasional resmi Asia/Jakarta: reminder 14:45, batas rekap 15:00.
- Versi aplikasi tampil di sidebar & Pengaturan; dibaca dari `package.json`
  saat build — naikkan manual tiap rilis.
