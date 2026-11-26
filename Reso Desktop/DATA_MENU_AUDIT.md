# Audit Mendalam UI/UX — Menu "Data" (Pegawai + Ambil Nama)

**Tanggal:** 2026-11-22
**Metode:** dua auditor paralel (EmployeeManager & panel scraper) + inspeksi DOM live pada renderer Electron (CDP): daftar tombol/input/tabel, empty state, form Tambah, dan alur handoff. Skrip: `scripts/audit-data-dom.mjs`, `scripts/audit-pegawai-form.mjs`.
**Fokus:** **redundansi** (duplikasi kontrol/aksi/data) dan **ketidakefisienan** (klik berulang, state yang hilang, jalur kerja yang memutar). Bukan sekadar konsistensi visual.

---

## 1. Kesimpulan

Menu Data secara fungsional lengkap, tetapi punya **3 masalah P0 yang merusak data atau alur**, **8 masalah P1 yang membuang klik/menyesatkan**, dan **sejumlah redundansi struktur**. Dua yang paling mahal bagi operator harian:

1. **Handoff scraper memaksa pindah tab ke Rekap Harian** setelah setiap pengiriman. Panel di-unmount, sehingga `platform`, tanggal, query, A–Z, dan URL browser **reset**. Untuk 3 platform sehari = **3 kali putaran tab + 3 kali pilih tanggal**.
2. **Export/import Excel kehilangan semua `aliases`** — alias adalah hasil review nama yang dipakai mesin matching. Operator yang export lalu re-import akan **merusak akurasi matching secara permanen**.

---

## 2. Peta redundansi (yang harus dihapus/digabung)

| # | Redundansi | Bukti | Rekomendasi |
|---|-----------|-------|-------------|
| R1 | **"Salin hasil filter" vs "Salin semua"** — tanpa filter aktif keduanya menyalin nama yang sama persis (urutan beda saja). | `ScraperTab.tsx:565-582`, `247-252` | Sembunyikan "Salin hasil filter" saat `!filterActive`; tampilkan satu tombol "Salin (n)". |
| R2 | **Tiga label untuk satu aksi ambil nama**: tombol "Proses halaman ini", tombol in-page "Scrap", pesan engine "Proses". | `ScraperTab.tsx:510-513,519-521`; `state.ts:17,31,45`; `messages.ts:51-54` | Satu istilah, mis. "Ambil nama dari halaman ini", dipakai di UI + pesan + tombol in-page. |
| R3 | **Dua grup tombol platform**: selector (mengubah platform aktif) dan FB/IG/TT beranda (cuma navigasi, tidak mengubah platform). | `ScraperTab.tsx:400-415` vs `464-475` | Gabungkan: tombol beranda juga mengubah platform; hilangkan grup kedua atau jadi dropdown "Buka beranda". |
| R4 | **Status "Balasan: ya/tidak"** di kartu browser menduplikasi checkbox "Sertakan balasan" di kartu aksi. | `ScraperTab.tsx:479-481,583-596` | Buang pill; biarkan checkbox sebagai satu-satunya sumber. |
| R5 | **Jumlah nama ditampilkan 4×** (badge platform, callout, judul hasil, baris filter). | `ScraperTab.tsx:410-412,608,625,631` | Simpan di badge platform + judul hasil saja. |
| R6 | **Dua jalur ekspor pegawai**: Excel di EmployeeManager (tanpa alias) vs backup JSON di Pengaturan (dengan alias). | `EmployeeManager.tsx:377-403`; `SettingsTab.tsx:201-224` | Excel → jelas beri label "Ekspor (tanpa alias)"; arahkan backup penuh ke Pengaturan. Atau tambahkan kolom alias agar setara. |
| R7 | **Dua jalur import**: Excel (upsert by NIP) vs restore JSON (`importAll`). | `EmployeeManager.tsx:452-584`; `SettingsTab.tsx:226-277` | Bedakan tegas: "Impor Excel" = tambah/perbarui pegawai; "Pulihkan" = seluruh database. |
| R8 | **`EMPTY_STATE` lokal** menduplikasi `defaultStateFor` dengan nilai yang berbeda (FB `includeReplies: false` vs default `true`). | `ScraperTab.tsx:75-87`; `state.ts:13-53` | Hapus `EMPTY_STATE`, pakai `defaultStateFor(platform)`. |
| R9 | **Dua implementasi "hari ini"**: `wibTodayISO()` (formatToParts) vs `getLocalISODate()` (en-CA). | `ScraperTab.tsx:69-73`; `date.ts:2-4`; `EngagementDashboard.tsx:96,548` | Satu helper tanggal WIB untuk seluruh aplikasi. |
| R10 | **Dual markup desktop/mobile** di EmployeeManager (tabel + kartu) mengulang render nama, NIP, bidang, 6 handle, Edit/Hapus. | `EmployeeManager.tsx:845-910` vs `912-989` | Aplikasi desktop-only → hapus cabang mobile, satu tabel saja. |
| R11 | **Dua sistem dialog konfirmasi**: modal portal sendiri di EmployeeManager vs `ConfirmDialog` shared. | `EmployeeManager.tsx:1031-1090` | Pakai `ConfirmDialog` yang sudah ada. |
| R12 | **Kode mati / warisan web**: import `addDoc`, `updateDoc`; `handleFirestoreError` + `OperationType` + `authInfo` (~50 baris) yang hanya membentuk error Firestore untuk aplikasi offline. | `EmployeeManager.tsx:3,18-64` | Hapus; ganti `toast.error` langsung. |
| R13 | **`getScrapeBrowserUrl`** di bridge tidak pernah dipakai. | `reso-bridge.ts:201-208` | Hapus, atau pakai untuk R15. |

---

## 3. Ketidakefisienan alur kerja

| # | Masalah | Dampak | Ref |
|---|---------|--------|-----|
| E1 | **Handoff → pindah tab → panel unmount** | 3 platform/hari = 3 round-trip tab + pilih tanggal 3×; URL browser tiap platform hilang. | `EngagementDashboard.tsx:544-557` |
| E2 | **Aksi utama salah urutan**: tombol hitam paling menonjol adalah *handoff*, bukan *capture*. | Operator mengira "Masukkan ke rekap" adalah langkah utama. | `ScraperTab.tsx:519-521,541-549` |
| E3 | **Platform switch menutup & membuka ulang browser**, selalu navigasi ke beranda. | Post yang sedang dibuka hilang; harus paste URL lagi. | `ScraperTab.tsx:156-228,182-184` |
| E4 | **Poll 1,5 dtk + rAF 60 fps** berjalan walau semua state terminal. | Re-render & IPC sia-sia sepanjang panel terbuka. | `ScraperTab.tsx:148,208-215` |
| E5 | **Tambah pegawai 9 field + scroll + klik Simpan**, tanpa "Simpan & tambah lagi" / duplikat baris. | Lambat untuk input massal; import jadi satu-satunya jalur cepat (tanpa preview). | `EmployeeManager.tsx:649-841` |
| E6 | **Tidak ada bulk action** (pilih banyak, hapus/ubah bidang massal). | 100+ pegawai → operasi satu per satu. | `EmployeeManager.tsx` seluruhnya |
| E7 | **Sort hanya di header desktop**, tidak ada di kartu mobile; header tidak keyboard-accessible. | Tidak bisa urut via keyboard. | `EmployeeManager.tsx:852-877,912-989` |
| E8 | **Input file tersembunyi** (`className="hidden"`), label tidak bisa di-tab. | "Impor" tidak reachable via keyboard. | `EmployeeManager.tsx:611-629` |
| E9 | **Auto-match tidak jalan setelah handoff**; operator harus cari tombol "Match ulang" di tab Rekap. | Nama baru masuk rekap tapi belum terpetakan; skor bisa kurang. | `useRekapReview.ts:145-156` |

---

## 4. Bug & masalah data (P0/P1)

| # | Severity | Masalah | Ref |
|---|----------|---------|-----|
| B1 | 🔴 | **Export/import Excel menghilangkan `aliases`** → round-trip merusak matching. | `EmployeeManager.tsx:353-393,493-501` vs `useRekapReview.ts:124` |
| B2 | 🔴 | **Pagination tidak di-clamp** saat data menyusut → halaman kosong + "Menampilkan 101–100 dari 100". | `EmployeeManager.tsx:181-190,992-996` |
| B3 | 🔴 | **Form tanpa dirty-check** → edit hilang saat klik Edit baris lain, Batal, Delete, atau pindah tab. | `EmployeeManager.tsx:272-276,325-349,669-678,820-827` |
| B4 | 🔴 | **Checkbox "Sertakan balasan" tidak optimis** — bisa tampak tidak merespons 1,5 dtk / selamanya bila IPC gagal, dan UI berbohong soal opsi run berikutnya. | `ScraperTab.tsx:583-596`, `reso-bridge.ts:400-407` |
| B5 | 🔴 | **Date picker stale & validasi longgar**: di-init sekali saat mount (lewat tengah malam salah tanggal), tanpa `min`/`max`; tanggal depan diterima tapi rekap tampak kosong (di luar window riwayat). | `ScraperTab.tsx:114,531-540,349` |
| B6 | 🔴 | **`rematchDate` memakai snapshot lama** setelah handoff → "Match ulang selesai — 0 nama belum terpetakan" yang menyesatkan. | `useRekapReview.ts:78-102,145-156` |
| B7 | 🟠 | **Desktop table menyembunyikan akun ke-2** (`igUsername2`, `fbName2`, `tiktokName2`) yang justru dipakai matching; kartu mobile menampilkannya. | `EmployeeManager.tsx:84-104` vs `:972-982` |
| B8 | 🟠 | **Alias tidak bisa dilihat/dikelola di Data Pegawai** (hanya bisa ditambah dari tab Rekap, tidak bisa dihapus). | `useRekapReview.ts:104-143`; tidak ada di `EmployeeManager.tsx` |
| B9 | 🟠 | **Import tanpa preview**: langsung commit per chunk, menimpa pegawai by NIP; baris invalid dibuang diam-diam. | `EmployeeManager.tsx:452-584` |
| B10 | 🟠 | **Validasi NIP inkonsisten**: placeholder 18 digit + warning import, tapi submit hanya cek non-empty; nama whitespace-only lolol lalu ditolak main. | `EmployeeManager.tsx:215-229,706`; `contracts.ts:89-91` |
| B11 | 🟠 | **Empty state menyesatkan**: "Belum ada data pegawai" juga saat pencarian tidak cocok; tidak ada reset search. | `EmployeeManager.tsx:886-894,915-919` |
| B12 | 🟠 | **Placeholder search "Cari nama pegawai..."** tapi filter 9 field. | `EmployeeManager.tsx:595` vs `:157-166` |
| B13 | 🟠 | **Copy gagal silent**, tidak ada toast/SR announcement; umpan balik "Tersalin" tidak di live region. | `ScraperTab.tsx:319-333,572,581` |
| B14 | 🟠 | **Pesan sukses engine menyuruh copy manual**, padahal tombol "Masukkan ke rekap" ada. | `messages.ts:34,39,48` |
| B15 | 🟠 | **Alias mapping menimpa semua field pegawai** (nama, NIP, bidang, 6 handle) dari salinan lokal — risiko clobber edit bersamaan. | `useRekapReview.ts:114-126` |
| B16 | 🟡 | **Loading state tidak dipakai** → "Belum ada data pegawai" berkedip saat startup. | `EngagementDashboard.tsx:539`; `useRekapData.ts` |
| B17 | 🟡 | **Fokus hilang setelah hapus** (baris di-unmount sebelum focus restore). | `useDialogA11y.ts:84-86` |
| B18 | 🟡 | **Target ikon 32–40 px** (<44 px); ikon sosmed hanya warna tanpa label. | `EmployeeManager.tsx:107-124,939-960` |
| B19 | 🟡 | **Tidak ada judul halaman di tab Pegawai** (DOM audit: `headings: []`), sementara Ambil Nama punya H1. | `EngagementDashboard.tsx:530-542` |
| B20 | 🟡 | **Jargon "Mode native (Electron)"** dan inkonsistensi kata: "Bersihkan" vs "dikosongkan", "username" vs "nama". | `ScraperTab.tsx:387,369,675-677`; `messages.ts:9-11` |

---

## 5. Rencana perombakan (tanpa redundansi, tanpa langkah sia-sia)

### Fase 1 — Hentikan kehilangan data & putaran tab
1. Hapus forced tab-jump setelah handoff; panel tetap terpasang, tampilkan toast + tautan opsional "Lihat rekap". Simpan `platform`/`handoffDate`/URL per platform di state induk (atau gunakan Zustand/context kecil).
2. Simpan URL terakhir per platform; saat ganti platform, kembalikan URL-nya (pakai `getScrapeBrowserUrl`), jangan selalu ke beranda.
3. Checkbox "Sertakan balasan" optimis + rollback + toast saat IPC gagal.
4. Satu helper tanggal WIB; `min`/`max` pada date picker + tombol "Hari ini".
5. `rematchDate` baca `getDaily(date)` langsung, bukan snapshot.
6. Clamp `page` ke `totalPages`; dirty-check form; `aliases` masuk export/import Excel.

### Fase 2 — Hilangkan duplikasi
7. Satu tombol "Salin", satu istilah "Ambil nama dari halaman ini", satu grup platform, buang pill "Balasan", buang hitungan ganda.
8. Satu `ConfirmDialog`, hapus `EMPTY_STATE`, hapus `handleFirestoreError`/import mati, hapus cabang mobile, hapus `getScrapeBrowserUrl` atau pakai.
9. Satu jalur ekspor/import dengan label jelas (Excel untuk pegawai, JSON untuk backup penuh).

### Fase 3 — Efisiensi & a11y
10. Hentikan poll saat state terminal; ganti rAF dengan `ResizeObserver`.
11. Tambah "Simpan & tambah lagi", bulk select/delete/ubah bidang, sort keyboard + aria-sort, input file bisa di-tab, target 44 px.
12. Alias tampil di tabel + bisa dihapus; patch hanya `aliases` saat mapping.
13. Teks 12–13 px, live region untuk loading/copy, satu kosakata Bahasa Indonesia, judul halaman di tab Pegawai.

---

## 6. Verifikasi lapangan
- DOM audit: tombol Pegawai = Template, Export, Impor, Tambah; tabel 5 kolom; 1 baris empty state; form 9 field + search.
- DOM audit: panel scraper = 24 tombol, 4 input, platform badge TikTok 19 / Instagram 15, dua tombol salin aktif bersamaan tanpa filter (R1 terverifikasi).
- Saat audit pertama, chunk lazy `EmployeeManager` gagal dimuat karena build mengganti file saat app masih jalan — **bukan bug kode**; setelah app direstart, modul termuat normal.

> **Catatan untuk eksekusi:** semua perbaikan di atas bisa diterapkan; tidak ada yang memerlukan perubahan arsitektur besar di luar menu Data.
