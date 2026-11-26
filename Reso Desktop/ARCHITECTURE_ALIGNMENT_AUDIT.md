# Audit Keselarasan Arsitektur — ReSo Desktop

**Tanggal:** 2026-11-26
**Lokasi:** `D:\Github\ReSo\Reso Desktop` (satu repo dengan arsip web di parent)
**Metode:** penelusuran seluruh layer (main, preload, renderer, kontrak IPC, store, engine, build/packaging, skrip, dokumen) + verifikasi build & jalankan aplikasi dari folder baru.

---

## 1. Peta arsitektur saat ini

```
renderer (React, src/)
  ├─ src/lib/reso-bridge.ts   ← deklarasi window.reso (typed)
  ├─ src/lib/local-db.ts      ← shim Firestore-like di atas IPC
  ├─ src/features/*           ← hook pemilik data rekap & laporan
  └─ src/components/*         ← UI, satu navigation config (src/app/navConfig.tsx)
        │  IPC invoke/on (contextBridge)
        ▼
preload (electron/preload.ts) ── IPC.scrape/data/settings
        ▼
main (electron/main.ts)
  ├─ ipc/contracts.ts    ← nama channel + validasi payload
  ├─ ipc/run-controller  ← SATU pemilik state scraping
  ├─ scrape/*            ← ScraperHost, runner, engine IG/FB/TT, handoff
  ├─ store/*             ← electron-store (preferensi) + JSON state
  └─ db/*                ← SQLite (pegawai + rekap + settings lama)
        │
        └─ shared (src/shared/*) dipakai main & renderer — aturan tunggal
```

Build: `electron.vite.config.ts` → `out/` (produk desktop, dipakai `electron-builder.yml`).
Web: `vite.config.ts` → `dist/` (pratinjau, bukan produk).

---

## 2. Penilaian

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Kepemilikan state | ★★★★★ | Rekap = `useRekapData`; scraping = `runController`; tanggal = satu sumber. |
| Kontrak IPC | ★★★★☆ | Bridge ↔ preload ↔ handler selaras, kecuali satu deklarasi mati. |
| Pemisahan layer | ★★★★☆ | Main/renderer/shared jelas; shim Firestore disengaja sebagai kompatibilitas. |
| Keamanan | ★★★★☆ | `contextIsolation`, `sandbox`, `safeHandle` (sender = mainWindow), allowlist URL. |
| Konsistensi preferensi & backup | ★★☆☆☆ | **Dua store**, backup tidak memuat preferensi yang benar-benar dipakai. |
| Kebersihan pasca-pemisahan | ★★★☆☆ | Web pipeline, dependency mati, skrip extension, README usang masih tersisa. |

**Total: 3.6 / 5** — inti arsitektur sehat; yang bermasalah terutama lapisan pembungkus (backup, tooling, dokumentasi).

---

## 3. Temuan

### P0 — Harus diperbaiki

| # | Masalah | Bukti | Dampak |
|---|---------|-------|--------|
| A1 | **Backup tidak memuat preferensi scraper.** | `db.exportAll()` hanya `{employees, daily}` (`electron/db/database.ts:255`). `main.ts:255-257` menambahkan `settings` dari **tabel SQLite**, sedangkan preferensi yang dipakai UI ada di **`electron-store` (`settings.json`)**. `SettingsTab.tsx:235` menyatakan cadangan berisi "preferensi". | Restore tidak mengembalikan `homeUrl*`, `maxScrollRounds`, `scrollDelayMs`, `captureTimeoutMs`, `tiktokTemplateUrl`. Janji UI tidak benar. |
| A2 | **Restore menimpa settings SQLite yang tidak dipakai.** | `main.ts:296` `writeSettingValue(s.key, s.value)` menulis ke tabel `settings`; satu-satunya konsumen adalah shim `local-db` (`name === 'settings'`) yang **tidak dipakai UI mana pun**. | Data cadangan lama bisa membawa kunci basi (mis. `meta_api`) tanpa efek, tapi memberi ilusi tersimpan. |

### P1 — Sebaiknya diperbaiki

| # | Masalah | Bukti | Dampak |
|---|---------|-------|--------|
| A3 | **Pipeline web masih hidup di proyek desktop.** | `package.json` memuat `dev`, `build` (`vite build`), `preview`; `vite.config.ts` ada; README baris 81-83 mendokumentasikannya sebagai "pratinjau web only". | Dua konfigurasi build dengan alias/define ganda; `npm run build` menghasilkan `dist/` yang bukan produk. Risiko salah jalankan script. |
| A4 | **Skrip verifikasi CDP rusak setelah API disederhanakan.** | `scripts/live-check.mjs:85`, `live-handoff.mjs:77`, `live-ig-only.mjs:14`, `live-real2.mjs:44`, `live-tt-new.mjs:50` memanggil `window.reso.scrape.getState(...)` — method sudah dihapus dari preload & bridge. | Alat verifikasi tidak bisa dipakai; dokumentasi tanpa sengaja mengarah ke API mati. |
| A5 | **README usang.** | Baris 31 "Tombol Proses halaman ini" (sekarang "Ambil dari halaman ini"); baris 91 nav 6 item (sekarang 5 + sub-tab); baris 111 versi di Pengaturan (sudah dihapus); baris 110 reminder 14:45/batas 15:00 (tidak ada di kode); baris 79 test "API, network" (file test dihapus); baris 20-21 menyebut `api/` di dalam folder padahal sekarang di parent. | Dokumentasi tidak lagi menggambarkan produk. |
| A6 | **`sonner` masih jadi dependency.** | `package.json:44`, tidak ada import di `src` (hanya komentar di `src/lib/notify.ts:33`). | Paket mati; sedikit menambah ukuran install. |

### P2 — Perbaikan ringan / kebersihan

| # | Masalah | Bukti |
|---|---------|-------|
| A7 | `schemaVersion: 1` hardcode di `main.ts:257`, sementara `electron/db/schema.ts:13` punya `SCHEMA_VERSION = 1`. | Coupling tersembunyi; naik skema bisa lupa mengubah export. |
| A8 | Deklarasi `window.reso.app.getMeta` ada di bridge (`reso-bridge.ts:116`) tapi **tidak diexpose preload** dan tidak dipakai. | API phantom di tipe. |
| A9 | `assets/logo.svg` dan `src/assets/logo.svg` **identik (MD5 sama)**. | Duplikat aset; renderer memakai `src/`, packager memakai `assets/`. Bisa disatukan lewat alias/copy build. |
| A10 | `rebuild-native.cjs` memakai `@electron/rebuild` yang hanya tersedia **transitif** lewat electron-builder (`package-lock.json:1036`). | Fragile: perubahan dependency electron-builder bisa memutus `npm run dist:win`. |
| A11 | Sisa skrip extension/web: `compute_ext_id.py`, `package-ext.crx.ps1`, `fb-reels.mjs`, `find-targets2.mjs`, `generate-favicon.mjs`. | Tidak relevan dengan aplikasi desktop yang sudah dipisah. |
| A12 | Dua jalur akses data: shim `local-db.ts` (Firestore-like) dipakai 4 komponen, bridge `window.reso.data` langsung dipakai hook/Settings. | Disengaja & terdokumentasi, tapi menambah permukaan kognitif. Perlu dicatat sebagai *debt*, bukan bug. |
| A13 | `useAuth()`/`LOCAL_OPERATOR`/`LOCAL_DB` masih memakai kosakata auth/firestore walaupun offline. | Kompatibilitas lama; nama menyesatkan tapi perilaku benar. |

---

## 4. Yang sudah selaras (dipertahankan)

- **Satu sumber aturan**: `src/shared/{platform,state,messages,normalize,parsers,template,types}` dipakai main **dan** renderer — tidak ada duplikasi allowlist domain, state machine, atau format pesan.
- **Pemilik tunggal**: `useRekapData()` untuk pegawai+rekap; `runController` untuk scraping; `currentDailyDate` untuk tanggal aktif lintas menu.
- **IPC typed & divalidasi**: `safeHandle` menolak channel dari WebContents selain mainWindow; `parseEmployee*`, `parseDailyPatch`, `parseSetting*`, `parseBrowserBounds` memvalidasi payload.
- **State machine murni & teruji**: 41 checks `run-state`, 22 checks `engine-social`, 15 checks `engine-tiktok-logic`.
- **Jalur sesi login**: `persist:reso-<platform>`, cookie dipersist, UA konsisten, halaman awal tersimpan — sudah selaras dengan `electron-builder` (userData tidak dihapus saat upgrade).
- **Path pasca-pemisahan**: build & aplikasi terverifikasi jalan dari `Reso Desktop` (alias `@` → root folder baru, preload & assets tetap bersebelahan dengan `out/`).

---

## 5. Rekomendasi & prioritas

| Prioritas | Tindakan |
|-----------|----------|
| **P0** | A1+A2 — satukan backup: export/import **preferensi electron-store** (`getSettings`/`setSettings`) bersama data SQLite; hapus atau migrasi tabel `settings` lama; perbarui teks UI agar jujur. |
| **P1** | A3 — hapus pipeline web (`vite.config.ts`, script `dev`/`build`/`preview`, `dist/`) atau beri nama jelas `build:web` bila memang dipertahankan; A4 — perbaiki 5 skrip CDP ke `getAll()[platform]`; A5 — tulis ulang README sesuai kode; A6 — hapus `sonner`. |
| **P2** | A7 pakai `db.SCHEMA_VERSION`; A8 hapus `app.getMeta` dari tipe; A9 satukan logo; A10 tambahkan `@electron/rebuild` sebagai devDependency eksplisit; A11 pindahkan/hapus skrip extension ke arsip web di parent. |
| **P2 (debt)** | A12/A13 — rencanakan migrasi bertahap dari shim Firestore-like ke bridge `window.reso.data` langsung, dan ganti nama `useAuth` → `useLocal` bila tidak ada konsumen lama. |

### Urutan eksekusi disarankan
1. Backup/preferensi (A1/A2) — karena menyangkut kehilangan data operator.
2. README + skrip CDP (A5/A4) — murah, langsung memulihkan kepercayaan dokumentasi/tooling.
3. Bersihkan dependency & pipeline web (A3/A6).
4. Item P2 sisanya.

---

## 6. Verifikasi pendukung
- `npx tsc --noEmit` ✅ · `npm test` ✅ (9 kelas) · `npm run build` ✅ · `npm run build:desktop` ✅ dari folder baru.
- Aplikasi berjalan dari `Reso Desktop` dengan jendela & sesi normal ✅.
- `git diff --check` ✅ bersih pada commit pemisahan (`cbada21`).

## 7. Status perbaikan — SEMUA diterapkan

| # | Perbaikan | Bukti |
|---|-----------|-------|
| A1/A2 | `dbExportAll()` kini memuat `settings: getSettings()` (electron-store) + `legacySettings` (SQLite, kompatibilitas) + `schemaVersion: SCHEMA_VERSION`. `dbImportAll()` memulihkan preferensi lewat `restoreSettings()` yang baru, setelah transaksi SQLite berhasil. Teks UI Pengaturan diperbarui. | Uji CDP: export `maxScrollRounds=42, scrollDelayMs=850`; diubah ke 7/300; restore → **42/850** ✅ |
| A3 | Pipeline web dihapus: `vite.config.ts` & `dist/` dihapus; script `dev`/`preview` dicopot; `npm run build` sekarang = typecheck + `electron-vite build`; `dist:win` memakai `npm run build`. | `npm run build` ✅ menghasilkan `out/` saja |
| A4 | 5 skrip CDP (`live-check`, `live-handoff`, `live-ig-only`, `live-real2`, `live-tt-new`) memakai `getAll()[platform]`; label tombol di `live-check` diperbarui. | grep `scrape.getState` = 0 ✅ |
| A5 | README ditulis ulang: 5 menu + sub-tab, tombol "Ambil dari halaman ini", tanpa klaim versi di Pengaturan/reminder 14:45, lokasi arsip di parent, tabel script baru. | ✅ |
| A6 | Dependency `sonner` dihapus (`npm uninstall`). | package.json bersih ✅ |
| A7 | `schemaVersion` memakai `SCHEMA_VERSION` dari `electron/db/schema.ts`. | ✅ |
| A8 | `ResoAppMeta` & deklarasi `window.reso.app.getMeta` dihapus. | ✅ |
| A9 | `assets/logo.svg` duplikat dihapus (renderer memakai `src/assets/logo.svg`). | ✅ |
| A10 | `@electron/rebuild@3.6.1` jadi devDependency eksplisit. | ✅ |
| A11 | 5 skrip extension/web dipindah ke `D:\Github\ReSo\extension\scripts`. | ✅ |
| A13 | Hook `useAuth()` → `useLocal()` di 7 file; komentar LocalProvider disesuaikan. | `tsc` ✅ |

**A12 sengaja tidak diubah**: shim `src/lib/local-db.ts` adalah lapisan kompatibilitas yang terdokumentasi (4 komponen besar & ratusan titik pemanggilan). Menghapusnya adalah migrasi terpisah berisiko tinggi, bukan defect — tetap dicatat sebagai *debt* di README & dokumen ini.

**Verifikasi akhir:** `npx tsc --noEmit` ✅ · `npm run typecheck:desktop` ✅ · `npm test` ✅ (9 kelas) · `npm run build` ✅ · `npm run build:desktop` ✅ · uji CDP backup/restore preferensi ✅. Bundle renderer 1,263 → **1,264 KB**.
