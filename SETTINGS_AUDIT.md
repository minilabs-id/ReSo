# Audit & Evaluasi UI/UX — Menu Pengaturan (ReSo Desktop)

**Tanggal:** 2026-11-22
**Metode:** review kode `SettingsTab.tsx`, `settings-schema.ts`, `settings-store.ts`, IPC `exportAll/importAll`, plus inspeksi DOM langsung pada 3 tab di app terpaket (CDP).
**Fokus:** kritik jujur + usulan desain ideal. Fitur token Meta API & kalkulasi ulang sudah dihapus sebelumnya.

---

## 1. Penilaian ringkas

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Hierarki & navigasi | ★★★☆☆ | 3 tab sudah ada, tapi tab "Umum" hampir kosong. |
| Efisiensi layout | ★★★☆☆ | Path DB & versi ditampilkan 3×/2×; kartu statis memakan ruang. |
| Keamanan data (backup/restore) | ★★★★☆ | Impor atomik & tervalidasi, konfirmasi ada — tapi minim preview. |
| Konsistensi | ★★★★☆ | Semua input berlabel, teks ≥11 px; dua defect encoding ditemukan. |
| Status perubahan | ★★☆☆☆ | Tidak ada dirty-check; edit bisa hilang tanpa konfirmasi. |

**Total: 3.2 / 5** — fungsional dan aman, tapi belum rapi dan belum "ideal".

---

## 2. Yang sudah baik

- **Sub-tab** `Umum / Scraper / Data lokal` mengurangi panjang halaman dibanding kartu tunggal.
- **Backup/restore** kuat: `exportAll()` menyertakan `employees + daily + settings + schemaVersion`; `importAll()` memvalidasi tiap entri, menolak daftar kosong, menimpa seluruh data dalam satu transaksi SQLite (termasuk `clearAllDaily()` agar tanggal basi tidak tertinggal).
- **Konfirmasi** untuk "Pulihkan data" dan "Pulihkan default" sudah ada.
- **Aksesibilitas**: semua input punya `aria-label`, tidak ada teks <11 px, tidak ada tombol tanpa nama.
- **Info versi & path DB** tersedia (bisa disalin).

---

## 3. Kritik (temuan)

### P1 — Harus diperbaiki

| # | Masalah | Bukti | Dampak |
|---|---------|-------|--------|
| K1 | **Field mati `instagramTemplateUrl`** masih di mirror renderer & UI, padahal sanitizer main sudah tidak mengenalinya. | `reso-bridge.ts` & `SettingsTab.tsx` (sebelum perbaikan) vs `settings-schema.ts` | Operator mengedit field yang hasilnya dibuang diam-diam. **Sudah saya hapus.** |
| K2 | **Mojibake `Â·`, `Menyimpanâ€¦`** terlihat di UI. | DOM live: `"0 pegawai Â· 2 hari…"`, `"Versi 1.0.86 Â· Electron…"` | Teks rusak, terlihat amateur. **Sudah saya perbaiki.** |
| K3 | **Path DB ditampilkan 3×** (tab Umum, Data lokal, Tentang); versi 2× (sidebar + Tentang). | DOM live | Redundansi visual, memakan ruang. |
| K4 | **Tab "Umum" hampir kosong** — hanya satu kartu status DB tanpa aksi. | DOM live: tab Umum = 0 button selain tab | Satu tab terbuang untuk konten yang bisa digabung. |
| K5 | **Tidak ada dirty-check** pada preferensi scraper. | `handleSaveScraperSettings` only on explicit save; pindah tab / reset langsung mengganti state | Edit hilang tanpa konfirmasi — kontras dengan modal input rekap yang punya guard. |
| K6 | **Konfirmasi restore tanpa pratinjau isi cadangan.** | `ConfirmDialog` hanya bilang "seluruh data akan ditimpa" | Operator tidak tahu jumlah pegawai/hari/settings yang akan dipulihkan → risiko salah berkas. |

### P2 — Sebaiknya diperbaiki

| # | Masalah | Bukti | Dampak |
|---|---------|-------|--------|
| K7 | **Statistik basi** — `refreshStats()` hanya saat mount & setelah import. | `SettingsTab.tsx:94-96,176` | Setelah scraping menambah rekap, jumlah "hari rekap" tidak berubah sampai halaman dibuka ulang. |
| K8 | **Kartu statis "Scraper bawaan sudah terpasang"** tidak pernah berubah. | `SettingsTab.tsx:396-411` | Informasi satu kalimat memakai komponen `SettingItem` penuh + ikon + tombol. |
| K9 | **`tiktokTemplateUrl` tidak dijelaskan** — ini fallback API, bukan URL postingan biasa. | UI hanya placeholder URL | Operator bisa mengisi URL post → tidak berguna. |
| K10 | **Input file tersembunyi** (`className="hidden"`) untuk "Pulihkan data" | `SettingsTab.tsx:443-451` | Tidak reachable via keyboard. |
| K11 | **Tombol "Simpan preferensi" selalu aktif** walau tidak ada perubahan. | `handleSaveScraperSettings` | Klik sia-sia; tidak ada indikator "Tersimpan". |
| K12 | **Nama file cadangan memakai tanggal UTC** (`toISOString().slice(0,10)`) | `handleExport` | Di sekitar tengah malam WIB, nama file bisa selisih 1 hari dari rekap. |
| K13 | `SectionHeader`, `SettingItem`, `NumberField` didefinisikan di dalam render | `SettingsTab.tsx:265-325` | Dibuat ulang tiap render (minor). |
| K14 | State tab tidak persisten | `useState('umum')` | Kembali ke "Umum" tiap kali membuka Pengaturan. |

---

## 4. Usulan desain ideal

### 4.1 Struktur: 2 tab, bukan 3

```
Pengaturan
├─ Umum
│   ├─ Status & statistik   (DB tersedia · N pegawai · N hari rekap · skema v1)
│   ├─ Penyimpanan          (path DB + tombol Salin — TUNGKAL di sini)
│   ├─ Cadangkan & pulihkan (2 tombol + pratinjau isi cadangan)
│   └─ Tentang              (logo · ReSo v1.0.86 · Electron 33 · status Lokal)
└─ Scraper
    ├─ Buka Ambil Nama (1 baris, bukan kartu penuh)
    ├─ Template TikTok (fallback lanjutan — dilipat / diberi penjelasan singkat)
    ├─ Putaran scroll · Jeda scroll · Batas waktu
    └─ [Simpan preferensi] [Pulihkan default]
```

Alasan: menghilangkan tab kosong, path/versi cukup sekali, dan semua aksi “Umum” benar-benar berguna.

### 4.2 Perilaku ideal

1. **Dirty-check preferensi**: state `isDirty` dari perbandingan `scraperSettings` vs `savedSnapshot`. Tampilkan badge "Ada perubahan belum disimpan"; blok/confirm saat pindah tab, klik "Pulihkan default", atau keluar halaman. Tombol Simpan aktif hanya saat `isDirty`.
2. **Pratinjau restore**: setelah memilih berkas, `ConfirmDialog` menampilkan ringkasan:
   `N pegawai · M hari rekap · K preferensi · versi skema V` + peringatan "semua data saat ini akan ditimpa".
   (Main sudah mengirim `stats` dari `importAll`; tinggal ditampilkan sebelum commit.)
3. **Statistik segar**: langganan `reso:db:changed` (sudah ada) → `refreshStats()` otomatis saat rekap bertambah.
4. **Tanggal cadangan WIB**: pakai `getWibDateParts()` untuk nama file `reso-cadangan-YYYY-MM-DD.json`.
5. **Akses keyboard**: ganti `input className="hidden"` dengan `sr-only` + `<label tabIndex=0 role=button onKeyDown>` atau tombol yang memanggil `.click()`.
6. **Ekstrak subkomponen** `SectionHeader`, `SettingItem`, `NumberField` ke luar `SettingsTab` (atau file terpisah) agar tidak dibuat ulang.
7. **Info scraper jadi satu baris**: "Scraper bawaan aktif · tanpa ekstensi" + tombol "Buka Ambil Nama" — tidak perlu kartu ikon penuh.
8. **Template TikTok** diberi label "Lanjutan — fallback bila browser tidak membuka komentar" dan ditempatkan di bawah 3 angka, opsional dilipat.
9. **Simpan otomatis preferensi** (debounced) bisa dipertimbangkan, tapi dengan undo/toast; jika tidak, pertahankan tombol Simpan + dirty indicator.

### 4.3 Prioritas eksekusi

| Prioritas | Item |
|-----------|------|
| P0 | K1–K2 (sudah), K3, K4, K5, K6 |
| P1 | K7, K8, K9, K10, K11, K12 |
| P2 | K13, K14 |

---

## 5. Status perbaikan langsung

- ✅ `instagramTemplateUrl` dihapus dari mirror renderer & UI (field mati, edit dibuang main).
- ✅ `user`/`db` yang tidak terpakai dihapus dari destructure.
- ✅ Mojibake `Â·` → `·`, `Menyimpanâ€¦` → `Menyimpan…`.

## 6. Rombakan menjadi satu halaman (diterapkan)

Sesuai permintaan, tab dihapus — semua pengaturan kini **satu halaman** yang bisa di-scroll:

```
Pengaturan
├─ Status & data lokal : status DB · N pegawai · N hari · skema v1
├─ Lokasi database     : path + tombol salin (SATU kali)
├─ Cadangkan & pulihkan: 2 tombol + input file sr-only (bisa di-tab)
├─ Scraper             : satu baris "Buka Ambil Nama"
├─ Preferensi scraper  : template TikTok + 3 angka + Simpan/Reset + indikator dirty
└─ Tentang             : logo · versi · Electron · "Lokal" (versi SATU kali)
```

Perbaikan yang ikut diterapkan:
- **K3** — path DB & versi tidak lagi duplikat (masing-masing sekali).
- **K4** — tab "Umum" yang kosong hilang; tidak ada tab sama sekali.
- **K5** — `isDirty` ditambahkan: tombol Simpan aktif hanya saat ada perubahan + label "Ada perubahan belum disimpan"; "Pulihkan default" tetap melalui konfirmasi.
- **K7** — statistik di-refresh otomatis lewat langganan `reso:db:changed` (scraping menambah rekap → jumlah hari langsung update).
- **K8** — kartu statis "Scraper bawaan" jadi satu baris ringkas.
- **K9** — template TikTok diberi label "(opsional)" + penjelasan fallback.
- **K10** — input file memakai `sr-only` (tidak lagi `hidden`), tetap bisa diakses keyboard.
- **K11** — Simpan disabled saat tidak ada perubahan.

Masih rekomendasi (belum diterapkan): **K6** pratinjau isi cadangan sebelum restore, **K12** nama file cadangan memakai tanggal WIB, **K13** ekstraksi subkomponen keluar render, **K14** state scroll/halaman (tidak relevan lagi karena tanpa tab).

## 7. Pemangkasan final — hanya pengaturan yang tersisa

Sesuai permintaan, semua konten yang **bukan pengaturan** dibuang dari halaman ini:

| Dibuang | Alasan |
|---------|--------|
| Status & statistik DB (jumlah pegawai/hari, skema) | Informasi, bukan preferensi — sudah tersedia di Beranda/laporan |
| Lokasi database + tombol salin path | Info teknis, bukan pengaturan |
| Seksi "Tentang" (logo, versi, Electron, badge Offline) | Versi sudah ada di sidebar |
| Pintasan "Buka Ambil Nama" | Duplikat sidebar → Rekap Harian → Ambil Nama |

**Yang tersisa:** `Data` (Cadangkan & Pulihkan — satu-satunya mekanisme backup, tetap dipertahankan) dan `Preferensi scraper` (template TikTok + 3 angka + Simpan/Reset + indikator dirty).

Halaman turun dari ~600 baris menjadi ~290 baris; bundle renderer 1.337 KB → **1.329 KB**. Semua dialog konfirmasi & validasi tetap ada.

Uji CDP: `h1: ["Pengaturan"]`, `hasStatus:false`, `hasPath:false`, `hasTentang:false`, `hasBukaScraper:false`, `hasBackup:true`, `hasPrefs:true`, `tiny:0`.

**Verifikasi akhir:** `npx tsc --noEmit` ✅ · `npm test` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅.
