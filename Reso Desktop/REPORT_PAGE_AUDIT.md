# Audit & Perbaikan — Halaman Laporan (Harian / Mingguan / Bulanan)

**Tanggal:** 2026-11-23
**Metode:** review kode (`ReportControls`, 3 view laporan, `useReportState`, `useReportExports`) + inspeksi DOM langsung (CDP) pada app terpaket, kondisi kosong **dan** dengan 3 pegawai + data engagement.

---

## 1. Penilaian awal

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Konsistensi antar sub-tab | ★★☆☆☆ | Harian punya header H1, Mingguan/Bulanan tidak — kontrol bergeser **67 px**. |
| Hierarki & duplikasi teks | ★★☆☆☆ | Judul & tanggal muncul 2–3×; dua H1 di halaman. |
| Empty state | ★★☆☆☆ | Harian punya pesan, Mingguan/Bulanan tabel kosong + legenda "3 teratas/terbawah" tetap tampil. |
| Kontrol navigasi | ★★★☆☆ | Tombol "Berikutnya" Mingguan aktif saat data kosong, Harian/Bulanan tidak. |
| Kepadatan kontrol | ★★★☆☆ | `ReportControls` bertumpuk (navigasi + sortir + ekspor) pada lebar 1264 px. |

**Total: 2.8 / 5.**

---

## 2. Temuan & kritik

| # | Masalah | Bukti (sebelum) |
|---|---------|-----------------|
| L1 | **Header tidak konsisten antar sub-tab.** Harian: H1 "Laporan Harian" + subtitle; Mingguan/Bulanan: tidak ada. Posisi tombol navigasi: **y=118** (Harian) vs **y=51** (Mingguan/Bulanan). | DOM audit |
| L2 | **Dua H1 per halaman.** Harian: H1(page) + H3(sheet); Mingguan/Bulanan: H1(sheet) + H2(periode). | `heads: ["H1:Laporan Harian","H2:...","H3:Laporan Harian"]` |
| L3 | **Periode diulang 3×** di Harian: H2 "Senin, 23 November 2026", badge "Hari ini", subtitle sheet "Rekapitulasi Engagement • Senin, 23 November 2026". Bulanan: judul = subtitle. | DOM audit |
| L4 | **Mingguan/Bulanan tidak punya empty state di tabel.** `<tbody>` kosong, tetapi legenda "Keterangan: 3 teratas / 3 terbawah" tetap tampil. | `rows: 0`, legenda ada |
| L5 | **`canGoNextWeekly` salah saat data kosong.** `lastWeeklyISO ? … : true` → tombol "Berikutnya" aktif, beda dengan Harian/Bulanan. | Live: Mingguan next `disabled:false` |
| L6 | **Label "Gen: 23/11/2026" tidak jelas** dan diulang di ketiga sheet. | DOM audit |
| L7 | **`ReportControls` menumpuk**: `xl:flex-row` dengan breakpoint 1280 px, sehingga pada jendela 1264 px sortir turun ke baris kedua (y=200 vs y=118). Banyak kelas responsif usang (app desktop min-width 1024). | DOM audit |
| L8 | Copy "Belum ada data • Tambah pegawai untuk melihat laporan" diulang di kontrol **dan** subtitle sheet Mingguan. | DOM audit |

---

## 3. Perbaikan diterapkan

| # | Tindakan | File |
|---|----------|------|
| L1 | Header halaman **tunggal** untuk semua sub-tab: H1 "Laporan" + subtitle "Rekapitulasi engagement pegawai per periode", ditempatkan di `EngagementDashboard`. Blok H1 lama di Daily dihapus. | `EngagementDashboard.tsx`, `DailyReportView.tsx` |
| L1/L2 | Judul dokumen di sheet diseragamkan jadi **H2** di ketiga view. Hierarki: H1 "Laporan" → H2 periode → H2 dokumen. | 3 view |
| L3 | Bulanan: `subtitle` di `ReportControls` dihapus (judul sudah sama). Mingguan: subtitle sheet cukup rentang periode, bukan "Belum ada data • Tambah pegawai…". | `MonthlyReportView.tsx`, `WeeklyReportView.tsx` |
| L3 | Harian: subtitle sheet tetap memuat tanggal karena dibutuhkan dokumen ekspor. | `DailyReportView.tsx` |
| L4 | Empty-state row ditambahkan ke tabel Mingguan & Bulanan ("Belum ada data pegawai / Tambahkan pegawai di menu Data"). Legenda "3 teratas/terbawah" hanya tampil bila ada baris. | `WeeklyReportView.tsx`, `MonthlyReportView.tsx` |
| L5 | `canGoNextWeekly` default **false** saat tidak ada periode. | `useReportState.ts` |
| L6 | "Gen:" → "Dibuat" + `title="Tanggal pembuatan laporan"`. | 3 view |
| L7 | `ReportControls` disusun ulang: `flex flex-wrap items-center justify-between`, navigasi & (sortir+ekspor) sebaris tanpa breakpoint `xl`. Tombol ekspor jadi lebar natural (`px-4`), bukan `grid-cols-3 w-full`. | `ReportControls.tsx` |

---

## 4. Verifikasi langsung (CDP)

### Kondisi kosong
| Ukuran | Sebelum | Sesudah |
|--------|---------|---------|
| Posisi tombol navigasi | y=118 / y=51 (tidak konsisten) | **y=123 di semua sub-tab** ✅ |
| Tombol "Berikutnya" Mingguan | aktif | **disabled** ✅ |
| Heading | 2 H1 | **H1 "Laporan" + H2** ✅ |
| Empty state Mingguan/Bulanan | tabel kosong + legenda | **"Belum ada data pegawai"**, legenda hilang ✅ |
| Teks <11 px / overflow | 0 / 0 | **0 / 0** ✅ |

### Dengan 3 pegawai + engagement
| View | Baris | NaN | undefined | Overflow | Teks <11 px |
|------|-------|-----|-----------|----------|-------------|
| Harian | 3 | 0 | 0 | 0 | 0 |
| Mingguan | 3 | 0 | 0 | 0 | 0 |
| Bulanan | 3 | 0 | 0 | 0 | 0 |

`npx tsc --noEmit` ✅ · `npm test` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅ · bundle 1.315 → **1.316 KB**.

---

## 5. Saran lanjutan (belum diterapkan)

1. **Ringkasan metrik di header halaman** — saat ini % rate hanya ada di dalam "kertas" laporan. Kartu ringkas (rate rata-rata, pegawai teratas) di atas kontrol akan mempercepat scan tanpa membuka dokumen.
2. **Pemilih periode berbasis tanggal** — panah prev/next hanya bisa mundur/maju satu langkah. Date-picker untuk laporan harian & bulan tertentu mengurangi klik bila operator membuka rekap lama.
3. **Ekspor semua periode sekaligus** — PDF/Excel saat ini hanya periode tampak; opsi "Rentang kustom" berguna untuk audits bulanan.
4. **Legenda "% ENG"** — kolom ini tidak punya penjelasan cara hitung (3 platform × hari berlalu). Tooltip ringkas pada header kolom bisa mencegah salah tafsir.
5. **Sticky header tabel** — tabel bulanan dengan banyak pegawai sudah punya `sticky left-0` untuk kolom nama; `sticky top-0` pada `<thead>` akan membantu saat scroll vertikal.
