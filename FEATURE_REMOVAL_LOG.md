# Log Penghapusan Fitur & Kode Mati — 2026-11-22

Diminta: hapus **semua fitur token Meta API**, **kalkulasi ulang**, dan fitur/kode yang tidak dibutuhkan. Arsip web (`api/`, `firebase*.json`, `vercel.json`, aset ekstensi, audit lama) **sengaja tidak disentuh**.

---

## 1. Fitur yang dihapus

| Fitur | Tempat | Status |
|-------|--------|--------|
| Token Meta API (simpan, hapus, status, proxy Graph API) | `SettingsTab`, `InputModal`, `useMetaToken.ts`, `reso-bridge.ts`, `preload.ts`, `contracts.ts`, `main.ts` | ✅ Dihapus total + token lama dibersihkan dari DB saat app start (`db.deleteSetting('meta_api')`) |
| Tarik post/komentar via Graph API | `InputModal.tsx` (panel "Tarik via Meta API") | ✅ Dihapus; ambil nama tetap lewat browser internal |
| Kalkulasi ulang 1 hari / 1 minggu | `SettingsTab`, `EngagementDashboard`, `useRecalculate.ts` | ✅ Dihapus total |
| Preferensi mati `launchAtLogin`, `minimizeToTray`, `autoSendToReso` | `settings-schema.ts`, `reso-bridge.ts` | ✅ Dihapus |
| `social_links` (URL sosmed instansi) | `SettingsTab`, `local-db.ts` komentar | ✅ Dihapus — tidak ada konsumen selain UI-nya sendiri |
| `instagramTemplateUrl` (template API IG) | `settings-schema.ts`, `reso-bridge.ts`, `SettingsTab` | ✅ Dihapus — engine tidak pernah memakainya |

## 2. Kode mati (P0) yang dihapus

- `src/shared/index.ts` (barrel tak terpakai)
- Helper di `platform.ts`: `isFacebookUrl`, `isTikTokUrl`, `isInstagramUrl`, `detectPlatform`, `extractFbFeedbackIds(Id)`, `isFacebookPostPage`, `extractInstagramShortcode`, `extractAwemeId`
- `normalize.ts`: `mergeAcrossPlatforms`
- `state.ts`: `STORAGE_KEY_*`, `storageKeyFor`, `isStaleRun`
- `template.ts`: `IG_TEMPLATE_TTL_MS`, `sanitizeTikTokTemplateUrl`, `isTikTokTemplateValid`, `sanitizeInstagramTemplateUrl`, `isInstagramTemplateValid`
- `parsers.ts`: `parseIgComments`, `extractGraphqlNames`
- `shared/types.ts`: `FbFeedbackCandidate`, `PlatformGroup`
- `engine-tiktok-logic.ts`: `isTikTokReplyApi`
- `local-db.ts`: `localDb()`, tipe `Firestore`, `logout()`, `FirestoreError`, `limit()`
- `reso-bridge.ts`: `getScrapeBrowserUrl`, `listEmployees`, `upsertEmployee`, `replaceEmployees`, `deleteEmployee`, `listDailyRange`
- `LocalProvider.tsx`: `provisionError`, `retryProvision`, `clearError`, `useHasDatabase`
- `src/types.ts`: `LocalTime`
- IPC mati: `appGetMeta`, `scrapeGetState`, `scrapeReset`, `scrapeGetUrl`, `dbReplaceEmployees` (+ handler & preload method)
- `AppMeta`, `getSettingsPath()`
- `useReportState`: return `currentWeekDate`/`currentMonthlyReportDate` yang tidak dipakai
- `date.ts`: `addLocalDays`, `addWibDays` (duplikasi helper tanggal, keduanya hanya di test)
- `engagement-api.ts`: seluruh helper web-era, kecuali `collectUnverifiedAutoFilled` yang dipindah ke `src/lib/auto-fill.ts`
- `fetch-with-timeout.ts` + testnya (hanya dipakai arsip `api/*`)
- Test terkait dihapus/dipangkas; script `test:api` dan `test:net` dihapus dari `package.json`

## 3. Duplikasi & kebersihan

- `backupIfInvalid()` yang copying-pasta di `settings-store.ts` & `state-store.ts` → diekstrak ke `electron/store/backup-if-invalid.ts`.
- Komentar usang sisa (ReSoEx, Firestore, token, recalculate, login/tray/server, "Mobile Lainnya") dibersihkan.
- README & specify.md disesuaikan: tidak lagi menyebut token Meta API atau kalkulasi ulang.

## 4. Verifikasi

- `npx tsc --noEmit` ✅
- `npm run typecheck:desktop` ✅
- `npm test` ✅ — shared 71, run-state 41, settings-schema 19, state-schema 13, engine-tiktok 15, scrape engine 9, db-schema 28, date 3 checks
- `npm run build` ✅ · `npm run build:desktop` ✅
- Uji CDP langsung pada app terpaket:
  - Pengaturan: **Token Meta API = tidak ada**, **Kalkulasi Ulang = tidak ada**, **Sosial Media = tidak ada**.
  - Struktur menu akhir: lihat bagian 8.
- Bundle renderer turun 1.399 KB → **1.366 KB**.

## 5. Penyesuaian alur sesuai instruksi pemilik

Alur final: **master pegawai (nama + akun sosial) → buka postingan → klik ambil nama → otomatis masuk rekap harian + otomatis terpetakan**. Input manual di modal Rekap **tetap ada**.

- `electron/scrape/auto-handoff.ts` (baru): setiap event `DONE` dengan nama langsung menulis `*RawText`, `*EngagedEmployeeIds`, dan `unmatchedNames` ke dokumen harian WIB, lalu menyiarkan `reso:db:changed`. Matching memakai `matchEmployeesToEngagement` + `matchEngagementDetail` terhadap master pegawai.
- `IPC.scrapeHandoff` + `onScrapeHandoff()` → toast ringkas: "N Instagram masuk rekap … · N terpetakan · N belum".
- Pesan engine diubah: "Sudah masuk rekap harian" (menggantikan "Salin daftar nama").
- UI scraper disederhanakan — **dihapus**: "Salin hasil filter", "Salin semua", "Masukkan ke rekap", pemilih tanggal, pencarian/A–Z hasil, "Bersihkan" + dialog konfirmasinya. Yang tersisa: pilih platform, browser, tombol ambil nama, Hentikan, "Sertakan balasan", status, daftar hasil terakhir (baca-saja).
- EmployeeManager: layout kartu mobile dihapus (aplikasi desktop-only), satu tabel saja.

Uji langsung (CDP, sesi login asli): event `START→PROGRESS→DONE` menghasilkan toast **"2 Facebook masuk rekap 2026-11-22 · 0 terpetakan"** dan `fbRawText` berisi `uji_A`, `uji_B`; pengujian Instagram sebelumnya menghasilkan toast "1 Instagram masuk rekap …". Tombol salin/handoff/tanggal tidak lagi muncul di UI.

## 6. Perbaikan tombol Scrap in-page (uji operator)

Dua bug ditemukan saat tombol **Scrap di dalam halaman** diuji langsung:

1. **Preload WebContentsView tidak termuat** di mode build/preview — path `join(app.getAppPath(), 'assets', 'webview-preload.cjs')` menunjuk ke `out/main/assets/` yang tidak ada, sehingga `window.resoScrap` tidak pernah tersedia dan klik tombol tidak melakukan apa-apa.
   - Fix: `resolveScrapPreload()` mencoba beberapa lokasi (app.asar, `out/main/../..`, cwd) dan memakai yang ada.
2. **Nonce tombol kedaluwarsa** — halaman SPA Instagram mengganti nonce setelah tombol di-mount, jadi `verifyScrapClick()` menolak klik.
   - Fix: verifikasi tidak lagi bergantung nonce; cukup asal WebContents = host scraper, URL masih di domain platform, dan debounce 2 detik. `window.resoScrap.click()` dikirim tanpa argumen.
3. **Browser internal menumpuk** saat pindah menu/platform — `showHost()` sekarang memanggil `hideHost()` lebih dulu sehingga hanya satu `WebContentsView` yang terlihat.

Uji ulang: klik tombol Scrap pada `instagram.com/p/Df12rYekjTt/` → state `running` → `done` dengan **15 nama**, dan kelima belas nama otomatis masuk `igRawText` rekap harian.

## 7. Yang tersisa (sengaja)

- Arsip web (`api/*`, `firebase*.json`, `vercel.json`, `public/reso-extension.*`, dokumen audit lama).
- `sanitizeEngineOptions` cabang `START` (masih dipertahankan walau hanya dipakai test — penghapusannya tidak memberi manfaat operasional).
- Skrip CDP di `scripts/live-*.mjs` dipertahankan sebagai alat verifikasi.

## 8. Struktur navigasi final (penyesuaian terakhir)

Menu utama tetap 5 item, tapi kontennya diposisikan ulang agar tiap menu punya satu tujuan:

```
Beranda           → ringkasan + CTA input rekap
Rekap Harian      → sub-tab: Kalender | Ambil Nama   ← scraper dipindah ke sini
Laporan           → sub-tab: Harian | Mingguan | Bulanan
Data              → khusus master pegawai (tanpa sub-tab)
Pengaturan        → satu halaman, hanya preferensi + cadangan/pulihkan
```

Perubahan kode:
- `navConfig.tsx`: `DataViewId` / `DATA_SUBTABS` → `RekapViewId` / `REKAP_SUBTABS`.
- `EngagementDashboard.tsx`: state `dataView` → `rekapView` (default `kalender`); blok kalender & modal input hanya render saat `kalender`; `ScraperTab` render saat `rekapView === 'scraper'`; `EmployeeManager` render langsung saat `activeTab === 'data'`.
- Pintasan **Ctrl+N** dan CTA Beranda "Input rekap hari ini" kini ikut mengatur `rekapView('kalender')` agar modal input tetap muncul walau sebelumnya sedang di subtab Ambil Nama.

Uji CDP (app terpaket):
- `Rekap Harian` → submenu `["Kalender","Ambil Nama"]`, kalender tampil.
- Klik `Ambil Nama` → H1 `Ambil Nama Komentar`, scraper tampil.
- `Data` → submenu `[]`, H1 `Data Pegawai`, tanpa scraper.
- Ctrl+N dari subtab Ambil Nama → kembali ke `Kalender` + modal input terbuka.

Verifikasi: `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run build:desktop` ✅.

## 9. Penghapusan fitur "drop/save link postingan"

Fitur menempel & menyimpan tautan postingan di modal input rekap dihapus total.

| Layer | Yang dihapus |
|-------|--------------|
| `InputModal.tsx` | Seksi **Link Postingan** (tab IG/FB/TT, textarea paste link, chip link + tombol hapus), state `igLinks/fbLinks/tiktokLinks` + `activeLinkTab` + baseline dirty-check-nya, penulisan `updateData.*Links`, merge `latest.*Links`, dan pemulihan draft link. |
| `draftStorage.ts` | Field `igLinks/fbLinks/tiktokLinks` di `RekapDraft`. |
| `src/shared/types.ts` | Field `*Links` di `DailyEngagement`. |
| `electron/ipc/contracts.ts` | Kunci `*Links` di `parseDailyPatch()`. |
| `electron/db/schema.ts` | Kolom `ig_links/fb_links/tiktok_links`, field `DailyRow`, dan mapping baca/tulisnya. |
| `electron/db/schema.test.ts` | 1 assertion untuk `fb_links` & fixture 3 kolom link (db-schema 28 → 27 checks). |

Catatan kompatibilitas: DB lama yang sudah punya kolom link tidak perlu migrasi — kolom tersebut diabaikan (`SELECT *` tetap aman), dan cadangan lama masih bisa dipulihkan karena `parseDailyPatch()` kini mengabaikan kunci yang tidak dikenal. Input manual **List IG / List FB / List TikTok** tetap ada.

Uji CDP: modal input terbuka · `Link Postingan:false` · `Paste link:false` · `platformTabs:false` · `List IG/FB/TT:true` · `tiny:0`.

Bundle renderer 1.329 KB → **1.315 KB**. Verifikasi: `npx tsc --noEmit`, `npm run typecheck:desktop`, `npm test`, `npm run build`, `npm run build:desktop` ✅.

## 10. Tindak lanjut audit menu Ambil Nama

Semua temuan di `SCRAPER_MENU_AUDIT.md` sudah diperbaiki. Ringkasan perubahan berdampak:

- **Ekstraksi IG**: filter absolut `left < 600` diganti anchor permalink `/p/.../c/...` + cluster relatif → uji viewport 789 px: **0 → 14 nama**.
- **Konteks panel**: tidak lagi menavigasi ke homepage saat mount; URL & platform bertahan saat pindah menu.
- **Handoff**: DONE/STOP/FAIL/supersede dengan nama semuanya masuk rekap (sebelum ini hanya DONE); pesan STOP tanpa nama tidak lagi mengklaim tersimpan.
- **UI**: preflight URL, ringkasan handoff + "Lihat rekap", label "(sesi lalu)", umpan balik tombol in-page "Diproses…", error callout tanpa clamp.
- **Kebersihan**: `hasTemplate`, IPC `clearNames`, event `RESET`, fallback web, dan copy usia ekstensi dihapus; test baru `engine-social.test.ts` (22 checks).

Bundle renderer 1.315 KB → **1.317 KB**. Verifikasi lengkap ✅ — detail di `SCRAPER_MENU_AUDIT.md` bagian 6.

## 11. Redundansi & tata ulang tombol panel Ambil Nama

Audit lanjutan di `SCRAPER_REDUNDANCY_AUDIT.md`. Perubahan:

- **Pintasan FB/TT/IG dihapus** — selain duplikat pemilih platform, tombol itu mengirim URL platform lain ke host platform aktif sehingga ditolak IPC `scrapeNavigate`.
- **Chip "Platform · Balasan:" dan badge jumlah di tombol platform dihapus** — satu fakta cukup satu tempat.
- **Baris aksi + status + ringkasan handoff dipindah ke atas browser** — tombol utama dari y=947 (di bawah lipatan 761 px) ke **y=271**; tinggi browser 520 → 440 px.
- **"Hentikan" hanya muncul saat run berjalan**; teks penjelas disatukan jadi satu baris; badge platform di kartu hasil dihapus.

Uji CDP: 15 nama dari postingan IG nyata saat layout baru; `Hentikan` muncul hanya saat `running`; `Lihat rekap` di y=452. Bundle 1.317 → **1.315 KB**. Verifikasi `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run build:desktop` ✅.

## 12. Sinkronisasi seluruh menu

Audit lengkap di `MENU_SYNC_AUDIT.md`. Ringkasan:

- **Satu tanggal aktif**: `selectedDate` dihapus; `currentDailyDate` dari `useReportState` dipakai Kalender, InputModal, review, notifikasi, dan Laporan Harian (+ ekspor).
- **Satu bulan aktif**: panah kalender ↔ panah Laporan Bulanan saling mengikuti.
- **Kalender menandai tanggal aktif** (`aria-current="date"` + ring) — prop `selectedDate` sebelumnya tidak dipakai.
- **Guard modal saat pindah menu**: `InputModal.closeGuardRef` menerima `afterClose`; pindah menu/sub-tab/CTA menunggu konfirmasi bila ada perubahan.
- **Sub-tab laporan mengikuti tanggal aktif**; "Lihat rekap" dari scraper menyetel hari ini.

Uji CDP: 10 Nov di kalender → Laporan Harian 10 Nov → prev → kalender 9 Nov; Bulanan prev → kalender Oktober; guard modal benar (confirm/batal/lanjut). Bundle 1.316 → **1.318 KB**. Verifikasi ✅.

## 13. TikTok: panel komentar tidak terbuka (0 nama)

- TikTok mengabaikan `element.click()` dari `executeJavaScript` (untrusted). Engine sekarang mengirim klik trusted via `webContents.sendInputEvent` (`mouseMove` → `mouseDown` → `mouseUp`) dengan beberapa kandidat koordinat (viewport & offset `WebContentsView`), lalu menunggu panel render sebelum memanen.
- Selector scroll panel ditambah `[class*="DivCommentMain"]`.
- Fallback `OPEN_COMMENTS_JS` tetap dipertahankan.
- Uji CDP dua kali → **88 nama** per run, otomatis masuk `tiktokRawText` rekap harian. `wc.debugger` tidak dipakai (protocol ditolak di build ini).

Verifikasi `npx tsc --noEmit`, `npm run typecheck:desktop`, `npm test`, `npm run build`, `npm run build:desktop` ✅. Detail di `SCRAPER_MENU_AUDIT.md` bagian 7.

## 14. Notifikasi statis & UI tidak bergeser

- Toast Sonner dihapus; penggantinya `src/lib/notify.ts` + `src/components/ui/NotifyHost.tsx`: **satu** pesan, fixed bottom-right, tanpa animasi/transisi, auto-hilang 2,6 dtk. 7 file pemanggil dialihkan; `src/components/ui/sonner.tsx` dihapus.
- Panel scraper: blok status tinggi tetap 92 px (pesan/target/handoff dalam satu blok), slot "Hentikan" selalu ada walau `invisible` saat idle, error browser pindah ke blok status.
- Uji CDP: Y browser, X checkbox, tinggi status, dan Y sidebar **identik** sebelum/saat/sesudah run; notifikasi `position:fixed`, `animation:0s`.
- Bundle renderer 1.318 → **1.262 KB**. Verifikasi ✅. Detail di `UI_STABILITY_AUDIT.md`.

## 15. Penguatan sesi login & halaman awal sosmed

- Session `persist:reso-<platform>` dipertahankan; cookie tanpa expiry ditulis ulang dengan expiry 1 tahun (`persistSessionCookies`, throttled 60 dtk) agar tidak logout saat app ditutup.
- UA browser internal diganti ke Chrome 133 (tanpa "Electron/xx") untuk mengurangi checkpoint/anti-bot.
- Preferensi `homeUrlFacebook/Instagram/Tiktok` (tervalidasi domain, tidak tampil di menu Pengaturan) + tombol **Bookmark** di toolbar scraper untuk menjadikan profil/postingan sendiri sebagai halaman awal.
- Uji CDP: 53 cookie TikTok + 9 FB diproses, UA benar, halaman awal FB/TT dipakai saat buka platform. Verifikasi `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run build:desktop` ✅. Detail di `SESSION_PERSISTENCE_AUDIT.md`.
