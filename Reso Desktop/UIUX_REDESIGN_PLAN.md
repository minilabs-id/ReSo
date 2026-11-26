# Audit Mendalam & Rencana Redesain UI/UX — ReSo Desktop

**Tanggal:** 2026-11-21
**Lingkup:** renderer React (`src/`), shell Electron (`electron/main.ts`), design token (`src/index.css`), dan dokumentasi produk (`specify.md`, `README.md`).
**Metode:** audit statis baca-saja terhadap kode aktual (pembacaan langsung + dua auditor paralel untuk domain & struktur UI) + verifikasi silang dengan tiga audit sebelumnya (`UIUX_AUDIT.md`, `UIUX_AUDIT_DESKTOP.md`, `AUDIT_TOTAL.md`).

> **Posisi dokumen ini.** Tiga audit sebelumnya bersifat **korektif**: mereka menemukan dan memperbaiki bug visual, inkonsistensi ukuran, dan temuan P0/P1/P2 (semuanya ditandai selesai). Dokumen ini **tidak mengulang** temuan tersebut. Fokus di sini adalah **struktural & strategis**: arsitektur informasi, redundansi, efisiensi kognitif, dan arsitektur komponen — hal-hal yang tidak terselesaikan hanya dengan menyamakan `h-10` atau menambah `aria-label`.

---

## Status implementasi — 2026-11-22

> **Sudah dikerjakan** (semua diverifikasi: `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run build:desktop` hijau):
>
> | Area | Hasil |
> |------|-------|
> | IA 8 → 5 | Sidebar tunggal berbasis `src/app/navConfig.tsx`; sub-tab Laporan (Harian/Mingguan/Bulanan) & Data (Pegawai/Ambil Nama). Drawer mobile, bottom nav, dan sheet "Lainnya" dihapus. |
> | State | `useRekapData`, `useMetaToken`, `useReportState`, `useReportExports`, `useRekapReview`, `useRecalculate`, `useDraftAutosave` — semuanya feature hook. `busyAction` menggantikan 5+ flag loading. `EngagementDashboard.tsx`: **2.080 → 616 baris**, `useState` root **28 → 10**. Komponen feature baru: `CalendarPanel`, `UnmatchedReview`. |
> | Redundansi | `src/shared/motion.ts` (4 definisi animasi + gaya prop → 1); `ModalHost` untuk dialog review; `platformLabels` + `PlatformBadge` + `EngagementStatus`; `src/types.ts` & `reso-bridge.ts` kini alias ke `src/shared/types.ts`; `BooleanField`/field preferensi mati, CSS iOS PWA, dan 68 kelas `dark:` tanpa ThemeProvider dihapus. |
> | Efisiensi | Autosave draf + banner "Pulihkan draf" di `InputModal`, pintasan `Ctrl+N` / `Ctrl+S` / `1-3`, pemilih tanggal pada handoff scraper. |
> | Rate | Satu definisi engagement rate: aktual ÷ (pegawai × 3 platform) — Beranda & laporan identik; kartu Beranda diberi label yang jujur. Bug sort harian (`weeklySortMode` dipakai di tabel harian) juga diperbaiki. |
> | Konsistensi | Semua teks data minimum 11 px; prop bocor `weeklySortMode` → `sortMode`; ikon `Users2` ganda diganti ikon navigasi berbeda; `README.md` diselaraskan. |
>
> **Sengaja ditunda (butuh keputusan/rencana terpisah):**
> - Penghapusan arsip web (`api/`, `firebase*.json`, `public/install.html`, CRX/ZIP) **sengaja dibiarkan** sesuai instruksi pemilik proyek (guardrail `specify.md:227` & `test:api` masih bergantung).
> - Target root < 300 baris baru tercapai sebagian (**616** dari 2.080); sisa baris adalah JSX switch halaman yang sengaja tidak diekstraksi lebih jauh agar tidak menambah prop-drilling & risiko regresi. Bisa dilanjutkan bertahap bila diperlukan.
> - Tema dark tidak diimplementasikan; scaffoldnya dihapus (konsisten dengan `'theme="light"'` pada Toaster).

---

## 0. Guardrails (batasan yang tidak boleh dilanggar)

Redesain ini **harus** tunduk pada keputusan produk yang dikunci di `specify.md`:

| Keputusan | Implikasi bagi redesain |
|-----------|-------------------------|
| **#7** — "Fitur & workflow saat ini sudah ideal untuk kerja operator — pertahankan perilaku; boleh perbaiki kualitas di baliknya" (Terkunci) | Ini **bukan** rombak alur kerja. Redesain menyasar *cara kerja disajikan*, bukan *apa yang dikerjakan*. Semua tugas lama harus tetap bisa dilakukan tanpa mengubah perilaku domain. Butuh persetujuan pemilik proyek sebelum Fase 1 & 3. |
| **#10/#11/#12** — Offline total, SQLite lokal, scraper in-app | Tidak ada login, server, multi-tenant, atau ekstensi. Kosakata UI harus jujur ("tersimpan lokal", bukan "ke server"). |
| **#19 / window 14:45–15:00 WIB** | Aturan operasional & perhitungan skor biner tidak diubah. |
| **Larangan migrasi storage tanpa plan** (`specify.md:227`) | Shim `local-db.ts` memang *Firestore-shaped* di atas SQLite, tetapi **tidak boleh dicopot** dalam redesain UI ini. Konsolidasi akses data hanya boleh dilakukan dengan rencana migrasi & uji parity (lihat §8, Fase 2). |
| **Mode default:** audit → perbaiki → polish | Perubahan bertahap dan dapat diverifikasi, bukan *big bang*. |

**Definisi "ideal" di dokumen ini:** lebih sedikit layar untuk tugas yang sama, satu sumber kebenaran per data, satu tempat per aksi, dan lebih sedikit klik/ketukan untuk rutinitas harian — **tanpa** menghilangkan kapabilitas yang ada.

---

## 1. Ringkasan eksekutif

Aplikasi ini stabil, teruji (E2E 21/21), dan sudah konsisten secara visual. Namun ada **empat masalah struktural** yang membuatnya terasa lebih berat dari yang perlu:

1. **Navigasi datar & redundan.** 8 item navigasi setara, 3 di antaranya adalah tugas yang sama pada 3 granularitas (`Laporan Harian/Mingguan/Bulanan`, `EngagementDashboard.tsx:1405-1422`). Pada layar sempit, daftar 8 tujuan yang sama muncul di **tiga** permukaan berbeda (sidebar overlay, bottom nav, sheet "Lainnya") — `:1358`, `:1934`, `:1986`.
2. **Komponen raksasa.** `EngagementDashboard.tsx` berisi **2.080 baris (≈1.927 non-blank), 28 `useState`, 8 `useEffect`, 17 `useMemo`** — seluruh state semua tab, logika bisnis, ekspor, dan dialog bersatu dalam satu komponen. Ini akar dari sulitnya perubahan aman.
3. **Duplikasi konsep, bukan hanya kode.** Token Meta dikelola dua kali (parent + `SettingsTab`), CTA "Input rekap hari ini" muncul di 4 tempat, 3 file laporan parallel dengan 3 state sortir + 3 `ref` cetak + 3 konstruksi nama file, **4 implementasi modal**, **3 definisi tipe domain**, **3 jalur akses DB**, **4 helper label platform**, dan lima flag loading yang tumpang tindih.
4. **Efisiensi operasional rendah.** Tidak ada pintasan keyboard, tidak ada autosave draft, kalender memadatkan 6+ encoding visual dengan legenda 8–11 px, dan alur "terima rekap otomatis" memiliki dua jalur UI untuk satu konsep. Tiga jalur input (paste manual, Meta API, scraper) mengarah ke field `*RawText` yang sama.

**Rekomendasi inti:** konsolidasi 8 → 5 area navigasi, satu layar "Rekap Harian" (kalender + panel editor) menggantikan modal bertingkat, satu tab "Laporan" dengan sub-tab, dekomposisi state ke *feature hooks*, dan satu lapisan token desain semantik. Detail temuan di §3, usulan di §5–§7.

**Prioritas temuan:**

| Kode | Temuan | Severity |
|------|--------|----------|
| IA-1 | 8 nav setara; 3 nav laporan = satu tugas | 🔴 Fundamental |
| IA-2 | Tiga permukaan navigasi duplikatif (sidebar / bottom nav / sheet) | 🔴 Fundamental |
| IA-3 | Tidak ada ruang kerja rekap yang menyatukan scrape → input → verifikasi | 🟠 Signifikan |
| AR-1 | God component 2.080 baris / 28 state | 🔴 Fundamental |
| RD-1 | Token Meta dikelola di dua tempat & dua UI | 🟠 Signifikan |
| RD-2 | 3 view laporan parallel + prop naming leak | 🟠 Signifikan |
| RD-3 | CTA "Input rekap hari ini" ×4 | 🟡 Polish |
| RD-4 | Duplikasi konstanta animasi (4 definisi + 1 gaya prop) | 🟡 Polish |
| RD-5 | 4 implementasi modal + tangga z-index 40→100 | 🟠 Signifikan |
| RD-6 | 3 mirror tipe domain + 3 jalur akses DB + 4 helper label platform | 🟠 Signifikan |
| RD-7 | Dead code, arsip web ikut terpaket, scaffold warisan web | 🟡 Polish |
| RD-8 | Lima+ flag loading yang tumpang tindih | 🟠 Signifikan |
| EF-1 | Tanpa keyboard shortcut / autosave draft | 🟠 Signifikan |
| EF-2 | Kalender 6+ encoding + legenda 8–11 px | 🟠 Signifikan |
| DS-1 | Dua sumber kebenaran warna + override masif | 🟠 Signifikan |
| DS-2 | Identitas platform & status tidak terpusat | 🟡 Polish |
| DS-3 | `dark:` di hampir semua class tanpa ThemeProvider | 🟡 Polish |

---

## 2. Profil pengguna & tugas inti (Jobs-to-be-Done)

Berdasarkan `specify.md:32-46, 120-122` dan `README.md:23-34`:

- **Pengguna:** satu operator/admin di satu mesin Windows. Bukan self-service pegawai. Tidak ada login.
- **Ritme:** pengingat **14:45 WIB**, rekap ditutup **15:00 WIB** setiap hari kerja. Postingan Meta dihitung pada window **15:00 H−1 → 15:00 D**.
- **Tugas utama (urutan nyata operator):**
  1. Ambil nama pegawai yang engage dari komentar postingan (scraper bawaan / paste manual / Meta API).
  2. Petakan nama ke master pegawai (termasuk alias & akun ke-2).
  3. Simpan rekap harian per platform (IG/FB/TikTok).
  4. Tinjau & verifikasi rekap otomatis yang belum dicek.
  5. Lihat laporan harian/mingguan/bulanan dan ekspor (PDF/Excel/Gambar).
  6. Kelola master pegawai & cadangkan data lokal (jarang).

**Implikasi desain:** tugas 1–4 adalah **satu alur berkelanjutan** yang saat ini dipecah menjadi tiga tab (`Ambil Nama` → `Input Rekap` → kalender/verifikasi). Ini target redesain paling bernilai, dan tetap sesuai #7 karena tidak mengubah apa yang dikerjakan — hanya menyatukan tampilannya.

---

## 3. Audit mendalam — temuan & bukti

### 3.1 Arsitektur informasi

**IA-1 — Navigasi datar, 8 item setara, tanpa groupings.**
Tidak ada *router* sama sekali — satu string `activeTab` (`EngagementDashboard.tsx:89`) menentukan seluruh layar. Sidebar `:1392-1440` memuat delapan `NavItem` dengan bobot visual identik: Beranda, Input Rekap, Laporan Harian, Laporan Mingguan, Laporan Bulanan, Data Pegawai, Ambil Nama, Pengaturan. Tiga item laporan adalah **satu tugas pada tiga granularitas**; memisahkannya menjadi tiga tujuan setara memaksa operator mengingat perbedaan yang sebenarnya adalah parameter, bukan mode.

Daftar tab juga ditulis manual **tiga kali** (sidebar `NavItem`, bottom nav `BottomNavItem`, sheet "Lainnya") — setiap perubahan label/ikon harus disinkronkan di tiga tempat.

**IA-2 — Tiga permukaan navigasi yang sama.**
- Sidebar overlay: `:1358-1368`, `:1371-1454`
- Bottom nav + sheet "Lainnya": `:1934-2012`
- Keduanya mendaftar 8 tujuan yang sama dengan pengelompokan berbeda.

Lebih penting: `minWidth: 1024` (`electron/main.ts`) membuat breakpoint `lg:` selalu aktif, sehingga bottom nav (`lg:hidden`) **tidak pernah muncul di produk desktop**. Seluruh cabang UI mobile — termasuk CSS `.pb-bottom-nav`, `.pt-safe`, `.pb-safe` di `index.css:100-109` — adalah beban mati yang tetap dirawat.

**IA-3 — Ikon & label ambigu.**
`Data Pegawai` (`:1424-1428`) dan `Ambil Nama` (`:1429-1434`) **memakai ikon `Users2` yang sama**. Tab `overview` berlabel "Input Rekap" tetapi ikon `CalendarIcon`; CTA di dalamnya juga "Input rekap hari ini". Operator harus membaca teks, bukan mengenali ikon.

**IA-4 — Dua definisi "engagement rate".**
`DashboardTab.tsx:149` ("Pegawai aktif hari ini", subtitle *"beda dengan % ENG laporan"*) vs laporan (aktual / (hari × 3)). Sudah dicatat di `AUDIT_TOTAL.md` P2-15 dan diberi label jujur — namun subtitle panjang di kartu stat adalah **gejala**, bukan solusi: satu metrik dengan dua nama tetap beban kognitif. Namun menyatukannya butuh keputusan produk (lihat §10 risiko).

**IA-5 — Jendela riwayat 120 hari vs navigasi bebas.**
`EngagementDashboard.tsx:193-211` memuat riwayat statis ±4 bulan, tetapi navigator bulan di kalender (`:1500-1511`) dan laporan bisa pergi lebih jauh. Tanggal di luar jendela tampil kosong; penjelasan hanya muncul setelah klik (`notifyHistoryLimit`). Tidak ada indikator visual di navigator bahwa periode itu di luar jangkauan.

---

### 3.2 Redundansi & duplikasi

**RD-1 — Token Meta memiliki dua pemilik.**
- Parent: `metaToken`, `hasMetaToken`, `handleSaveMetaToken` (`:108-163`), di-*thread* ke `InputModal` (`:1726-1727`) dan `SettingsTab` (`:1918-1922`).
- `SettingsTab` punya handler lokal sendiri: `handleSaveToken`, `handleConfirmClearToken`, `savingTokenLocal`, `clearTokenConfirm` (`:189-221`, `:91-94`).
- UI token muncul **dua kali**: di `SettingsTab` (konfigurasi, `:502-551`) dan di `InputModal` (saat tarik data Meta, `:543+`).

Dua jalur simpan untuk satu secret adalah risiko nyata: status bisa basi, dan audit `AUDIT_TOTAL` P1-1 sudah menunjukkan betapa sensitifnya data ini (enkripsi `safeStorage`, token tidak boleh di URL). Satu hook `useMetaToken` harus menjadi satu-satunya pemilik.

**RD-2 — Tiga view laporan parallel + kebocoran abstraksi.**
`DailyReportView.tsx`, `WeeklyReportView.tsx`, `MonthlyReportView.tsx` memiliki kerangka yang hampir identik. `ReportControls.tsx` sudah diekstrak (perbaikan lama), tetapi masih ada:
- 3 state sortir di parent: `dailySortMode`, `weeklySortMode`, `monthlySortMode` (`:94-96`)
- 3 `ref` cetak: `printRef`, `printMonthlyRef`, `printDailyRef` (`:165-167`)
- 3 fungsi navigasi periode + 3 `canGoNext` + 3 konstruksi nama file
- **Nama prop bocor:** `DailyReportView` menerima `weeklySortMode` / `setWeeklySortMode`, tetapi parent mengirim `dailySortMode` / `setDailySortMode` (`:1830-1831`). Fungsional benar, tapi ini jebakan perawatan: nama lama masih menyebut "mingguan" di file harian.

**RD-3 — Satu aksi, empat pintu.**
"Input rekap hari ini" muncul di:
- `DashboardTab.tsx:121` (mobile), `:140` (desktop), `:238` (empty state)
- `EngagementDashboard.tsx:1704` (panel "Aksi cepat")
- `ScraperTab` → `onOpenRekap` (`:1902-1906`)

Lima entry point yang semuanya melakukan `setSelectedDate(hariIni) → setActiveTab('overview') → setIsInputModalOpen(true)`. Tidak salah secara fungsi, tapi setiap pintu harus dijaga konsistensinya saat alur berubah — dan memang sudah ada `inputCloseGuardRef` (`:257`) khusus untuk menambal jalur tutup modal.

**RD-4 — Duplikasi konstanta animasi.**
`containerVariants` / `itemVariants` didefinisikan ulang di `EngagementDashboard.tsx:56-77`, `DashboardTab.tsx:27-35`, `EmployeeManager.tsx:132-142`, dan sudah terpusat di `reports/report-variants.ts` (dipakai hanya oleh 3 view laporan). `SettingsTab` menerima `containerVariants` lewat props — **lima gaya konsumsi** untuk satu perilaku.

**RD-5 — Empat implementasi modal + tangga z-index.**
| Implementasi | Lokasi | z-index |
|---|---|---|
| `ConfirmDialog` bersama | `ui/confirm-dialog.tsx` (dipakai ScraperTab, SettingsTab ×3, InputModal, verify-all) | 90 |
| Modal hapus kustom | `EmployeeManager.tsx` (portal + `AnimatePresence` + trap sendiri) | 100 |
| Modal review nama tak terpetakan | `EngagementDashboard.tsx:1737+` (backdrop + trap sendiri) | 65 |
| `InputModal` bottom-sheet/centered | `InputModal.tsx` (backdrop + trap + dirty-check sendiri) | 60 |
| Drawer sidebar & sheet "Lainnya" | `EngagementDashboard.tsx:1358`, `:1934` | 40/50, 55/56 |

Empat dialog dengan `role="dialog"` dan empat logika Escape/focus yang ditulis ulang, padahal `useDialogA11y` sudah stack-aware. `AUDIT_TOTAL` P1-7 pernah menemukan dua trap aktif bersamaan — gejala langsung dari duplikasi ini.

**RD-6 — Tiga mirror tipe domain, tiga jalur akses DB, empat helper label platform.**
- **Tipe:** `src/types.ts`, `src/shared/types.ts`, dan `src/lib/reso-bridge.ts:49-77` (`LocalEmployee`, `LocalDaily`) mendefinisikan ulang `Employee`/`DailyEngagement`. Versi `src/types.ts` masih berkomentar *"diisi otomatis oleh ekstensi ReSoEx via /api/engagement"*.
- **Akses DB:** (a) shim `local-db.ts` (Firestore-shaped, ~580 baris), (b) promise helper `reso-bridge.ts`, (c) panggilan langsung `window.reso.data.*` di `SettingsTab`. Ketiganya menulis ke SQLite yang sama.
- **Kosakata:** `dinasDoc`, `writeBatch`, `runTransaction`, `handleFirestoreError`, dan komentar *"Firestore batch max 500 writes"* (`EngagementDashboard.tsx:1001-1018`) bertahan di aplikasi offline. **Ini warisan migrasi yang sengaja dipertahankan agar ~3.900 baris UI tidak ditulis ulang** — jangan dicopot tanpa rencana migrasi (guardrail §0).
- **Label platform:** `PLATFORM_LABEL` di `EngagementDashboard.tsx:46` (singkat), `PLATFORM_LABEL` di `ScraperTab.tsx:34` (panjang), logika inline di tab `InputModal`, dan `wordFor`/`fbTargetLabel`/`igTargetLabel` di `shared/messages.ts`.

**RD-7 — Dead code & arsip web yang ikut terpaket.**
| Lokasi | Temuan |
|--------|--------|
| `SettingsTab.tsx:443-448` | `BooleanField` didefinisikan tetapi **tidak pernah dipakai** |
| `SettingsTab.tsx:65-67` | `launchAtLogin`, `minimizeToTray`, `autoSendToReso` masih ada di `DEFAULT_SCRAPER_SETTINGS` walaupun toggle-nya sudah dihapus (AUDIT_TOTAL P1-5) |
| `index.css:80-81, 100-109` | CSS safe-area & bottom-nav era iOS PWA — tidak relevan di Electron desktop |
| `index.css:123` | `@custom-variant dark` + class `dark:` di hampir semua komponen, tetapi **tanpa ThemeProvider**; `sonner.tsx` meng-hardcode `theme="light"` |
| `EngagementDashboard.tsx:29, 37, 169` | Import `dinasCollection`, `dinasDoc`, komentar "Load employees from Firestore" — kosakata arsip di kode aktif |
| `src/lib/engagement-api.ts` | Modul arsip API web, tetapi **masih diimpor dashboard aktif** (`:33`) untuk `collectUnverifiedAutoFilled`; logika `buildEngagementPatch` diduplikasi oleh `rematchDate`/`handleRecalculateAll` dan dijaga parity-nya oleh `test:api` |
| `public/install.html`, `reso-extension.{zip,crx}`, `firebase-applet-config.json` | Aset & konfigurasi ekstensi/web masih dikirim; `install.html` masih memuat instruksi "Login ke ReSo"; `firebase-applet-config.json` masih berisi `apiKey` & `extensionId` |
| `README.md:85` vs `package.json:27` | Dokumen menyatakan `clean` hanya menghapus `dist/`, padahal sudah menghapus `dist/out/release` |

**RD-8 — Lima+ flag loading yang tumpang tindih.**
`isLoading`, `isRecalculating`, `dataLoading`, `isVerifyingAll`, `isSavingToken` (`:86-88, 110, 254`) ditambah `savingTokenLocal` di `SettingsTab`. Tidak ada model yang jelas kapan "semua tombol export mati" vs "hanya satu aksi berjalan". `AUDIT_TOTAL` P2-9 sudah pernah menemukan gejalanya (satu `isLoading` global menonaktifkan semua export).

---

### 3.3 Efisiensi & beban kognitif

**EF-1 — Tidak ada akses keyboard untuk rutinitas harian.**
Operator menginput rekap setiap hari pada jam yang sama. Saat ini semua aksi mengharuskan mouse: buka tab, klik tanggal, klik tab platform, paste, klik simpan. Tidak ada `Ctrl+N`, `Ctrl+S`, navigasi kalender dengan arrow key, atau palette perintah. Untuk tugas berulang, ini adalah biaya terbesar yang belum disentuh audit mana pun.

**EF-2 — Kalender dengan 6+ encoding visual.**
`EngagementDashboard.tsx:1575-1647`: setiap sel bisa menampilkan angka, label "Hari ini", centang verifikasi, titik amber (auto-filled), tanda `!` (unmatched), dan tiga titik platform — dengan **legenda 5 butir berukuran 9–11 px** di `:1525-1551`. Sebelum membaca grid, operator harus mempelajari legenda; saat grid penuh, ia harus membedakan titik 4 px.

**EF-3 — Toolbar laporan menyatu terlalu padat.**
`ReportControls.tsx:57-173` menggabungkan navigasi periode, sortir, tiga tombol ekspor, dan dua pesan kondisional dalam satu kartu. Di lebar menengah semuanya menumpuk menjadi blok tinggi di atas tabel.

**EF-4 — Dua jalur untuk "terima rekap otomatis".**
Tombol massal di header kalender (`:1554-1567`) dan panel review per tanggal (`:1737+`) mengerjakan konsep yang sama. Operator harus memilih mana yang dipakai tanpa petunjuk kapan satu lebih tepat.

**EF-5 — Tiga jalur input untuk satu field, dan handoff yang kaku.**
Handoff scraper → rekap **sudah ada**: tombol "Masukkan ke rekap hari ini" (`ScraperTab.tsx:527`) menggabungkan nama ke `*RawText` lalu `upsertDaily` (`:322-346`). Namun ia mengunci tanggal `getLocalISODate(new Date())` (`:322`) — operator tidak bisa mengisi rekap tanggal lain dari hasil scrap. Di sisi lain ada tiga jalur yang semuanya menulis ke `*RawText`/`*Links` yang sama: paste manual di `InputModal`, tarik Meta API, dan scraper. Spec sengaja mempertahankan ketiganya (TikTok manual wajib), jadi yang dibutuhkan bukan penghapusan, melainkan **satu panel input dengan tiga sumber yang jelas** dan pemilih tanggal pada handoff scraper.

---

### 3.4 Konsistensi & design system

**DS-1 — Dua sumber kebenaran warna.**
`index.css` mendefinisikan skala slate di `@theme` (`:11-21`), token HSL shadcn di `:root` (`:48-68`), lalu memetakannya lagi di `@theme inline` (`:125-154`). `--color-slate-900` dan `--primary` bernilai identik (`222.2 47.4% 11.2%`) tetapi berasal dari dua tempat. Jika salah satu diubah, tombol dan teks bisa berbeda warna.

**DS-2 — Primitive rapi, halaman tetap override masif.**
Audit lama berhasil menstandardisasi `Button`/`Input`/`Card` (h-10, rounded-xl, shadow-sm). Namun feature code masih penuh `bg-slate-900 text-white font-bold`, `h-8/9/10/11`, `text-[9px]/[10px]/[11px]`, `rounded-lg/xl` secara inline. Token ada, tapi tidak benar-benar dipakai sebagai sistem.

**DS-3 — Tipografi di bawah baca nyaman.**
`index.css:74-79` mendefinisikan skala, tetapi teks data 8–10 px tetap ada: legenda kalender `:1525`, label "Hari ini" `:1608` (7 px!), tanda `!` `:1616` (8 px), header tabel laporan. `AUDIT_TOTAL` P2-15 sudah menandai ini; belum ada minimum yang ditegakkan.

**DS-4 — Identitas platform & status tidak terpusat.**
Warna platform ditulis ad hoc: IG `text-pink-500` / `bg-pink-400`, FB `text-blue-500` / `bg-blue-400`, TikTok `text-slate-600` (`DashboardTab.tsx:214-218`), `bg-slate-500` (`:1626`), dan `violet` untuk kartu stat (`:40`). Tidak ada `PlatformBadge` tunggal. Status juga bervariasi: centang di kalender, badge teks di "Aktivitas Terakhir" (`DashboardTab.tsx:15-23`), titik di chart.

**DS-5 — Animasi berlebih pada tampilan data.**
Hampir setiap blok memakai `motion.div` dengan stagger (`:27-77` dipakai lintas tab). Efeknya kecil per elemen, tetapi menambah kompleksitas dan biaya render pada grid/tabel. `prefers-reduced-motion` sudah ditangani global (`index.css:111-121`) — bagus, tapi tetap bisa disederhanakan.

**DS-6 — Kontrol form mentah mengabaikan UI kit.**
`<input>`, `<textarea>`, dan `<select>` native dipakai langsung di `SettingsTab` (token, numerik, URL, sosmed), `InputModal` (3 textarea + smart-link), `EmployeeManager` (field `datalist`, file input), `ScraperTab` (checkbox), dan modal review (`select`). Wrapper `ui/input.tsx` hanya dipakai di beberapa tempat. Hasilnya: tinggi, radius, fokus, dan state error tidak seragam meski primitive sudah tersedia.

**DS-7 — Markup desktop & mobile ditulis dua kali.**
Setiap view laporan punya daftar kartu `md:hidden` yang menduplikasi tabel `hidden md:block`; `EmployeeManager` punya tabel desktop + daftar kartu mobile terpisah; navigasi ditulis tiga kali (lihat IA-1). Untuk aplikasi desktop dengan `minWidth: 1024`, cabang mobile ini tidak pernah terpakai — namun tetap menambah luas kode dan risiko beda perilaku.

---

### 3.5 Yang sudah baik (dipertahankan)

- Bahasa Indonesia konsisten, format tanggal `id-ID`, tidak ada sisa string asing di UI.
- Sistem warna slate + Geist, kartu `rounded-xl`, border 1 px, shadow rendah — rapi dan tenang.
- `useDialogA11y` menyediakan focus trap + restore fokus + stack-aware (perbaikan P1-7).
- Konfirmasi destruktif (hapus pegawai, hapus token, import, recalculate, clear) sudah ada.
- Empty state tersedia untuk pegawai, aktivitas, scraper, dan "semua nama terpetakan".
- Export PDF/Excel/Gambar tangguh; batas 60 pegawai dijelaskan.
- Postur keamanan Electron benar: `contextIsolation`, `sandbox`, tanpa `nodeIntegration`, tanpa login.
- State scraper dimiliki main process, dipersisten, dan disiarkan ke renderer.

---

## 4. Prinsip redesain

1. **Konsolidasi, bukan penghapusan.** Semua kapabilitas tetap ada; yang berkurang adalah jumlah layar dan pintu masuk, bukan fungsi.
2. **Navigasi berbasis tugas.** Area navigasi = tujuan kerja, bukan format data. "Laporan" adalah satu tujuan; harian/mingguan/bulanan adalah parameternya.
3. **Satu sumber kebenaran.** Satu pemilik untuk token Meta, satu model loading, satu lapisan token warna, satu komponen per konsep (platform, status).
4. **Progresif disclosure.** Detail lanjutan (preferensi scraper, legenda lengkap, pengaturan lanjutan) tersembunyi sampai dibutuhkan.
5. **Keyboard-first untuk rutinitas.** Input harian adalah tugas berulang; pintasan dan autosave mengurangi friksi lebih besar dari perbaikan kosmetik.
6. **Kosakata offline yang jujur.** "Tersimpan lokal", "Database lokal", "Salin daftar nama" — tidak ada "server", "login", "kirim ke ReSo".

---

## 5. Usulan arsitektur informasi (IA) baru

### 5.1 Pemetaan navigasi

| Navigasi saat ini (8) | Usulan (5) | Perlakuan |
|----------------------|-----------|-----------|
| Beranda | **Beranda** | Dipertahankan; dipangkas menjadi ringkasan + status hari ini + **satu** CTA |
| Input Rekap (kalender) + InputModal | **Rekap Harian** | Digabung: kalender + panel editor di samping; modal dihapus |
| Laporan Harian + Mingguan + Bulanan | **Laporan** | 3 nav → 1 nav dengan 3 sub-tab + satu navigator periode |
| Data Pegawai + Ambil Nama | **Data** | 2 nav → 1 nav dengan 2 sub-tab, ikon berbeda |
| Pengaturan | **Pengaturan** | Dipertahankan; token memiliki satu pemilik |

**Hasil:** 8 → 5 item setara. Tiga tugas laporan tetap satu klik di sub-tab. Tidak ada kapabilitas yang hilang.

> **Catatan #7:** perubahan ini mengubah *cara menemukan* fitur, bukan *perilaku* fitur. Perlu tanda tangan pemilik proyek sebelum diterapkan (lihat §10).

### 5.2 Shell aplikasi

```
┌──────────────────────────────────────────────────────────────┐
│ Sidebar (fixed, 240px)                                       │
│  logo + ReSo                                                  │
│  ◉ Beranda                                                   │
│  ◉ Rekap Harian                                              │
│  ◉ Laporan                                                   │
│  ◉ Data                                                      │
│  ─────────────────                                            │
│  ◉ Pengaturan                                                │
│  v1.0.86  [Lokal]                                            │
├──────────────────────────────────────────────────────────────┤
│ Main: PageHeader (judul + ≤1 aksi utama)                     │
│                                                              │
│ Konten tugas (satu fokus per layar)                          │
└──────────────────────────────────────────────────────────────┘
```

- **Satu** permukaan navigasi. Bottom nav dan sheet "Lainnya" dihapus (tidak pernah terlihat pada `minWidth: 1024`).
- Setiap layar memiliki **paling banyak satu** tombol primer. CTA duplikat di "Aksi cepat" dan `ScraperTab` dihapus atau diubah menjadi tautan sekunder yang jelas.
- `PageHeader` bersama menggantikan copy-paste header `hidden lg:flex` di 5+ tempat.

---

## 6. Redesain per layar

### 6.1 Beranda
- 4 stat card → **3 metrik + 1 banner status hari ini** ("Rekap hari ini: IG 3 · FB 2 · TT 1 — Belum terverifikasi"). Banner ini menggantikan kartu "Pegawai aktif hari ini" yang membingungkan; definisi rate dipindah ke Laporan dengan label konsisten (butuh keputusan produk, §10).
- Satu CTA: **Isi rekap hari ini**.
- "Lihat semua" pada Aktivitas Terakhir tetap (navigasi sekunder, bukan CTA).

### 6.2 Rekap Harian (perubahan terbesar)
```
┌─ Rekap Harian ──────────────── [Hari ini] [Perlu review (3)] ─┐
│ ‹ Juli 2026 ›                                                  │
│ ┌ Kalender ─────────────────┐ ┌ Panel tanggal terpilih ──────┐ │
│ │  1  2  3  4  5 ...        │ │ 15 Juli 2026  [Terverifikasi]│ │
│ │  ●  !  ● ...              │ │ IG  [textarea teks mentah]   │ │
│ │                           │ │ FB  [textarea]               │ │
│ │ Legenda (angka + warna)   │ │ TT  [textarea]               │ │
│ │ ● Terisi  ◌ Perlu review  │ │ Hasil: 5 terpetakan, 1 baru  │ │
│ │ ✓ Terverifikasi           │ │ [Simpan rekap]               │ │
│ └───────────────────────────┘ └──────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```
- Modal `InputModal` → **panel samping (inspector)**. Menghilangkan dialog bertingkat (review nama di atas input) dan masalah focus-trap ganda sekaligus.
- **Autosave draft** per tanggal (debounced ke store lokal). `requestClose()` tetap ada sebagai jaring pengaman, tetapi prompt "Buang perubahan" menjadi kasus langka, bukan alur utama.
- Legenda dipangkas: status dari bentuk+warna (4 kondisi), titik platform hanya muncul pada sel terpilih atau saat hover/fokus.
- "Terima rekap otomatis" masuk ke **satu antrean "Perlu review"** di header panel — menggantikan tombol massal + modal terpisah (EF-4).

### 6.3 Laporan
- Satu tab; sub-tab **Harian | Mingguan | Bulanan**.
- Satu `PeriodNavigator` (prev / label + badge periode berjalan / next), satu kontrol sortir (state per granularitas tetap dipisah, tapi bernama benar), satu grup ekspor.
- `next` dinonaktifkan untuk periode mendatang; nama file selalu berasal dari periode yang dilihat (sudah diperbaiki, dipertahankan).
- Satu komponen `ReportView` dengan konfigurasi `granularity`, ditopang hook `useReport(granularity)`. Tiga file lama bisa menjadi pembungkus tipis atau dihapus.

### 6.4 Data
- Sub-tab **Pegawai** (EmployeeManager apa adanya) dan **Sumber Nama** (ScraperTab), dengan ikon berbeda (`Users2` vs `ScanSearch`).
- Handoff **"Masukkan ke rekap"** yang sudah ada (`ScraperTab.tsx:527`) tetap dipertahankan, tetapi diberi **pemilih tanggal tujuan** — saat ini ia mengunci "hari ini" (`:322`). Hasilnya langsung mengisi draft panel Rekap Harian (EF-5).
- Ketiga sumber (paste manual, Meta API, scraper) disajikan sebagai **tiga tab sumber di satu panel** dengan label yang sama, bukan tiga tempat terpisah.
- Tombol "Salin hasil filter" / "Salin semua" dipertahankan sebagai fallback.

### 6.5 Pengaturan
- Satu pemilik token: `SettingsTab` menghapus `handleSaveToken`/`handleConfirmClearToken` lokal dan memakai `useMetaToken` bersama.
- `InputModal`/panel rekap hanya menerima **status** token (`configured: boolean`), bukan nilainya.
- Grup: **Koneksi** (token) · **Scraper** (preferensi, template URL, timeout, `sertakan balasan`) · **Data lokal** (path DB, jumlah data, backup/pulihkan) · **Tentang**.
- Hapus `BooleanField` dan tiga field preferensi mati.

---

## 7. Arsitektur komponen & state (target)

```
src/
  app/            AppShell · navConfig · PageHeader · routes
  features/
    rekap/        RekapPage · CalendarGrid · DayInspector · useRekapDraft · useRekapHistory
    reports/      ReportPage · ReportView · PeriodNavigator · useReport · exportNames.ts
    employees/    EmployeePage · EmployeeManager
    scraper/      ScraperPage · ScraperTab · useScraperState
    settings/     SettingsPage · TokenField · LocalDataSection · useSettings
  shared/         PlatformBadge · EngagementStatus · EmptyState · ModalHost · platformLabels · motion-variants
  ui/             primitives yang sudah ada (button, input, card, ...)
  lib/            logika domain yang sudah ada (matching, date, local-db, ...)
```

`ModalHost` adalah satu-satunya jalur untuk dialog & sheet: satu kontrak `open/title/content/onClose`, satu `useDialogA11y` stack, satu tangga z-index, satu tempat untuk routing Escape. Ia menggantikan empat implementasi modal di §RD-5.

**Aturan:**
- Komponen memiliki state sendiri; induk hanya mengirim identifier & callback. Tidak ada prop-drilling token lintas 2 komponen.
- `EngagementDashboard.tsx` menyusut menjadi **shell + routing (< 300 baris)**; `useState` di root turun dari 28 ke < 6 (hanya navigasi & status shell).
- Satu model status data: `dataStatus: 'loading' | 'ready' | 'error'` + `busyAction: string | null` untuk operasi berjalan. Menggantikan lima flag loading.
- Subscription data (`onSnapshot`) tetap di satu hook bersama `useRekapData` + siaran `reso:db:changed` yang sudah ada; optimis update saat simpan.
- Satu fasad akses data (`dataAccess`) untuk komponen: shim `local-db.ts` **tidak dihapus** (guardrail §0), tetapi `reso-bridge.ts` dan panggilan `window.reso.data.*` langsung disatukan di belakang fasad itu.
- Satu helper `platformLabels` + satu `PlatformBadge` menggantikan empat jalur pelabelan platform.
- Business logic (matching, window 15:00, skor biner) **tidak disentuh** — dipindah lekasnya ke `lib/`, bukan diubah.

---

## 8. Rencana implementasi bertahap

| Fase | Isi | File utama | Risiko | Kriteria terima |
|------|-----|-----------|--------|-----------------|
| **0 — Fondasi & pembersihan** | Hapus `BooleanField` & field preferensi mati; hapus CSS iOS PWA; putuskan nasib `@custom-variant dark`; satukan `motion` variants (4→1) & ganti prop `containerVariants` di `SettingsTab`; ubah nama prop `weeklySortMode` → `sortMode` di `DailyReportView`; satukan `platformLabels` + `PlatformBadge` + `EngagementStatus`; minimum teks 11 px; ganti ikon duplikat; samakan kontrol form dengan UI kit; perbarui `README.md:85` | `SettingsTab`, `index.css`, `report-variants.ts`, `DashboardTab`, `EmployeeManager`, `EngagementDashboard` | 🟢 Rendah | `npm test`, `npm run typecheck:desktop`, `npm run build` hijau; tidak ada regresi visual di screenshot 1280×800 |
| **1 — IA & shell** | 8 → 5 nav; satu `PageHeader`; hapus bottom nav + sheet "Lainnya"; satu CTA per layar; gabungkan 3 nav laporan jadi 1 + sub-tab | `EngagementDashboard`, `AppShell`, `navConfig` | 🟡 Butuh tanda tangan #7 | Semua layar tetap tercapai ≤2 klik; E2E navigasi diperbarui 8→5; uji 5 operator |
| **2 — Dekomposisi state** | Feature hooks & folder; `useMetaToken` sebagai satu pemilik; model `dataStatus`/`busyAction`; `ReportView` tunggal; **`ModalHost`** menggantikan 4 modal + 2 sheet (z-index 40→100 disederhanakan); fasad akses data (tanpa menghapus shim) | seluruh `features/`, `EngagementDashboard`, `ui/` | 🟠 Menengah | Root < 300 baris, `useState` < 6; E2E 21/21 masih lolos; tidak ada token di props lintas fitur; hanya satu pemanggil `useDialogA11y` untuk dialog |
| **3 — Alur Rekap Harian** | Kalender + inspector menggantikan modal input; autosave draft; antrean review; pemilih tanggal pada handoff scraper; tiga sumber input jadi satu panel; pintasan keyboard | `features/rekap`, `features/scraper`, `InputModal` | 🟠 Menengah | Waktu isi rekap harian turun ≥40% (diukur dengan timer E2E); prompt dirty-close jarang muncul; E2E keyboard |
| **4 — Polish & aksesibilitas** | Token semantik penuh; `PlatformBadge` & `EngagementStatus` di semua tempat; kontras & 11 px minimum; (opsional) tema dark bila disetujui | `index.css`, `shared/`, semua feature | 🟢 Rendah | Pemeriksaan kontras/axe; screenshot 1280×800 & 1024×720; tanpa `console.error` |

**Urutan:** Fase 0 → 1 → 2 → 3 → 4. Fase 2 harus selesai sebelum Fase 3 agar panel inspector tidak mewarisi state raksasa.

---

## 9. Metrik keberhasilan

| Metrik | Saat ini | Target |
|--------|----------|--------|
| Item navigasi setara | 8 | 5 |
| Permukaan navigasi | 3 | 1 |
| Baris `EngagementDashboard.tsx` | 2.080 | < 300 |
| `useState` di root | 28 | < 6 |
| Tombol "Input rekap hari ini" | 4 | 1 (sekunder di tempat lain) |
| Flag loading | 5+ | 2 (`dataStatus` + `busyAction`) |
| Implementasi modal/sheet | 6 | 1 (`ModalHost`) |
| Definisi tipe domain | 3 | 1 |
| Jalur akses DB dari renderer | 3 | 1 fasad |
| Helper label platform | 4 | 1 |
| Klik untuk ekspor laporan | 3–4 | 2 |
| Waktu input rekap harian | baseline (diukur Fase 0) | ≤ 60% baseline |
| Teks data < 11 px | beberapa | 0 |
| E2E / console error | 21/21 / 0 | 21/21 (atau lebih) / 0 |

Pengukuran baseline dilakukan di Fase 0 agar target Fase 3 dapat diverifikasi secara objektif.

---

## 10. Risiko & mitigasi

| Risiko | Mitigasi |
|--------|----------|
| **#7 melarang perubahan workflow** | Fase 1 & 3 hanya mengubah *penyajian*; daftar tugas §2 dipertahankan persis. Minta tanda tangan pemilik sebelum eksekusi. Jika ditolak, tetap jalankan Fase 0, 2, 4 (murni kualitas) dan tunda Fase 1/3. |
| Regresi ekspor PDF/Excel/Gambar | Simpan *golden file* hasil ekspor sebelum refactor; bandingkan setelah Fase 2. |
| Kehilangan data saat refactor state | Commit kecil per fase; E2E memakai profil `userData` terpisah + backup; jangan menyentuh skema SQLite/matching/window. |
| Perubahan terasa "asing" bagi operator | Uji 5 operator dengan skenario harian; pertahankan label akrab ("Input rekap", "Ambil Nama") sebagai sub-tab. |
| Over-engineering struktur folder | Lakukan Fase 2 bertahap: ekstrak hook satu per satu, bukan pindah seluruh file sekaligus. |
| Regresi karena menghapus shim/arsip "yang terlihat mati" | **Jangan** menghapus `local-db.ts`, `engagement-api.ts`, atau field `autoFilledAt/verifiedAt/postedAt` di Fase 0–2. Data impor lama & `test:api` masih bergantung padanya. Masukkan ke rencana migrasi terpisah. |
| Handoff scraper mengubah tanggal rekap | Pemilih tanggal baru harus memakai helper WIB yang sama (`getLocalISODate`), bukan `new Date()` lokal mesin — lihat `AUDIT_TOTAL` P2-16. |

---

## 11. Lampiran — inventaris redundansi (siap dieksekusi)

| # | Lokasi | Tindakan |
|---|--------|----------|
| 1 | `EngagementDashboard.tsx:1392-1440` | Kurangi 8 nav → 5; sub-tab laporan & data |
| 2 | `EngagementDashboard.tsx:1358, 1934, 1986` | Hapus sidebar overlay mobile + bottom nav + sheet "Lainnya" |
| 3 | `EngagementDashboard.tsx:108-163` + `SettingsTab.tsx:189-221` | Satukan jadi `useMetaToken` |
| 4 | `EngagementDashboard.tsx:94-96, 165-167` | Satukan state sortir per granularitas & ref cetak di `useReport` |
| 5 | `DailyReportView.tsx:15-16, 75-76` | Ubah prop `weeklySortMode` → `sortMode` |
| 6 | `DashboardTab.tsx:121,140,238`; `EngagementDashboard.tsx:1704`; `ScraperTab:1902-1906` | Satukan CTA jadi satu per layar |
| 7 | `EngagementDashboard.tsx:56-77`; `DashboardTab.tsx:27-35`; `EmployeeManager.tsx:132-142`; `report-variants.ts`; `SettingsTab` (props) | Satukan motion variants di `shared/` (4 definisi + 1 gaya prop → 1) |
| 8 | `SettingsTab.tsx:443-448, 65-67` | Hapus `BooleanField` & field preferensi mati |
| 9 | `index.css:80-81, 100-109` | Hapus CSS safe-area/bottom-nav PWA |
| 10 | `index.css:123` | Implementasikan atau hapus scaffold dark mode |
| 11 | `index.css:11-21` vs `:48-68` vs `:125-154` | Satukan lapisan warna ke token semantik |
| 12 | `DashboardTab.tsx:37-42,214-218`; `EngagementDashboard.tsx:1537-1539,1619-1627` | `PlatformBadge` + token `platform.*` |
| 13 | `DashboardTab.tsx:15-23`; `EngagementDashboard.tsx:1629-1640` | `EngagementStatus` tunggal |
| 14 | `EngagementDashboard.tsx:1525,1608,1616` | Minimum 11 px untuk teks data |
| 15 | `EngagementDashboard.tsx:86-88,110,254` | `dataStatus` + `busyAction` |
| 16 | `ScraperTab.tsx:322-346, 503-527` | Handoff sudah ada — tambah pemilih tanggal (bukan "hari ini" hardcode) & satukan 3 sumber input di satu panel |
| 17 | `EngagementDashboard.tsx:1554-1567, 1737+` | Satu antrean "Perlu review" |
| 18 | `ui/confirm-dialog.tsx`; `EmployeeManager` (modal hapus); `EngagementDashboard.tsx:1737+`; `InputModal.tsx` | Satukan jadi `ModalHost` + satu `useDialogA11y` stack |
| 19 | `src/types.ts`; `src/shared/types.ts`; `reso-bridge.ts:49-77` | Satu definisi tipe domain (rencanakan migrasi, jangan hapus mendadak) |
| 20 | `local-db.ts`; `reso-bridge.ts`; `SettingsTab` (`window.reso.data.*`) | Satu fasad akses data; shim tetap dipertahankan |
| 21 | `EngagementDashboard.tsx:46`; `ScraperTab.tsx:34`; `InputModal.tsx`; `shared/messages.ts` | Satu `platformLabels` + `PlatformBadge` |
| 22 | `SettingsTab`, `InputModal`, `EmployeeManager`, `ScraperTab`, modal review | Samakan kontrol form dengan `ui/input.tsx` / pola field bersama |
| 23 | `engagement-api.ts` (masih diimpor `:33`); `public/install.html`; `reso-extension.{zip,crx}`; `firebase-applet-config.json` | Pisahkan arsip dari kode aktif; audit `apiKey`/`extensionId`; hapus instructional "Login ke ReSo" |
| 24 | `README.md:85` | Perbarui keterangan `npm run clean` (sudah menghapus `dist/out/release`) |

---

**Kesimpulan.** Tidak ada yang "rusak" pada ReSo saat ini. Yang ada adalah **akumulasi penyajian**: delapan pintu navigasi untuk tugas yang bisa diringkas menjadi lima, lima flag loading untuk satu kondisi "sibuk", dua pemilik untuk satu token, empat implementasi dialog untuk satu konsep, tiga definisi tipe untuk satu entitas, dan tiga jalur untuk menulis ke database yang sama. Redesain yang diusulkan bersifat **konsolidatif dan bertahap** — ia tidak meminta operator mempelajari cara kerja baru, hanya mengurangi jumlah tempat yang harus mereka kunjungi dan jumlah hal yang harus mereka ingat. Jika guardrail #7 dipegang teguh, Fase 0, 2, dan 4 dapat dijalankan segera tanpa persetujuan tambahan; Fase 1 dan 3 menunggu tanda tangan pemilik proyek.
