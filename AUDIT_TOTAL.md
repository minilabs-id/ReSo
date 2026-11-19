# AUDIT TOTAL — ReSo Desktop (v1.0.86)

**Tanggal:** 2026-11-19
**Lingkup:** seluruh repo — arsitektur Electron/IPC, database & keamanan, logika domain/matching, kualitas kode, build/packaging, dokumentasi, CI — **plus uji coba runtime app terpaket**.
**Metode:** audit statis baca-saja oleh 3 auditor paralel + eksekusi seluruh test/typecheck/build + uji E2E 17 skenario lewat CDP pada `release/win-unpacked/ReSo.exe` dengan profil `userData` terpisah.
**Status temuan UI/UX:** lihat `UIUX_AUDIT_DESKTOP.md` (sudah diperbaiki). Dokumen ini mencatat temuan **di luar** audit UI/UX dan hasil uji coba.

---

## 1. Ringkasan eksekutif

| Area | Status | Catatan |
|------|--------|---------|
| Test & typecheck | ✅ HIJAU | `npm test`, `tsc --noEmit`, `typecheck:desktop` |
| Build web & desktop | ✅ HIJAU | `npm run build`, `npm run build:desktop`, `npm run dist:win` |
| Uji runtime E2E | ✅ **17/17** | CRUD, pengaturan, export/import, 8 tab, navigasi laporan, simpan rekap, tanpa error konsol |
| Fungsionalitas scraper | 🔴 **P0** | Mesin scraper belum pernah di-wire; tombol “Proses” tidak mengumpulkan nama |
| Akurasi matching | 🟠 **P0** | False-positive substring pada nama mirip |
| Keamanan token | 🟠 P1 | Token Meta plaintext, diekspos via bridge, dikirim di query URL |
| Integritas cadangan | 🟠 P1 | `exportAll` tidak menyertakan `settings`; import membuang entri invalid diam-diam |
| Repo/CI/dokumen | 🟠 P1 | CI ekstensi mati; `constitution.md` masih memerintahkan login/Firebase/Vercel |
| Packaging & ABI | ✅ BAIK | Prebuild Electron ABI 130, asarUnpack benar, installer NSIS jadi |

**Kesimpulan:** aplikasi **stabil dan teruji untuk alur rekap manual + laporan + cadangan data**. Dua fungsi inti masih perlu perhatian sebelum dipakai operasional penuh: **scraper in-app belum aktif** dan **matching perlu hardening nama-mirip**.

---

## 2. Hasil uji coba (runtime, app terpaket)

Skenario dijalankan pada profil `userData` baru agar tidak menyentuh data nyata.

| # | Skenario | Hasil |
|---|----------|-------|
| 1 | App termuat, `window.reso` tersedia di `file://` | ✅ |
| 2 | Seed 5 pegawai + 3 rekap harian via bridge | ✅ `stats: 5/3` |
| 3 | `setSetting` → `getSetting` → `listSettings` → `deleteSetting` | ✅ |
| 4 | `exportAll()` mengembalikan `{employees, daily}` | ✅ 5 / 3 |
| 5 | `importAll()` mengganti data & `clearAllDaily` | ✅ **3 / 2** (sebelum perbaikan: 3 / 3) |
| 6–13 | Navigasi ke 8 tab utama | ✅ semua |
| 14 | Tombol “Berikutnya” disabled pada periode berjalan | ✅ |
| 15 | Buka kalender, klik tanggal hari ini | ✅ |
| 16 | Isi raw text IG + Simpan Rekap → dokumen harian berisi teks | ✅ |
| 17 | Tidak ada `console.error` / exception renderer | ✅ |

Laporan mesin: `C:\Users\zo\AppData\Local\Temp\opencode\full-trial-result.json`.
Screenshot verifikasi UI/UX: `C:\Users\zo\AppData\Local\Temp\opencode\fix-*.png`.

**Bug yang ditemukan dan diperbaikan saat uji coba:** `importAll` dulu hanya menghapus master pegawai tetapi tidak menghapus rekap lama → restore menyisakan tanggal basi. Sekarang `clearAllDaily()` dipanggil di dalam transaksi yang sama (`electron/db/database.ts`, `electron/main.ts`).

---

## 3. Temuan P0 — harus ditangani sebelum operasional penuh

### P0-1. Scraper in-app belum di-wire (fitur “Ambil Nama” tidak berfungsi)
- **Bukti:** `runTikTokCapture()` hanya didefinisikan di `electron/scrape/engine-tiktok.ts:135`; `getHost()` hanya didefinisikan di `scraper-host.ts:44`. **Tidak ada satu pun pemanggil** di luar test. Produsen event `PROGRESS`/`DONE` tidak ada.
- **Dampak:** `ScraperTab` mengirim START → state menjadi `running` → tidak ada nama yang terkumpul → status macet sampai operator menekan “Hentikan”. Ini melanggar keputusan #12 (scraping dijalankan aplikasi sendiri).
- **Perbaikan:** di `electron/ipc/run-controller.ts`, saat `START`, jalankan runner yang memanggil `getHost(win, platform)` + `runTikTokCapture(...)`, lalu kirim `PROGRESS`/`DONE`/`FAIL` dengan `runId` yang sama. Jika tidak jadi diimplementasikan, sembunyikan tab “Ambil Nama” agar tidak menyesatkan.

### P0-2. Matching false-positive pada nama mirip
- **Bukti (terverifikasi dengan `tsx`):** input `"Sandi Wijaya"` pada platform FB juga mencocokkan pegawai **Andi Wijaya**; input `"Bambang"` juga mencocokkan **Bam**.
- **Kode:** `src/lib/matching.ts:37-43` — `haystack.includes(needle)` untuk `nameMatch` ≥3 karakter, dipakai di `:77-88`, `:95-135`, `:195`.
- **Dampak:** pegawai yang tidak engage ikut dihitung → skor harian/mingguan/bulanan dan rate meleset. Ini prioritas P0 `specify.md` (akurasi matching).
- **Perbaikan:** pencocokan boundary-aware (token/regex `\b…\b`, escape `.`/`_`/`@`) + test regresi nama mirip, spasi, `@`, dual-account.

---

## 4. Temuan P1

### P1-1. Token Meta: plaintext, terekspos ke renderer, dan masuk URL
- `SettingsTab.tsx` menulis `meta_api.value` sebagai JSON biasa ke SQLite (`local-db.ts:139` → `database.ts:203`).
- `preload.ts:59-62` mengekspos `getSetting(key)` bebas → XSS/renderer mana pun bisa membaca token.
- `InputModal.tsx:242-302` mengirim token di `?access_token=` / `&input_token=` ke Graph API (access log, proxy, crash dump).
- **Perbaikan:** `safeStorage.encryptString`; jangan ekspos `getSetting` untuk key sensitif; pakai header `Authorization: Bearer`. Koreksi komentar `settings-schema.ts:5-7` yang mengklaim token tidak pernah ditulis ke disk.

### P1-2. Cadangan tidak lengkap
- `exportAll()` (`database.ts:249`) hanya `{employees, daily}` — tidak ada `settings` (`social_links`, `meta_api`).
- **Dampak:** “Pulihkan data” menghilangkan link sosial & token tanpa pemberitahuan.
- **Perbaikan:** sertakan `settings` dengan format payload berversi; validasi `parseSettingKey`/`parseSettingValue` saat import; beri tahu operator cakupan backup.

### P1-3. Import membuang baris invalid tanpa error
- `parseEmployeeList` (`contracts.ts:92-101`) melewati entri yang gagal validasi, lalu `replaceAllEmployees` menghapus seluruh master sebelum insert.
- **Dampak:** payload `employees: []` (atau sebagian cacat) menghapus data tanpa peringatan, padahal handler tetap `{ok:true}`.
- **Perbaikan:** tolak import bila ada entri invalid; minta flag eksplisif untuk mengimpor daftar kosong; kembalikan `{imported, skipped}` dan tampilkan preview konfirmasi.

### P1-4. CI mati dan konstitusi bertentangan
- `.github/workflows/extension-release.yml` memakai `working-directory: extension` dan trigger `extension/**`; direktori ekstensi sudah diarsipkan → workflow tidak akan pernah sukses. Tidak ada CI desktop pengganti.
- `constitution.md` masih menyatakan Firebase Auth, Firestore, Vercel, login, `server.ts`, `FirebaseProvider.tsx` — padahal `specify.md` #10–#12 membatalkannya. Karena constitution berada di hierarki aturan, ini bisa memicu regresi arsitektur.
- **Perbaikan:** hapus workflow ekstensi, buat CI desktop (`npm ci` → lint → typecheck → test → build:desktop) pada `windows-latest`; tulis ulang `constitution.md` v2.0 offline desktop atau beri banner arsip.

### P1-5. Tiga toggle Pengaturan tidak berdampak
- `launchAtLogin`, `minimizeToTray`, `autoSendToReso` hanya ada di schema + UI (`SettingsTab.tsx:749-751`), tidak ada implementasi di `electron/main.ts`. Label “Kirim otomatis ke ReSo” juga menjanjikan server yang tidak ada.
- **Perbaikan:** implementasikan `app.setLoginItemSettings`/`Tray`, atau hapus ketiga field dari UI/schema/tipe.

### P1-6. Klaim selesai di audit UI/UX sebagian tidak akurat
- `UIUX_AUDIT_DESKTOP.md` mengklaim logo PDF & copy ReSoEx sudah beres, padahal `fetch('/logo.svg')` masih absolut dan badge “ReSoEx” masih tampil.
- **Status:** **diperbaiki pada audit ini** — `fetchLogoDataUrl` kini memakai data URL `appLogo`; label ReSoEx diganti “Rekap otomatis”; favicon `index.html` diubah ke `./favicon.ico`. Dokumen UI/UX perlu disesuaikan.

---

## 5. Temuan P2 (prioritas menengah)

### Keamanan & proses
| # | Temuan | Ref |
|---|--------|-----|
| P2-1 | Pemeriksaan navigasi `startsWith` — `?? ''` membuat semua URL lolos saat env kosong; `localhost:5173.evil.com lolos`; `file://` mengizinkan file arbitrer | `electron/main.ts:55-60,230-236` |
| P2-2 | `setWindowOpenHandler` hanya di jendela utama; `WebContentsView` scraper bisa memunculkan jendela kosong | `main.ts:49-52` vs `scraper-host.ts:49-57` |
| P2-3 | Tidak ada validasi `event.sender` pada `ipcMain.handle` | `main.ts:71-190` |
| P2-4 | `detach()` memanggil `onCompleted(null)` → melepaskan **semua** listener session, bukan miliknya | `engine-tiktok.ts:60-71` |
| P2-5 | Token/kredensial di URL Graph API (lihat P1-1) | `InputModal.tsx:242-302` |
| P2-6 | Cookie sesi scraper tersimpan tanpa enkripsi aplikasi | `scraper-host.ts:26-35` |
| P2-7 | Installer unsigned + `signAndEditExecutable: false` → SmartScreen, metadata exe tidak disunting | `electron-builder.yml:21` |
| P2-8 | `clearInvalidConfig: true` mereset preferensi/state tanpa backup atau notifikasi | `settings-store.ts:23`, `state-store.ts:31` |
| P2-9 | `npm run build` tidak menjalankan `typecheck:desktop` | `package.json:12` |

### Integritas data & konkurensi
| # | Temuan | Ref |
|---|--------|-----|
| P2-10 | `WriteBatch.commit()` / `runTransaction` tidak atomik lintas baris — kegagalan tengah menyisakan tulisan parsial | `local-db.ts:472-505` |
| P2-11 | `emitOnce` async tanpa generasi — snapshot lama bisa menimpa UI dengan data basi | `local-db.ts:351-380` |
| P2-12 | `unmatchedNames` dihitung dari prop `existing` (stale) dan selalu ditulis, bisa menimpa hasil auto-fill saat save | `InputModal.tsx:430-478` |
| P2-13 | Batas numerik UI (min 0) beda dengan sanitasi main (min 1/200/5000) → input diam-diam diganti default | `SettingsTab.tsx:69` vs `settings-schema.ts:54` |

### Logika domain
| # | Temuan | Ref |
|---|--------|-----|
| P2-14 | `added`/`existing` salah hitung untuk duplikat **dalam satu kiriman** (`beforeKeys` tidak dimutasi) | `engagement-api.ts:133-140` |
| P2-15 | KPI “Engagement rate” di Beranda = pegawai aktif hari ini / total pegawai, sedangkan laporan = aktual/(hari×3) — dua definisi, tidak sesuai spec §4.2 | `EngagementDashboard.tsx:889-912` vs `:1340` |
| P2-16 | Arithmetic kalender memakai TZ mesin (`getDay`, `setDate`, `setHours`) sementara helper tanggal memakai Asia/Jakarta → bisa bergeser 1 hari | `EngagementDashboard.tsx:1097-1125,1197,1283` |
| P2-17 | Recalculate “1 hari/1 minggu” sebenarnya mencakup 2/8 tanggal (`setDate(-1)` + filter `>=`) | `EngagementDashboard.tsx:966-974` |
| P2-18 | Laporan harian tanggal depan tetap memberi `totalPossible = 3` → rate 0%, bukan N/A | `EngagementDashboard.tsx:470-478` |
| P2-19 | `isStaleRun(null,'r1')` = false tapi `reduce` menolak pesan saat `runId === null` | `shared/state.ts:98` vs `run-state.ts:69` |
| P2-20 | Alias ber-`@` tidak di-`stripAt` → gagal cocok dengan baris tanpa `@` | `matching.ts:166,91,103` |

### Kebersihan & dokumen
| # | Temuan | Ref |
|---|--------|-----|
| P2-21 | `api/*`, `firebase.json`, `firestore.rules`, `vercel.json`, `public/reso-extension.*` masih aktif/ditest; `isAdminUser()` di `api/engagement.ts:123-136` selalu `true` | arsip web |
| P2-22 | `test:stress` (19/19) tidak masuk `npm test`; `test:api`/`test:net` menguji kode mati | `package.json:20-27` |
| P2-23 | `clean` hanya menghapus `dist`, bukan `out`/`release` | `package.json:26` |
| P2-24 | Sisa kosakata Firestore/ReSoEx di komentar kode aktif & tipe (`FirestoreTime`) | `types.ts`, komponen |
| P2-25 | `specify.md:231-243` debt table basi; `src/shared/README.md` masih menyebut `tmp-shared.js` yang sudah tidak ada | dokumen |
| P2-26 | Enam dokumen audit/plan lain belum berlabel arsip | `*_AUDIT.md`, `*_PLAN.md` |
| P2-27 | Dependensi build-time (`vite`, plugin React, Tailwind, `shadcn`) ada di `dependencies` → ikut terpaket; `xlsx@0.18.5` & Electron 33 memiliki advisory/EOL | `package.json` |
| P2-28 | `tsconfig.json` tanpa `include`/`exclude` → memindai `api/`, `dist/`, `out/` | `tsconfig.json` |
| P2-29 | `scripts/check-abi.cjs` menulis `abi-result.txt` ke root repo; `.env.example` tidak dibaca kode | tooling |

---

## 6. Yang sudah solid

- Isolasi proses: `contextIsolation`, `sandbox`, `nodeIntegration:false` di jendela utama **dan** scraper host; preload CJS sesuai kebutuhan sandbox.
- Validasi IPC terpusat & konservatif (`contracts.ts`, `settings-schema.ts`, `state-schema.ts`); semua query SQL prepared.
- Atomicitas inti SQLite: `replaceAllEmployees`, `upsertDaily`, `dbImportAll` memakai `transaction()`.
- Pembedaan `null` vs `undefined` konsisten untuk patch parsial (mencegah patch scraper menghapus kolom lain).
- Skor biner 3/platform/hari, denominator `daysPassed × 3`, dedupe, idempotensi, dual-account, window 15:00 WIB, batas ekspor gambar 60 — dikonfirmasi benar dan teruji.
- State machine scraper (single owner di main + reducer murni) sudah benar secara desain — tinggal engine-nya disambungkan (P0-1).
- Packaging ABI & native module benar; smoke test DB di app terpaket lolos.
- Navigasi eksternal via `shell.openExternal`, permission ditolak semua, `will-attach-webview` diblokir.

---

## 7. Rencana tindak lanjut yang disarankan

**Prioritas 1 (fungsi inti):** P0-1 wiring engine scraper → P0-2 matching boundary-aware + test regresi.
**Prioritas 2 (data & kepercayaan):** P1-1 token (enkripsi/header/bridge), P1-2 backup settings, P1-3 validasi import.
**Prioritas 3 (repo):** P1-4 CI + konstitusi, P1-5 hapus/implementasi toggle, P2-1…P2-9 hardening proses.
**Prioritas 4 (polish):** P2-10…P2-29 sesuai bandwidth.

Verifikasi setelah tiap batch: `npm test`, `npm run typecheck:desktop`, `npm run dist:win`, dan ulang `full-trial.cjs` (17 skenario).

---

## 8. Status perbaikan lengkap (2026-11-19)

### Sudah diperbaiki & diverifikasi
| Temuan | Perbaikan |
|--------|-----------|
| P0-1 | Scraper di-wire: `setScrapeMainWindow`, runner per-platform, START→engine→PROGRESS/DONE/FAIL dengan `runId`, STOP membatalkan run, FB/IG gagal jujur (tidak menggantung). `detach()` tidak lagi melepas semua listener session; template divalidasi ketat. |
| P0-2 | Matching boundary-aware (Unicode), alias ikut `stripAt`, test regresi nama mirip/`@`/dual-account. |
| P1-1 | Token Meta dienkripsi `safeStorage`; status token saja yang dikirim ke renderer; fetch Graph API lewat IPC proxy dengan header `Authorization: Bearer` (token tidak pernah di URL). |
| P1-2 | `exportAll()` memuat `settings` + `schemaVersion`; import menulis ulang settings; UI memberi peringatan cadangan memuat token. |
| P1-3 | Import menolak entri invalid & daftar kosong tanpa flag eksplisit, lengkap dengan alasan di UI. |
| P1-4 | CI ekstensi dihapus → `desktop-ci.yml`; `constitution.md` berbanner arsip; `specify.md` §6.3 disegarkan. |
| P1-5 | Tiga toggle tanpa implementasi dihapus dari UI, diganti catatan offline. |
| P1-6 | Logo PDF & copy ReSoEx benar-benar diperbaiki; klaim audit disesuaikan. |
| P2-1/2/3/8/9 | Navigasi URL eksak; window-open deny untuk semua contents; `event.sender` divalidasi; konfig korup di-backup `.bak`; `build` ikut typecheck desktop. |
| P2-10/11 | `WriteBatch.commit()` satu transaksi atomik via `dbBatchSave`; generasi snapshot **per listener** (regresi tabel pegawai kosong sudah diperbaiki). |
| P2-12 | `unmatchedNames` dihitung ulang dari snapshot terbaru di dalam transaksi. |
| P2-13 | Batas numerik UI = sanitasi main. |
| P2-14…P2-20 | Count duplikat, `isStaleRun`, helper WIB, recalculate 1/7 hari, rate tanggal depan, KPI Beranda diberi label jujur. |
| P2-22…P2-29 | `test:date` + `test:stress` masuk `npm test`; `clean` hapus `dist/out/release`; deps build ke devDependencies; tsconfig include/exclude; dokumen legacy berbanner arsip. |

### Tidak dapat diselesaikan penuh di mesin ini
- **Code signing & rcedit (P2-7):** butuh sertifikat; `signAndEditExecutable: false` tetap dipakai agar packaging lolos tanpa privilegi symlink.
- **Upgrade Electron major (P2-27):** mengubah ABI prebuild `better-sqlite3` dan butuh validasi ulang.
- **Enkripsi cookie scraper (P2-6):** butuh desain ulang partition/safeStorage.
- **Advisori `xlsx@0.18.5`:** tidak ada fix di registry npm; perlu migrasi pustaka.
- **Arsip fisik `api/`, `vercel.json`, aset ekstensi (P2-21):** dipertahankan sebagai arsip web (sudah berbanner) agar test parity tidak rusak.

### Verifikasi akhir
`npm test` ✅ · `npm run lint` ✅ · `npm run typecheck:desktop` ✅ · `npm run build` ✅ · `npm run dist:win` ✅ · **E2E 21/21** ✅ (status token, batch atomik, import invalid, scraper FAIL, nol error konsol).
