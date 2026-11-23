# Audit Sinkronisasi & Alur Seluruh Menu — ReSo Desktop

**Tanggal:** 2026-11-23
**Metode:** review seluruh state/navigasi (`EngagementDashboard`, `navConfig`, 3 feature hook, `InputModal`, `local-db`) + uji alur langsung via CDP pada app terpaket: pilih tanggal → pindah menu → ubah periode → guard modal.

---

## 1. Peta menu & status sebelum audit

```
Beranda            stats + chart 7 hari + CTA "Input rekap hari ini"
Rekap Harian ┬ Kalender   selectedDate (Lokal) + currentMonth (Lokal)
             └ Ambil Nama platform (module scope) + state scraper (main process)
Laporan      ┬ Harian     currentDailyDate (useReportState)  ← TERPUTUS dari selectedDate
             ├ Mingguan   currentWeekDate (useReportState)   ← independen
             └ Bulanan    currentMonthlyReportDate (hook)    ← TERPUTUS dari currentMonth
Data         Pegawai      employees (useRekapData, onSnapshot)
Pengaturan   Cadangan + preferensi scraper
```

Sumber data bersama: `useRekapData()` → `onSnapshot` pegawai & rekap; siaran `reso:db:changed` dari main (scraper handoff, import) → `emit()` → semua `onSnapshot` segar. **Ini sudah benar.**

---

## 2. Temuan (sebelum)

| # | Masalah | Bukti / dampak |
|---|---------|----------------|
| M1 | **Tanggal ganda & tidak tersinkron.** `selectedDate` di `EngagementDashboard` dipakai Kalender + InputModal + review; `currentDailyDate` di `useReportState` dipakai Laporan Harian + ekspor. Memilih 10 Nov di kalender tidak mengubah Laporan Harian (masih hari ini). | Alur "rekap harian → laporan" terputus; operator harus cari tanggal dua kali. |
| M2 | **Bulan ganda.** `currentMonth` (kalender) dan `currentMonthlyReportDate` (laporan) berdiri sendiri. | Kalender November, laporan bisa Oktober. |
| M3 | **Kalender tidak menandai tanggal aktif.** Prop `selectedDate` diterima `CalendarPanel` tetapi **tidak dipakai sama sekali**. | Operator tidak tahu tanggal mana yang sedang diedit. |
| M4 | **Pindah menu saat modal input terbuka membuang perubahan.** Guard dirty hanya dipasang pada Esc/back-button/X/Batal, bukan klik sidebar/sub-tab. Modal unmount saat `activeTab` berubah. | Input hilang tanpa konfirmasi. |
| M5 | **Sub-tab laporan tidak mengikuti konteks tanggal.** Klik "Mingguan"/"Bulanan" selalu membuka periode sesi sebelumnya, bukan minggu/bulan dari tanggal aktif. | Inkonsisten dengan alur harian. |
| M6 | **Scraper "Lihat rekap" tidak menyetel tanggal.** Kembali ke kalender dengan tanggal lama, padahal hasil handoff untuk hari ini. | Operator melihat rekap kosong. |
| M7 | Copy konfirmasi modal menyebut "ditarik" (sisa fitur Meta API yang sudah dihapus). | Teks usang. |

---

## 3. Perbaikan diterapkan

| # | Tindakan | File |
|---|----------|------|
| M1 | **Satu tanggal aktif**: `selectedDate` dihapus. `currentDailyDate` dari `useReportState` jadi sumber tunggal untuk Kalender, InputModal, UnmatchedReview, notifikasi auto-fill, dan Laporan Harian (+ ekspor). | `EngagementDashboard.tsx`, `useReportState.ts` |
| M1 | Panah prev/next di Laporan Harian kini ikut menggeser pilihan kalender (karena memakai state yang sama). | `useReportState.ts` |
| M2 | `changeMonth` (kalender) juga menyetel `currentMonthlyReportDate`; panah Bulanan juga menyetel `currentMonth`. Dua arah. | `EngagementDashboard.tsx` |
| M3 | `CalendarPanel` memakai `selectedDate`: `aria-current="date"` + ring pada tanggal aktif. | `CalendarPanel.tsx` |
| M4 | `InputModal.closeGuardRef` kini menerima callback `afterClose`; dipanggil **hanya setelah modal benar-benar tertutup**. `goToTab`, `switchRekapView`, `openInputForToday` memakai guard itu. `onCancel` konfirmasi membersihkan callback. | `InputModal.tsx`, `EngagementDashboard.tsx` |
| M5 | `openReportView(view)` dipakai sidebar sub-tab, keyboard 1/2/3, CTA Beranda, dan klik menu Laporan: Mingguan/Bulanan mengikuti tanggal aktif. | `EngagementDashboard.tsx` |
| M6 | "Lihat rekap" dari scraper menyetel tanggal ke hari ini sebelum pindah ke Kalender. | `EngagementDashboard.tsx` |
| M7 | Copy konfirmasi → "Perubahan pada rekap ini belum disimpan…". | `InputModal.tsx` |

State lain yang **sengaja tetap persisten** (tidak di-reset tiap pindah menu): `reportView`, `rekapView`, sort mode, platform scraper (module scope), state scraper (main process). Ini konsisten dengan perilaku sub-tab Laporan.

---

## 4. Verifikasi alur langsung (CDP)

| Skenario | Hasil |
|----------|-------|
| Kalender: klik **10 November 2026** → modal | Modal menampilkan "Selasa, 10 November 2026" ✅ |
| Lanjut ke **Laporan ▸ Harian** | Judul "Selasa, 10 November 2026" ✅ (sebelumnya tetap hari ini) |
| Klik **Sebelumnya** di Laporan Harian → kembali ke Kalender | Kalender menandai `aria-current="date"` = **9 November 2026** ✅ |
| Kalender menandai tanggal aktif | `aria-current="date"` ada, ring terlihat ✅ |
| Laporan ▸ Bulanan → **Sebelumnya** → kembali ke Kalender | Kalender: **November → Oktober 2026** ✅ |
| Modal input diubah, lalu klik sidebar **Data** | Dialog konfirmasi muncul, tidak pindah ✅ |
| Pilih **Kembali mengedit** | Tetap di modal ✅ |
| Klik Data lagi → **Buang perubahan** | Pindah ke Data Pegawai, modal tertutup ✅ |
| Semua menu | 0 teks <11 px, 0 overflow, data pegawai/rekap segar via `onSnapshot` ✅ |

`npx tsc --noEmit` ✅ · `npm test` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅ · bundle 1.316 → **1.318 KB**.

---

## 5. Saran lanjutan (belum diterapkan)

1. **Mingguan dua arah** — panah minggu di laporan belum menggeser tanggal aktif/kalender (baru kalender → minggu). Bila diinginkan, tambahkan `setCurrentDailyDate` saat `changeWeek`.
2. **Re-match otomatis saat master pegawai berubah** — engaged IDs dihitung ulang hanya saat input manual disimpan atau scraping ulang. Mengubah akun sosmed di menu Data tidak langsung memperbarui rekap lama. Butuh migrasi matching atau tombol "Hitung ulang pencocokan" (sebelumnya sengaja dihapus).
3. **Sinkronisasi filter sort** — sort mode Beranda/Laporan Harian/Bulanan masih lokal per hook; bisa disatukan bila operator memakai urutan yang sama di semua layar.
4. **Breadcrumb kontekstual** — sub-tab menampilkan "Periode"/"Tampilan" tanpa menyebut tanggal aktif; label seperti "Harian · 10 Nov" memperkuat rasa tersinkron.
5. **Deep-link state** — URL/hash tidak dipakai, sehingga refresh mengembalikan ke Beranda. Untuk desktop offline ini boleh diterima, tetapi state navigasi bisa dipersist ke `localStorage` bila diinginkan.
