# Audit & Kritik — Menu Rekap Harian ▸ Ambil Nama

**Tanggal:** 2026-11-23
**Metode:** review kode (`ScraperTab.tsx`, `scraper-host.ts`, `runner.ts`, `engine-social.ts`, `engine-tiktok*.ts`, `run-controller.ts`, `auto-handoff.ts`, `run-state.ts`, `state-store.ts`, `reso-bridge.ts`, `main.ts`) + inspeksi langsung pada app terpaket via CDP (renderer **dan** WebContentsView browser internal), termasuk uji scraping nyata pada postingan Instagram.

---

## 1. Penilaian ringkas

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Arsitektur state | ★★★★☆ | Satu pemilik di main, reducer murni, persist + siaran — sangat baik. |
| Keandalan ekstraksi | ★★☆☆☆ | Heuristik rapuh; P0: hasil 0 nama pada lebar jendela umum. |
| Alur handoff ke rekap | ★★★☆☆ | Otomatis & terverifikasi, tapi STOP/FAIL tidak konsisten. |
| UX panel | ★★★☆☆ | Jelas & rapi, tapi konteks operator hilang tiap pindah menu. |
| Kebersihan kode | ★★★☆☆ | Ada API mati, copy usia ekstensi, komentar basi. |

**Total: 3.2 / 5** — fondasi arsitektur bagus, tapi lapisan I/UI masih punya 3 masalah yang mengganggu operasi harian.

---

## 2. Yang sudah baik

- **Satu sumber kebenaran**: `runController` di main process; renderer hanya mengirim event & merender siaran. `generationRef` di panel menolak `getAll` basi (anti state mundur).
- **State machine murni & teruji** (`src/shared/run-state.ts`, 41 checks), dedupe nama case-insensitive, `runId` menolak hasil basi, `AbortController` per platform + suplemen run lama sebelum menyentuh WebContentsView yang sama.
- **Browser internal persisten** per platform (`persist:reso-<platform>`) — login sekali, cookie bertahan; `showHost()` memanggil `hideHost()` dulu sehingga tidak menumpuk.
- **Handoff otomatis terverifikasi**: DONE → nama masuk `*RawText`, terpetakan ke master pegawai, `unmatchedNames` diisi, `reso:db:changed` disiarkan, toast muncul.
- **Keamanan memadai**: contextIsolation on, nodeIntegration off, sandbox on, navigasi dibatasi domain, klik in-page hanya `isTrusted` + asal WebContents host + domain + debounce 2 dtk.
- **Aksesibilitas panel**: 0 tombol tanpa nama, 0 teks <11 px, 0 overflow horizontal (audit DOM 8 layar).

---

## 3. Kritik — temuan

### P0 — Harus diperbaiki

| # | Masalah | Bukti | Dampak |
|---|---------|-------|--------|
| **S1** | **Ekstraksi Instagram bergantung pada posisi absolut `left >= 600` px.** | `engine-social.ts:144` — `if (!rect \|\| rect.left < 600) continue`. Uji langsung: viewport browser internal **789 px**, 22 anchor username komentar, **semua di x = 477**, `ge600 = 0`, `lt600 = 22`. Run selesai dengan **0 nama**: "Tidak ada username…". Run 15 nama sebelumnya hanya terjadi saat jendela lebih lebar. | Pada jendela 1264×761 (ukuran uji) fitur **tidak berfungsi sama sekali** untuk Instagram. Tidak ada test `engine-social` yang menangkap ini. |
| **S2** | **Konteks operator hilang saat pindah menu.** | `ScraperTab.tsx:143-163` — effect `[platform]` selalu memanggil `navigateScrapeBrowser(platform, DEFAULT_URL[platform])` saat mount. Uji: URL `…/p/Df12rYekjTt/` → pindah Beranda → balik → `https://www.tiktok.com/shortdrama`, platform juga kembali ke TikTok. | Karena scraper kini bersebelahan dengan Kalender di menu yang sama, operator yang mengecek rekap lalu kembali **harus membuka postingan lagi dari awal**. |
| **S3** | **Hasil parsial tidak konsisten & pesan menyesatkan saat STOP/FAIL.** | `run-controller.ts:75` hanya handoff pada `DONE`. Runner FB/IG mengirim `DONE` saat engine `stopped` → masuk rekap. Runner TikTok (`runner.ts:223-226`) membuang `stopped` tanpa DONE → **nama hilang**. Sementara `run-state.ts:122` / `messages.ts:32-35` menampilkan "Dihentikan — N nama. **Sudah masuk rekap harian.**" untuk semua platform. | Operator yakin nama tersimpan, padahal TikTok STOP membuangnya. FAIL juga membuang nama tanpa penjelasan. |

### P1 — Sebaiknya diperbaiki

| # | Masalah | Bukti | Dampak |
|---|---------|-------|--------|
| S4 | **Checkbox "Sertakan balasan" tidak berpengaruh di Instagram.** | `INCLUDE_REPLIES` hanya dipakai di cabang Facebook (`engine-social.ts:203`); cabang IG (`:115-167`) tidak menggunakannya. | Toggle terlihat global, tapi diam-diam diabaikan pada platform IG. |
| S5 | **State lama tampil sebagai state baru saat membuka panel.** | Uji CDP: callout "Belum ada target. Buka video TikTok…" **bersamaan** dengan "Target: https://…/video/771034…", badge "Instagram **15**", daftar "Belum ada hasil" untuk platform aktif. State dibaca dari `scrape-state.json` (`state-store.ts`). | Operator bisa mengira generate gagal padahal itu sisa run sesi lalu; target & pesan saling bertentangan. |
| S6 | **Tombol aksi tidak melakukan preflight URL.** | Tombol "Ambil nama dari halaman ini" selalu aktif; validasi `plausible*PostUrl` ada di runner (`runner.ts:258-307`), bukan di UI. | Klik di beranda/ feed menghasilkan error setelah ~1 detik, bukan pencegahan. |
| S7 | **Panel tidak menampilkan hasil handoff.** | Toast global di `EngagementDashboard` hilang setelah beberapa detik; panel hanya menampilkan daftar nama mentah + "Terakhir diambil — N". | Tidak ada di panel info **tanggal rekap yang ditulis**, jumlah **terpetakan / belum terpetakan**, atau pintasan ke rekap. Padahal ini alur utama fitur. |
| S8 | **Dua jalur mulai run** (tombol in-page "Scrap" + tombol panel). | Keduanya memanggil `runController.apply(START)`. | Redundansi affordance; perlu dibedakan jelas sebagai "utama" vs "cadangan", atau disatukan. |
| S9 | **Debounce klik 2 dtk diam-diam membuang klik cepat.** | `main.ts:190-192`. | Tanpa umpan balik, operator mengira tombol rusak (persis laporan sebelumnya). |

### P2 — Perbaikan ringan / kebersihan

| # | Masalah | Bukti |
|---|---------|-------|
| S10 | API mati: `hasTemplate` (`NameState`), `scrape.getState`, `scrape.reset`, `clearScrapeNames`/`clearNames`, event `RESET` — tidak dipakai UI/logic. | grep seluruh `src/` hanya di definisi & test. |
| S11 | IPC chatter: poll `getAll` tiap 1,5 dtk + sinkronisasi bounds via rAF ~10×/detik selama panel terbuka. | `ScraperTab.tsx:124, 182-191`. |
| S12 | Copy usia ekstensi: "klik **Proses**" di `DEFAULT_STATES`, "Belum ada **template API komentar**" di `messages.ts:79-86`, komentar "nonce" di `scraper-host.ts:9-12, 181, 197-199`, komentar kosong menggantung di `:38-39`. | Tombol kini bernama "Ambil nama"; nonce sudah dihapus. |
| S13 | Kode fallback web (`!isElectron`, `WEB_HELP_ID`, `webDisabledProps`) tidak pernah aktif di build desktop. | `isElectron` selalu true di app terpaket. |
| S14 | Tidak ada test untuk `engine-social` — yang menyebabkan S1 tidak terdeteksi. | Yang ada hanya `engine-tiktok-logic.test.ts`, `engine.test.ts`. |
| S15 | Callout error memotong teks dengan `line-clamp-3`. | `ScraperTab.tsx:443` — diagnosis panjang tidak terbaca. |
| S16 | Heuristik sensitif terhadap layout & bahasa: `Verified` suffix, `rect.left < 600`, pasangan avatar, regex "Follow/Ikuti". | Lokalisasi UI sosial atau perubahan CSS bisa mematahkan ekstraksi. |

---

## 4. Usulan desain ideal

### 4.1 Ekstraksi (S1, S4, S14, S16)
- **Hapus geometri absolut.** Temukan kontainer komentar (`ul`, `[role="article"]`, `[data-commentid]`), lalu untuk tiap item pilih anchor profil yang teksnya == username dalam item itu. Gunakan pasangan avatar & `rect.left` **hanya sebagai tie-breaker relatif** (mis. anchor tanpa teks di sebelum anchor berlabel pada baris yang sama), bukan filter global.
- **Terapkan `includeReplies` pada IG** dengan membatasi kedalaman bersarang comment node, bukan membuang semua balasan.
- **Tambah `engine-social.test.ts`** dengan fixture DOM pada lebar 789 px dan 1280 px; jadikan S1 regression test.
- Pisahkan "penulis post" dari komentator lewat tombol Follow/Ikuti **relatif terhadap item**, bukan pencarian 6 level ke atas yang bisa mengenai tombol Follow milik akun lain.

### 4.2 Konteks operator (S2, S5)
- **Jangan navigasi saat mount** bila `getHostUrl(platform)` sudah merupakan URL platform yang diizinkan. Navigasi default hanya saat: pertama kali host dibuat, operator menekan tombol FB/TT/IG, atau operator mengetik URL.
- Simpan `platform` terpilih di module scope (atau main process), bukan `useState` yang hilang saat unmount.
- Saat membuka panel, tampilkan label "**Hasil sesi lalu**" bila `updatedAt` bukan hari ini; atau reset callout/target ke default saat mount sambil tetap menyimpan daftar nama.

### 4.3 Handoff & umpan balik (S3, S7, S9)
- **Handoff sekali per runId** pada `DONE`, `STOP`, maupun `FAIL` bila `state.names.length > 0` (dedupe dengan `Set<runId>` di `runController`). Partial TikTok tidak boleh hilang; ubah pesan STOP menjadi "tersimpan" hanya bila benar-benar di-handoff.
- Tampilkan di panel ringkasan hasil handoff: `Masuk rekap <tanggal> · N terpetakan · M belum` + tombol "Lihat rekap" (pindah ke Kalender). Langganan `onScrapeHandoff()` sudah tersedia.
- Beri umpan balik untuk debounce: mis. tombol in-page berubah menjadi "Diproses…" selama 2 dtk, atau toast ringan saat klik diterima.

### 4.4 Preflight & penyederhanaan (S6, S8, S10–S13)
- Ekspos `plausible*PostUrl` ke UI (atau duplikasi ringan di `shared/platform.ts`); tombol aksi `disabled` dengan `title` "Buka postingan <platform> dulu" bila URL belum valid.
- Pertahankan dua tombol mulai, tapi beri label jelas: tombol panel = "Ambil dari halaman ini" (cadangan), tombol in-page = jalur utama; atau hilangkan tombol panel bila in-page sudah stabil.
- Hapus `hasTemplate`, `scrape.getState/reset`, `clearScrapeNames`, `RESET`, kode web-fallback, dan perbarui semua copy basi.
- Turunkan poll ke 3–5 dtk (siaran broadcast sudah cukup; poll hanya pengaman) dan throttling bounds ke 250 ms.

---

## 5. Prioritas eksekusi

| Prioritas | Item |
|-----------|------|
| **P0** | S1, S2, S3 |
| **P1** | S4, S5, S6, S7 |
| **P2** | S8–S16 |

---

## 6. Status perbaikan — SEMUA diterapkan

| # | Perbaikan | Bukti |
|---|-----------|-------|
| **S1** | Ekstraksi IG tidak lagi memakai `left < 600`. Username diambil dari anchor timestamp `/p/<shortcode>/c/<id>/` yang sejajar; fallback memakai **cluster posisi relatif** (modus), bukan piksel absolut. Balasan dideteksi dari kedalaman permalink + indentasi relatif. | Uji langsung viewport **789 px**: dulu **0 nama** → sekarang **14 nama** (`done`, "Masuk rekap 2026-11-23"). |
| **S2** | Panel tidak menavigasi ke homepage saat mount bila host sudah punya URL platform yang valid. Platform terakhir disimpan di module scope. | Uji: buka postingan → Beranda → balik → URL **masih** `instagram.com/p/Df12rYekjTt/`, platform masih Instagram. |
| **S3** | Handoff dipicu sekali saat run berakhir (**DONE / STOP / FAIL** / supersede) bila ada nama; pesan error menyebut nama tetap masuk rekap. | Pesan STOP tanpa nama: "Dihentikan — belum ada username." (tidak lagi mengklaim tersimpan). |
| **S4** | `INCLUDE_REPLIES` kini dipakai di cabang Instagram. | `engine-social: 22 checks OK`, termasuk balasan included/excluded. |
| **S5** | `START` menghapus `postHint`/`videoHint` lama; panel menandai state hari sebelumnya "(sesi lalu)" dan menyembunyikan callout/target basi. | Uji: callout "Siap." + "Terakhir diambil — 0 nama (sesi lalu)" tanpa "Target:" bertentangan. |
| **S6** | Preflight URL memakai `plausibleScrapeTarget()` yang sama dengan runner; tombol disabled + `title` penjelas. | Uji: di homepage `takeDisabled:true`, title "Buka postingan TikTok dulu…"; di postingan `false`. |
| **S7** | Panel menampilkan ringkasan handoff (tanggal · terpetakan · belum) + tombol **Lihat rekap**. | Uji: "Masuk rekap 2026-11-23 · 0 terpetakan · 0 belum" (master pegawai kosong di profil uji). |
| **S8** | Tombol panel diberi label "Ambil dari halaman ini" dan dijelaskan sebagai **cadangan**; tombol di halaman jalur utama. | Teks bantuan di panel. |
| **S9** | Tombol in-page berubah jadi "Diproses…" selama 2,2 dtk (debounce 2 dtk di main). | Uji CDP: klik trusted → teks tombol `Diproses…`. |
| **S10** | Dihapus: `hasTemplate`, `scrape.getState/reset/clearNames`, IPC `scrapeClearNames`, event `RESET` (+ test), kode web-fallback. | grep bersih; typecheck hijau. |
| **S11** | Poll state 1,5 → 4 dtk; throttling bounds 100 → 250 ms. | Kode. |
| **S12** | Copy "Proses" → "Ambil nama"; "template API/GraphQL komentar" → "panel komentar belum terbuka"; komentar nonce basi dibersihkan. | `messages.ts`, `state.ts`, `scraper-host.ts`. |
| **S13** | Semua cabang `!isElectron` di panel dihapus. | Kode. |
| **S14** | `engine-social.test.ts` baru (22 checks) + `shouldIncludeCandidate()` murni yang diserialisasi ke script in-page. | `npm test` hijau. |
| **S15** | `line-clamp-3` removed; pesan error tampil penuh dengan `break-words`. | Kode. |
| **S16** | Filter absolut & suffix "Verified" tidak lagi jadi penentu utama; keputusan lewat helper murni yang diuji. | `engine-social-logic.ts`. |

### Perubahan file utama
- `src/shared/platform.ts` — `plausibleScrapeTarget()` (satu aturan untuk runner & UI)
- `src/shared/run-state.ts`, `src/shared/state.ts`, `src/shared/messages.ts` — state & copy
- `electron/scrape/engine-social.ts` + **`engine-social-logic.ts`** + **`engine-social.test.ts`** — ekstraksi & regression test
- `electron/scrape/runner.ts`, `electron/ipc/run-controller.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/ipc/contracts.ts`
- `src/components/tabs/ScraperTab.tsx`, `src/lib/reso-bridge.ts`, `src/components/EngagementDashboard.tsx`
- `package.json` — `engine-social.test.ts` masuk `test:shared`

**Verifikasi akhir:** `npx tsc --noEmit` ✅ · `npm run typecheck:desktop` ✅ · `npm test` ✅ (run-state 41, engine-social 22, engine 9, db-schema 27) · `npm run build` ✅ · `npm run build:desktop` ✅ · uji CDP langsung ✅.

---

## 7. Perbaikan lanjutan: scraping TikTok menghasilkan 0 nama

**Gejala:** video TikTok terbuka, tombol Scrap jalan, state `done`, tetapi **0 nama**.

**Root cause (terbukti lewat CDP):**
1. TikTok mengabaikan `element.click()` dari `executeJavaScript` karena event-nya **untrusted**. Klik programatik `OPEN_COMMENTS_JS` tidak pernah membuka panel komentar. Klik trusted lewat CDP langsung menghasilkan 18 kartu komentar.
2. `SCROLL_COMMENT_CONTAINER_JS` tidak mencocokkan container scroll yang dipakai TikTok saat ini (`div[class*="DivCommentMain"]`).

**Fix** (`engine-tiktok.ts`):
- `clickCommentsTrusted()` mengirim klik lewat `webContents.sendInputEvent` (mouseMove → mouseDown → mouseUp), mencoba ruang koordinat viewport & offset `WebContentsView`, lalu menunggu panel ter-render (20 × 400 ms) sebelum memanen. Fallback `OPEN_COMMENTS_JS` tetap ada.
- Selector scroll ditambah `[class*="DivCommentMain"]`; `OPEN_COMMENTS_JS` jadi fallback.
- Kopi "Belum tuntas … klik Ambil nama lagi" diperbaiki huruf pertamanya di `messages.ts`.

**Verifikasi CDP:** dua run berturut-turut → **88 nama** (`done`, reason `incomplete`); `tiktokRawText` rekap harian berisi 91 baris unik — handoff otomatis berjalan. `wc.debugger` tidak dipakai karena build Electron ini menolak protocol ("Requested protocol version is not supported").

`npx tsc --noEmit` ✅ · `npm run typecheck:desktop` ✅ · `npm test` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅.
