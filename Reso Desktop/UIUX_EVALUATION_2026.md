# Evaluasi UI/UX ReSo Desktop — 2026-11-22

**Metode:** audit DOM langungsung pada renderer Electron yang berjalan (CDP `Runtime.evaluate`, 8 layar), verifikasi silang dengan `UIUX_REDESIGN_PLAN.md`, `SCRAPER_AUDIT_DEEP.md`, dan screenshot uji langsung (`live-scraper.png`, `live-handoff.png`, `real-instagram.png`, `real2-*.png`, `new-*.png`). Skrip auditor: `scripts/ui-dom-audit.mjs`.
**Catatan:** pengukuran dilakukan pada profil uji (salinan userData) dengan data rekap minimal, sehingga perilaku *empty state* terlihat jelas.

---

## 1. Skor ringkas

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Konsistensi visual | ★★★★☆ | Slate + Geist, radius & shadow seragam; satu token platform/status. |
| Arsitektur informasi | ★★★★☆ | 5 nav + sub-tab, tidak ada pintu ganda; sub-tab belum punya *breadcrumb* teks di konten. |
| Efisiensi operasional | ★★★★☆ | Ctrl+N / Ctrl+S / 1-3, autosave draf, handoff scraper → rekap. |
| Aksesibilitas | ★★★★☆ | 0 tombol tanpa nama, 0 teks <11 px di 8 layar; hierarchy heading baru diseragamkan. |
| Kepadatan & scanning | ★★★☆☆ | Pengaturan sangat panjang (239 elemen), toolbar scraper 24 tombol. |
| Empty state & error | ★★★★☆ | "Belum ada data" jujur; perbaikan "undefined" dilakukan dalam evaluasi ini. |
| Responsivitas desktop | ★★★★★ | Target tetap 1024×640+, sidebar statis, tanpa sisa UI mobile. |

**Total: 3.8 / 5** — sudah solid untuk operator tunggal; sisa pekerjaan bersifat *polish*, bukan blocker.

---

## 2. Yang sudah baik (terverifikasi di DOM)

- **Teks data minimum 11 px** — `tinyCount = 0` di semua 8 layar.
- **Tombol semua bernama** — `unnamedButtons = 0` di semua layar (termasuk tombol ikon).
- **Tidak ada overflow horizontal** di 7 dari 8 layar; satu-satunya `truncate` di Pengaturan disengaja (path DB, dengan tombol salin).
- **Navigasi tunggal** — sidebar 5 item, sub-tab "Periode"/"Sumber" muncul kontekstual; tidak ada bottom nav / sheet duplikat.
- **Status & platform terpusat** — `PlatformBadge`, `EngagementStatus`, `platformLabels` dipakai lintas layar.
- **Empty state jujur** — "Belum ada data", "Tambah pegawai untuk melihat laporan", "Isi rekap untuk melihat tren interaksi".
- **Alur handoff tervalidasi** — klik "Masukkan ke rekap" memindah ke tab Rekap, membuka modal, dan menulis field platform yang benar (CDP test 8/8).

---

## 3. Temuan & perbaikan dalam evaluasi ini

| # | Severity | Temuan | Tindakan |
|---|----------|--------|----------|
| F1 | 🔴 | Judul laporan menampilkan literal **`Minggu ISO ke-undefined`** dan **`undefined undefined`** saat master pegawai kosong (`WeeklyReportView.tsx:49-50,73`; `MonthlyReportView.tsx:40,64`). | Fixed — fallback `Belum ada data` + `Tambah pegawai untuk melihat laporan`. |
| F2 | 🟠 | Beranda memiliki **dua H1** (`ReSo` sebagai brand + `Beranda` sebagai judul) — pembaca layar mendengar dua judul utama. | Fixed — brand jadi `<span aria-label="ReSo">`. |
| F3 | 🟠 | Laporan Mingguan/Bulanan hanya punya **H3**, Beranda/Harian punya H1 — hierarki tidak konsisten. | Fixed — H3 → H1 pada sheet laporan (kelas CSS tetap, visual tidak berubah). |
| F4 | 🟡 | Navigasi antar tab butuh ~1,5 detik karena `AnimatePresence mode="wait"` + lazy Suspense; pada audit 700 ms masih tampil konten lama. | Tidak diubah — durasi transisi memang disengaja (0,18 s × 2). Dicatat untuk QA. |
| F5 | 🟡 | Pengaturan adalah satu kartu sangat panjang (239 elemen, 6 input, 17 tombol) tanpa sub-navigasi. | **Fixed** — sub-tab Umum / Scraper / Data lokal. |
| F6 | 🟡 | Panel scraper punya 24 tombol; toolbar aksi berdesakan dalam satu baris. | **Fixed** — dua baris: aksi utama vs sekunder. |
| F7 | 🟡 | Grafik Beranda memakai tinggi tetap 280 px dengan legend + label sumbu Y rotated — rapat. | **Fixed** — 320 px, legenda di header kartu. |
| F8 | 🟢 | Tombol ekspor tetap aktif saat tidak ada data (klik hanya no-op). | **Fixed** — ekspor disabled saat 0 data. |

---

## 4. Rekomendasi prioritas (di luar yang sudah diperbaiki)

1. **P1 — Disable ekspor saat kosong** (F8): beri umpan balik, bukan diam.
2. **P2 — Pecah Pengaturan jadi sub-tab** (F5): mengurangi *scanning cost* operator.
3. **P2 — Regroup toolbar scraper** (F6): menurunkan cognitive load saat input harian.
4. **P3 — Chart breathing room** (F7): tinggi 300 px + legend di header.
5. **P3 — Audit kontras otomatis**: meski semua teks ≥11 px, kontras `slate-400` di `slate-50` masih borderline untuk pembaca low-vision; pertimbangkan `slate-500`.

---

## 5. Status tindak lanjut — SEMUA selesai

| Rekomendasi | Status | Bukti |
|-------------|--------|-------|
| F8 — Disable ekspor saat kosong | ✅ | `ReportControls.tsx`: `noData = employeeCount === 0`, 3 tombol ekspor `disabled` + `title` "Belum ada data untuk diekspor". CDP: `PDF:true, Excel:true, Gambar:true`. |
| F5 — Pengaturan terlalu panjang | ✅ | `SettingsTab.tsx`: sub-tab `Umum / Scraper / Data lokal` (`role="tab"`, `aria-selected`). CDP: perpindahan tab menampilkan seksi yang benar. |
| F6 — Toolbar scraper padat | ✅ | `ScraperTab.tsx`: dua baris — aksi utama (Proses/Hentikan/Tanggal/Masukkan) dan aksi sekunder (Bersihkan/Salin/A-Z/Sertakan balasan) dipisah garis. |
| F7 — Chart rapat | ✅ | `DashboardTab.tsx`: tinggi 280 → 320 px, legenda pindah ke header kartu via `PlatformBadge`; `EngagementChart.tsx`: `Legend` dihapus, margin bawah +8. |
| Kontras teks sekunder | ✅ | 70 occurence `text-slate-400` → `text-slate-500` di seluruh renderer (termasuk `placeholder`). |
| Bonus — mojibake `â€”` di Pengaturan | ✅ | Diperbaiki jadi `—`. |

Verifikasi ulang CDP: tab Pengaturan berfungsi, ekspor disabled saat 0 data, `undefined` = 0 di 8 layar, `tinyCount` = 0, `unnamedButtons` = 0.

## 6. Penyederhanaan tata letak final

- **Cabang mobile dihapus** (app min-width 1024): CTA duplikat di Beranda, daftar kartu di 3 view laporan, kartu "Aksi cepat" di kalender, dan semua kelas `hidden md:*` / `lg:hidden` / `md:hidden`.
- **Beranda**: satu header (H1 + satu CTA), grid stat 4 kolom tetap, chart 320 px dengan legenda di header kartu.
- **Data Pegawai**: toolbar satu baris (pencarian kiri, aksi kanan), placeholder search sesuai perilaku (9 field), empty state membedakan "kosong" vs "tidak cocok" + tombol hapus pencarian, H1 halaman ditambahkan.
- **Kalender Rekap**: legenda dipangkas 7 → 4 butir (Terisi, Perlu review, Terverifikasi, Belum terpetakan); ringkasan bulan tetap, "Aksi cepat" dihapus (duplikat sidebar).
- **Laporan Mingguan**: header wrap + `min-w-0` menghilangkan overflow 10 px.
- **Panel scraper**: lihat `FEATURE_REMOVAL_LOG.md` — tombol salin/handoff/tanggal/filter sudah dihapus karena handoff otomatis.

Hasil audit DOM ulang: 0 teks <11 px, 0 tombol tanpa nama, overflow tersisa hanya `truncate` path DB yang disengaja (ada `title`). Bundle renderer 1.352 KB → **1.340 KB**.

## 7. Verifikasi build

`npx tsc --noEmit` ✅ · `npm test` ✅ (termasuk 9 engine checks) · `npm run build` ✅ · `npm run build:desktop` ✅.

## 8. Update struktur navigasi (setelah evaluasi ini)

Catatan: bagian 1–7 adalah snapshot pada saat evaluasi. Struktur final setelah penyesuaian terakhir:

- **Rekap Harian** kini punya sub-tab `Kalender | Ambil Nama` — fitur scraping dipindah dari menu Data ke sini (alur: buka postingan → scrap → otomatis masuk rekap, jadi memang satu tempat dengan kalender).
- **Data** sekarang khusus master pegawai, **tanpa sub-tab** (semua entri lain dibuang).
- **Pengaturan** sudah dipangkas jadi **satu halaman tanpa tab**, hanya `Data` (cadangkan/pulihkan) + `Preferensi scraper`; Status DB, path, Tentang, dan pintasan scraper dihapus. Lihat `SETTINGS_AUDIT.md` bagian 7.
- Sub-tab yang tersisa: Laporan (`Periode`) dan Rekap Harian (`Tampilan`).

Uji CDP akhir: `Rekap Harian` → `["Kalender","Ambil Nama"]` + kalender; `Ambil Nama` → H1 scraper; `Data` → submenu `[]` + H1 `Data Pegawai`; Ctrl+N dari scraper → `Kalender` + modal input. Detail di `FEATURE_REMOVAL_LOG.md` bagian 8.
