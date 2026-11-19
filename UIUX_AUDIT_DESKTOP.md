# UI/UX Audit — ReSo Desktop (offline, v1.0.86)

**Tanggal:** 2026-11-19
**Lingkup:** aplikasi Electron terpaket (`release/win-unpacked/ReSo.exe`), renderer `src/`, konfigurasi jendela `electron/main.ts`.
**Metode:** (1) audit kode statis komponen UI, (2) inspeksi langsung app terpaket lewat CDP pada viewport **1280×800** dan **960×640** (batas `minWidth`), dengan data contoh 8 pegawai + 12 hari rekap.
**Catatan:** `UIUX_AUDIT.md` adalah audit era web/Firebase dan sudah tidak menggambarkan produk saat ini.

---

## 1. Ringkasan eksekutif

Tidak ada blocker fungsional yang membuat app tidak bisa dipakai. Namun ada **5 masalah P1** yang langsung terlihat operator dan sebaiknya diperbaiki sebelum rilis berikutnya:

1. **Logo rusak di semua layar** (path absolut `/logo.svg` tidak valid di `file://`), termasuk logo di ekspor PDF.
2. **Tombol `default` tidak punya latar** (`bg-primary` tidak terdaftar di theme) — CTA utama ScraperTab tampak seperti teks biasa.
3. **Nomor baris tabel pegawai mulai dari 2** (double `+1`), padahal pagination bilang “1–8 dari 8”.
4. **Pengaturan tidak punya backup/restore & lokasi DB**, padahal README menjanjikannya dan satu-satunya data ada di mesin itu.
5. **Sisa kosakata web** di UI: “login”, “ke server”, “Rekap + Kirim”, menu instal ekstensi yang sudah pensiun.

Selain itu, alur input punya **jalur kehilangan data** (Esc/backdrop menutup modal tanpa konfirmasi walau ada dirty-check untuk kasus lain), dan jendela 960–1023 px menampilkan tampilan “mobile” di desktop.

---

## 2. Temuan prioritas P1

### P1-1 — Logo tidak tampil (branding + PDF)
- **Bukti visual:** di sidebar, Pengaturan, dan splash, logo tampil sebagai ikon gambar rusak + teks alt “ReSo”. CDP: `src="/logo.svg"` → `file:///D:/logo.svg`, `naturalWidth = 0`.
- **Kode:** `src/hooks/useAppLogo.ts:6-8`; pemakaian `EngagementDashboard.tsx:1362`, `SettingsTab.tsx:388`, fetch logo PDF `EngagementDashboard.tsx:831`.
- **Dampak:** identitas visual hilang di setiap layar; logo juga diam-diam tidak masuk PDF.
- **Perbaikan:** impor aset agar Vite menulis ulang URL (`import logoUrl from '../../public/logo.svg?url'`) atau pakai path relatif `./logo.svg`; tambahkan fallback inisial “R” via `onError`.

### P1-2 — Variant tombol `default` transparan
- **Bukti visual:** tombol **Proses** di Ambil Nama tampak sebagai teks hitam tanpa latar gelap; tab platform aktif juga tidak menonjol.
- **Kode:** `src/components/ui/button.tsx:11` memakai `bg-primary text-primary-foreground`, tetapi `src/index.css` mendefinisikan `--primary` sebagai triplet HSL tanpa mapping `--color-primary` di `@theme inline`. Tidak ada rule `.bg-primary` di CSS hasil build.
- **Dampak:** CTA utama scraper terlihat seperti disabled; operator ragu menekan.
- **Perbaikan:** tambahkan `--color-primary: hsl(var(--primary))`, `--color-primary-foreground`, `--color-muted`, `--color-popover`, `--color-border` di `@theme inline`, atau pakai kelas slate konkret di primitive.

### P1-3 — Penomoran tabel pegawai mulai dari 2
- **Bukti visual:** baris bertanda `2,3,…,9`, sementara footer “Menampilkan 1–8 dari 8 pegawai”.
- **Kode:** `src/components/EmployeeManager.tsx:904` mengirim `index={(page-1)*pageSize + index + 1}`, lalu `EmployeeRow` `:73` menambah `+1` lagi saat render. (Versi kartu mobile `:935` sudah benar.)
- **Perbaikan:** kirim `index={(page-1)*pageSize + index}` atau hapus `+1` di `EmployeeRow`.

### P1-4 — Pengaturan: tidak ada cadangan data & lokasi DB
- **Bukti visual:** Pengaturan hanya memuat Token Meta API, Ekstensi ReSo, Kalkulasi Ulang, Sosial Media, dan logo+versi. Tidak ada path DB, jumlah data, atau tombol cadangan/pulihkan.
- **Kode:** `SettingsTab.tsx` tidak memakai `dbStats()`, `exportAll()`, `importAll()`; keduanya sudah tersedia di `src/lib/reso-bridge.ts` dan `electron/preload.ts`. README menjanjikan fitur ini.
- **Dampak:** satu-satunya salinan data operator tidak bisa dibackup dari UI — risiko kehilangan data nyata.
- **Perbaikan:** seksi “Data lokal”: path `dbStats().path` (tombol salin), jumlah pegawai/hari, “Unduh cadangan JSON” (`exportAll`), “Pulihkan” (`importAll`) dengan konfirmasi.

### P1-5 — Menu ekstensi & kosakata web yang sudah tidak berlaku
- **Bukti visual:** Pengaturan menampilkan “Ekstensi ReSo — Pasang / perbarui ekstensi” dengan tombol `.zip`, `.crx`, `Panduan`.
- **Kode:** `SettingsTab.tsx:227-228`; pesan scraper `src/shared/messages.ts:34,39,48` menyuruh “Klik Rekap + Kirim”; toast `EngagementDashboard.tsx:139,142` “ke server”; error `EngagementDashboard.tsx:252,937` dan `InputModal.tsx:332` “harus login”.
- **Dampak:** menyuruh operator mencari kontrol/server/akun yang tidak ada lagi (keputusan #10–#12).
- **Perbaikan:** hapus seksi ekstensi, ganti dengan info “Scraper bawaan tersedia di Ambil Nama”; ganti copy menjadi “tersimpan lokal”, “Database lokal belum siap”, “Salin daftar nama”.

### P1-6 — Modal input bisa menutup dan membuang input
- **Kode:** `InputModal.tsx` punya dirty-check `:122-143`, tetapi jalur tutup Esc/backdrop/X (`:476-479,535`) memanggil `onClose` langsung. `EngagementDashboard.tsx:384-389,919-933` juga menutup tanpa guard.
- **Dampak:** operator menempel tiga daftar nama lalu menekan Esc → semua hilang. Ini jalur kehilangan data paling mungkin.
- **Perbaikan:** satu `requestClose()` yang memakai dirty state dan konfirmasi in-app “Simpan / Buang / Batal”.

### P1-7 — Dialog bertingkat & status scraper terpotong
- **Kode:** modal “Petakan nama” (`EngagementDashboard.tsx:1715-1799`) terbuka di atas InputModal; keduanya memasang focus-trap `useDialogA11y` dan `aria-modal`, sehingga dua trap aktif. Modal review tidak masuk handler Esc/scroll-lock (`:909-933`).
- **Juga:** `ScraperTab.tsx:175` memakai `truncate` pada pesan status, sehingga panduan pemulihan panjang (“buka post/reel, klik ikon komentar…”, checkpoint, 429, blocked) tidak pernah terlihat.
- **Perbaikan:** trap focus hanya untuk dialog teratas; masukkan review ke Esc/scroll-lock; ganti `truncate` dengan `line-clamp-3`/wrap + warna tone.

---

## 3. Temuan P2 (penting, tidak memblokir)

| # | Area | Temuan | Ref |
|---|------|--------|-----|
| P2-1 | Layout | `minWidth: 960` (`electron/main.ts:19`) lebih kecil dari breakpoint `lg:` Tailwind (1024). **Screenshot 960×640 memang menampilkan hamburger + bottom nav**, bukan sidebar. Samakan: `minWidth: 1024` atau gate sidebar ke `md`. | `EngagementDashboard.tsx:1346,1443,1950` |
| P2-2 | Laporan | Tombol “next” periode selalu aktif → operator bisa masuk ke tanggal/minggu/bulan depan dan mengekspor laporan kosong. Beri `canGoNext` + badge “Mendatang”. | `ReportControls.tsx:82-90` |
| P2-3 | Laporan | Nama file ekspor harian memakai tanggal dilihat, mingguan/bulanan selalu memakai **hari ini** → salah arsip. | `DailyReportView.tsx:71`, `WeeklyReportView.tsx:46`, `MonthlyReportView.tsx:44` |
| P2-4 | Laporan | Sort harian & mingguan berbagi satu state, jadi mengubah sort harian diam-diam mengubah mingguan. | `EngagementDashboard.tsx:90,1806` |
| P2-5 | Laporan | Sorotan hijau/merah (3 teratas/terbawah) tidak punya legenda; di bulanan hanya muncul saat sort = peringkat. | `WeeklyReportView.tsx:116`, `MonthlyReportView.tsx:116` |
| P2-6 | Laporan | Judul “Minggu ke-47” ambigu (ISO vs minggu ke- dalam bulan); rentang tanggal sudah dihitung tapi tidak ditampilkan. | `WeeklyReportView.tsx:35` |
| P2-7 | Aksesibilitas | Banyak tombol ikon tanpa `aria-label`/`title` (kalender prev/next, tutup modal review, hapus di kartu mobile). Target klik 28 px. | `EngagementDashboard.tsx:1481,1743`; `EmployeeManager.tsx:955` |
| P2-8 | Aksesibilitas | Status engage di tabel hanya memakai ikon+warna; tambahkan `aria-label`/`title` per sel. | `DailyReportView.tsx:201`, `WeeklyReportView.tsx:143` |
| P2-9 | Loading | `dataLoading` tidak dibedakan dari data kosong → flash “Belum ada data rekap” saat snapshot pertama; satu `isLoading` global menonaktifkan semua export saat recalculate. | `EngagementDashboard.tsx:80,84,505` |
| P2-10 | Destructive | Hapus token Meta dan “Terima N rekap otomatis” (massal sampai 120 hari) tanpa konfirmasi; “Bersihkan” scraper juga tanpa konfirmasi. | `EngagementDashboard.tsx:148-161,250-277`; `ScraperTab.tsx:154` |
| P2-11 | Scraper | Preferensi scraper (template URL, timeout, scroll, auto-send) sudah ada di IPC tapi **tidak ada UI-nya**; `includeReplies` juga tidak bisa diatur operator. | `electron/store/settings-schema.ts:10-51`; `ScraperTab.tsx:31,84` |
| P2-12 | Scraper | “Salin” menyalin seluruh nama, bukan hasil filter yang sedang dilihat; header menampilkan total, bukan jumlah tampil. | `ScraperTab.tsx:103,187` |
| P2-13 | Chart | Tick 10 px `#94a3b8` kontras rendah, `margin.left = -16` berisiko memotong label Y; legenda TikTok tetap muncul saat semua nol. | `EngagementChart.tsx:29-44,68-75` |
| P2-14 | Reaktivitas | Tulisan lewat `importAll`/scraper bypass shim `emit()`, jadi `onSnapshot` bisa basi sampai remount. Tambah siaran `reso:db:changed` dari main. | `src/lib/local-db.ts:294-362` |
| P2-15 | Tipografi | Banyak label 8–10 px (legenda kalender, header tabel, badge) sulit dibaca di desktop 100% scaling. Minimum 11 px untuk teks data. | `EngagementDashboard.tsx:1505-1531`; `WeeklyReportView.tsx:101` |
| P2-16 | ErrorBoundary | Pesan error tanpa `role="alert"` dan tanpa detail yang bisa disalin operator untuk laporan bug. | `ErrorBoundary.tsx:34-49` |

---

## 4. Yang sudah baik

- Bahasa konsisten **Bahasa Indonesia** + format tanggal `id-ID`; tidak ada sisa string Turki/campuran.
- Sistem desain slate + Geist, kartu `rounded-xl`, border 1 px, shadow rendah — rapi dan tenang.
- `useDialogA11y` sudah menyediakan focus trap + restore fokus untuk InputModal, review, dan konfirmasi hapus.
- Konfirmasi hapus pegawai sudah baik (portal, `role="dialog"`, Esc, Batal/Hapus).
- Empty state tersedia untuk pegawai, aktivitas, scraper, dan “semua nama terpetakan 🎉”.
- History limit 120 hari diberi toast penjelas, bukan gagal diam-diam.
- Export PDF/Excel/Gambar relatif tangguh (landscape bulanan, clone off-screen, batas 60 pegawai dijelaskan).
- State scraper dimiliki main process, dipersisten, dan disiarkan ke renderer; fallback web jujur tanpa tombol palsu.
- Postur keamanan Electron benar: `contextIsolation`, `sandbox`, tanpa `nodeIntegration`, tanpa login.

---

## 5. Rencana perbaikan yang disarankan

**Batch 1 — visual & kepercayaan (cepat, risiko rendah):** P1-1 logo, P1-2 token warna, P1-3 nomor baris, P2-15 tipografi.
**Batch 2 — offline truth & data:** P1-4 backup/restore + path DB, P1-5 copy/ekstensi, P2-10 konfirmasi aksi berbahaya.
**Batch 3 — alur input & dialog:** P1-6 dirty-close, P1-7 focus trap + pesan scraper, P2-1 breakpoint.
**Batch 4 — laporan & aksesibilitas:** P2-2…P2-8, P2-9, P2-11…P2-16.

Verifikasi tiap batch: `npm test`, `npm run typecheck:desktop`, `npm run dist:win`, lalu screenshot ulang pada 1280×800 dan 960×640.

---

## 6. Status

Audit ini **tidak mengubah kode**. Temuan di atas berdasarkan kode pada commit `df840ef` dan app terpaket `ReSoSetup-1.0.86.exe`.
