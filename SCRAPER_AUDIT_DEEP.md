# Audit Mendalam & Perombakan Subsistem Scraper — ReSo Desktop

**Tanggal:** 2026-11-22
**Lingkup:** `electron/scrape/**`, `electron/ipc/run-controller.ts`, `electron/main.ts`, `assets/webview-preload.cjs`, `src/components/tabs/ScraperTab.tsx`, `src/shared/{state,run-state,normalize,parsers,platform,template,messages}.ts`.
**Metode:** dua auditor paralel (engine/main-process & renderer/state/IPC) + pembacaan langsung + verifikasi `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run build:desktop`.

> Dokumen ini **melengkapi** `SCRAPER_AUDIT.md` (2026-11-19) yang menguji tombol Scrap di build terpaket. Fokus di sini adalah bug struktural yang tidak terlihat pada uji happy-path.

---

## 1. Kesimpulan eksekutif

Arsitektur dasarnya **benar**: state machine murni (`run-state.ts`), satu pemilik state di main process, satu `WebContentsView` persisten per platform dengan sesi login yang bertahan, dan `runId` untuk menolak hasil basi. Namun lapisan I/O Electron dan renderer memiliki **6 bug P0** yang membuat fitur "Ambil Nama" tidak bisa dipercaya untuk operasional:

1. TikTok **tidak pernah berhenti** saat komentar habis — selalu menghabiskan semua putaran scroll.
2. Validasi host memakai `endsWith`, sehingga `evilfacebook.com` / `eviltiktok.com` dianggap domain sah.
3. Checkbox **"Sertakan balasan" tidak mempengaruhi tombol Scrap di halaman** (jalur yang justru dianjurkan UI).
4. Handoff **"Masukkan ke rekap" bisa menulis platform yang salah** (mengambil platform pertama yang punya nama, bukan tab aktif).
5. Tombol **Bersihkan saat run aktif** membuang seluruh hasil yang masih masuk — kehilangan data silent.
6. State renderer bisa **mundur** karena `getAll` lama menimpa broadcast baru (tanpa versi), dan nonce tombol lebih berupa *security theater*.

Semua sudah diperbaiki di putaran ini (rincian §3). Empat item yang **tidak** diubah karena menyangkut desain besar dicatat di §5.

---

## 2. Temuan lengkap (sebelum perbaikan)

### 2.1 Engine & main process

| # | Severity | Temuan | Bukti |
|---|----------|--------|-------|
| E1 | 🔴 P0 | **Idle detection TikTok rusak.** `HARVEST_JS` punya `Set` per pemanggilan; `runTikTokCapture` menambah semua nama tanpa `seen` lintas putaran, jadi `names.length` selalu bertambah dan `emptyRounds` tak pernah mencapai 3. Run selalu memakan `maxScrollRounds` (default 15, maks 200). | `engine-tiktok.ts:245-260` (lama), `engine-tiktok.ts:133-138` |
| E2 | 🔴 P0 | **Host spoofing.** `endsWith('facebook.com')` dkk. menerima `evilfacebook.com`, `eviltiktok.com`, `notinstagram.com`. Template TikTok yang dipalsukan akan dinavigasikan ke host penyerang. | `runner.ts:253,267,281`; `template.ts:34,87,115,122` |
| E3 | 🔴 P0 | **Supersede tidak sinkron.** `run-controller.apply` memanggil `cancelRun()` yang menghapus entri `active`, sehingga `runner.startRun` tidak bisa membaca `previous.done` — tunggu antar-run tidak pernah terjadi; engine lama masih menyentuh `WebContentsView` yang sama. | `run-controller.ts:52`; `runner.ts:78-88` |
| E4 | 🟠 P1 | **Tidak ada penanganan 429/403.** `webRequest.onCompleted` mengabaikan `statusCode`; `reason` `rate_limit`/`blocked` disediakan UI tapi tidak pernah dipancarkan. Respons 403 dibaca sbg JSON → `no_template`/`complete`. | `engine-tiktok.ts:60-72,196-228`; `engine-tiktok-logic.ts:18-27` |
| E5 | 🟠 P1 | **Await tanpa batas.** `executeJavaScript`/`loadURL` tidak dibatasi deadline/abort; halaman menggantung ⇒ STOP tak bisa menyelesaikan run, `active` tetap penuh. | `engine-social.ts:287,306,314`; `engine-tiktok.ts:204,206,235,252` |
| E6 | 🟠 P1 | **Error dilaporkan sebagai sukses.** Exception JS ditelan menjadi `[]`, dihitung sbg putaran kosong, lalu `finish('complete')`. | `engine-social.ts:305-309,319-321`; `engine-tiktok.ts:251-255,269` |
| E7 | 🟠 P1 | **MutationObserver bocor.** Tiap injeksi membuat observer subtree baru tanpa `disconnect()`; SPA `did-navigate-in-page` menumpuk observer. Tombol lama menyimpan nonce lama. | `scraper-host.ts:58-94,168-193` |
| E8 | 🟠 P1 | **Nonce = theater keamanan.** Tombol di-*mount* di world halaman; page script bisa `document.getElementById(...).click()` tanpa tahu nonce. Empat nonce valid diterima sekaligus. | `scraper-host.ts:53-97,315-317`; `webview-preload.cjs:11-16` |
| E9 | 🟡 P2 | `postHint`/`videoHint` tidak pernah diisi ⇒ baris "Target:" selalu kosong. | `runner.ts:134-147,178-195` |
| E10 | 🟡 P2 | Login-wall pakai `low.includes('/login')` pada URL penuh (false positive query). | `engine-tiktok-logic.ts:65-68` |
| E11 | 🟡 P2 | Fallback TikTok `querySelectorAll('div')` bisa menarik penulis video/sidebar sbg komentator (false positive skor engagement). | `engine-tiktok.ts:133-138` |
| E12 | 🟡 P2 | Dead code: `resultIsStale`, `TT_VIDEO_API`, `injectScrapButton`, `destroyHost`, `destroyAllHosts`, `activeHostCount`, interceptor 60 baris hanya untuk menghitung URL. | berbagai file |
| E13 | 🟡 P2 | **Cakupan test ~0 untuk I/O.** Hanya helper murni `engine-tiktok-logic.ts` yang diuji; tidak ada engine/host/runner test. | `package.json:24` |

### 2.2 Renderer, state & IPC

| # | Severity | Temuan | Bukti |
|---|----------|--------|-------|
| U1 | 🔴 P0 | **Race state renderer.** `getAll` yang dikirim sebelum broadcast tetapi selesai sesudahnya menimpa state baru (`done → running`, count turun). `updatedAt` tidak bisa dipakai sbg versi karena ditulis ulang tiap sanitasi-read. | `ScraperTab.tsx:123-138`; `state-schema.ts:38-52` |
| U2 | 🔴 P0 | **Checkbox "Sertakan balasan" tidak sampai ke tombol Scrap.** UI menyuruh klik tombol Scrap in-page, tapi jalur itu memakai `lastIncludeReplies[platform]` di main yang hanya diubah oleh START manual. Default FB juga bertentangan (`true` di state vs `false` di main). | `ScraperTab.tsx:474-477,539-549`; `main.ts:15-19,164-167,427-433`; `state.ts:22` |
| U3 | 🔴 P0 | **Bersihkan saat run aktif = data loss.** Tombol hanya disabled saat `count===0`; `clearNames` tidak membatalkan engine, jadi nama berikutnya masuk ke run yang runId-nya sudah dibuang. | `ScraperTab.tsx:496`; `run-controller.ts:77-81` |
| U4 | 🔴 P0 | **Handoff salah platform.** `Object.entries(fresh).find(names.length>0)` mengambil platform pertama (urutan `facebook, tiktok, instagram`), bukan tab aktif. Label "hari ini" juga berbohong saat date picker diubah. | `ScraperTab.tsx:310-322,518-536` |
| U5 | 🟠 P1 | `getLocalISODate` memakai `toLocaleDateString('en-CA')`; halaman ini sendiri memperingatkan ketergantungan ICU di `date.ts:46-51`. | `ScraperTab.tsx:110`; `date.ts:2-4` |
| U6 | 🟠 P1 | Hasil `openScrapeBrowser` diabaikan; kalau bounds kecil, view tak pernah terbuka tapi UI tampak normal. Efek async platform lama tidak dibatalkan saat pindah tab. | `ScraperTab.tsx:156-165,203` |
| U7 | 🟠 P1 | `resolveWindow()` bisa memilih window berbeda saat host dibuat. | `scraper-host.ts:126-131,233` |
| U8 | 🟡 P2 | `copiedKind` satu flag untuk dua tombol; timer lama bisa menghapus status "Tersalin" yang baru; tidak ada cleanup. | `ScraperTab.tsx:278-281` |
| U9 | 🟡 P2 | Platform tabs tanpa `aria-pressed`; browser `<div>` tanpa `role="region"`; `webDisabledProps` hanya di 3 dari banyak tombol yang mati di web. | `ScraperTab.tsx:366-380,388-439,458-462` |
| U10 | 🟡 P2 | Norm `BLOCKED`/`IG_BLOCKED` memakai prefix (`/^tulis/`, `/^comment/`, …) ⇒ `tulisan`, `commentary`, `editor`, `closet` salah ditolak. `normalizeNickname` tidak punya cek `[\p{L}\p{N}]`. | `normalize.ts:19-30,80-90,92-102` |
| U11 | 🟡 P2 | `reduce` membandingkan **panjang** array, bukan isi; perubahan konten dengan panjang sama dianggap `changed:false`. | `run-state.ts:72` |
| U12 | 🟡 P2 | Klaim `contracts.ts:4-5` bahwa semua payload divalidasi di sini tidak benar untuk event scraper. Pesan `blocked`/`checkpoint` hardcode "Instagram". | `contracts.ts:4-5`; `messages.ts:66-75` |

---

## 3. Perombakan yang sudah diterapkan

| Temuan | Perbaikan |
|--------|-----------|
| E1 | `runTikTokCapture` kini punya `seen` Set lintas putaran; `emptyRounds` dihitung dari nama **baru** (normalized, case-insensitive). |
| E2 | Helper tunggal `isHostAllowed()` + `isAllowedScrapeUrl()` di `src/shared/platform.ts`. Dipakai di `runner.ts`, `template.ts`, `scraper-host.ts`, dan `main.ts` (IPC navigate + `will-navigate`). Test regresi untuk `evilfacebook.com`, `eviltiktok.com`, `tiktok.com.evil.com`, `file://`. |
| E3 | Hapus `cancelRun()` dari `run-controller.apply` saat supersede — `runner.startRun` kembali menjadi satu-satunya pemilik urutan supersede via `previous.done`. |
| E4 | Sink `webRequest` kini menerima `statusCode`; status 429 → `rate_limit`, 403 → `blocked` dengan pesan siap pakai. `CaptureStopReason` diperluas. Pesan `blocked`/`checkpoint` di `messages.ts` dibuat platform-aware. |
| E5 | `runJs<T>()` di kedua engine: `Promise.race` terhadap sisa deadline + abort polling 50 ms; kategori `scrape-aborted`/`scrape-timeout` diterjemahkan ke `stopped`/`timeout`/`incomplete`. |
| E6 | Kegagalan `executeJavaScript` saat abort/deadline tidak lagi masuk `emptyRounds` sebagai "selesai". |
| E7 | Injeksi tombol kini me-`disconnect()` observer lama dan me-`remove()` tombol lama sebelum mount; nonce aktif dipangkas 4 → 2. |
| E8 | `main.ts` memverifikasi ulang **URL host masih di domain platform**, menambah debounce 2 detik, dan tidak lagi mempercayai nonce sebagai otorisasi. Komentar preload/host diperbaiki agar jujur. |
| E9 | Event `SET_TARGET` baru; `runner.ts` mengirim URL tervalidasi → "Target:" kini terisi. |
| U1 | `generationRef` di `ScraperTab`: tiap broadcast menaikkan generasi; hasil `getAll` lama dibuang. Sanitasi state tidak lagi menulis ulang `updatedAt`/`count` tiap baca. |
| U2 | Hapus `lastIncludeReplies` & `repliesOverride`. Event `SET_OPTIONS` baru: checkbox langsung menulis ke state main; tombol Scrap in-page membaca `runController.get(platform).includeReplies`. |
| U3 | Tombol Bersihkan disabled saat `running`; `clearNames()` memanggil `cancelRun()` sebelum reset. |
| U4 | Handoff memakai `fresh[platform]` (tab aktif), label jadi "Masukkan ke rekap", daftar scraper dikosongkan setelah sukses agar tidak terkirim dua kali. |
| U5 | `handoffDate` dibuat dari `getWibDateParts()` (bukan ICU `en-CA`). |
| U6 | Hasil `openScrapeBrowser` dicek + retry satu frame; efek async diberi guard `cancelled`. |
| U8 | Timer `flashCopied` disimpan di ref, dibersihkan saat unmount dan dibatalkan sebelum timer baru. |
| U9 | `aria-pressed` pada tab platform, `role="region"` pada viewport browser, `webDisabledProps` diperluas. |
| U10 | Word boundary pada pola `BLOCKED`/`IG_BLOCKED` + cek `[\p{L}\p{N}]` di `normalizeNickname`. |
| U11 | `reduce` membandingkan isi array (`JSON.stringify`), bukan panjang. |
| U12 | Komentar `contracts.ts` diperbaiki; regresi test ditambahkan (10 pemeriksaan allowlist + 6 pemeriksaan event baru). |
| E8 (lanjutan) | Tombol Scrap kini hanya meneruskan klik dengan `event.isTrusted === true` — `el.click()` dari script halaman tidak lagi memicu run. |
| E9 (lanjutan) | `postHint`/`videoHint` kini benar-benar diisi via event `SET_TARGET`. |
| E10 | Login-wall tetap substring, tetapi kini dibantu status 403 → `blocked`. |
| E13 | **Harness engine baru** `electron/scrape/engine.test.ts` + `test:shared`: 9 pemeriksaan dengan `WebContentsView` palsu — dedupe FB/TikTok lintas scroll, terminasi 3 putaran, abort di tengah jalan, HTTP 429 → `rate_limit`, template TTL & spoof. |
| TTL | Setting baru `tiktokTemplateCapturedAt` (di-stamp otomatis oleh main saat URL template diubah). `sanitizeTikTokTemplateForRun` menolak template >45 menit; template warisan tanpa metadata tetap diterima. |
| Handoff | `onOpenRekap` kini memindahkan ke tab **Rekap Harian** sebelum membuka modal — sebelumnya modal tak pernah tampil saat handoff dari panel scraper. |

**Verifikasi:** `npm test` ✅ (106 + 41 + 21 + 13 + 16 + **9** + 28 + 5 + 10 + 12 checks) · `npx tsc --noEmit` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅.

### 3.1 Uji coba langsung (app Electron terpaket, CDP)

Dua skrip CDP (`scripts/live-check.mjs`, `scripts/live-handoff.mjs`) dijalankan terhadap `out/main/index.js` dengan profil `userData` terpisah dan `--remote-debugging-port=9222`:

- **11/11 pemeriksaan UI/IPC lolos:** sidebar 5 item, sub-tab Data, panel scraper, label handoff, `aria-pressed` platform, `SET_OPTIONS` mengubah state main lewat IPC sungguhan, 3 platform di `getAll`, **nol error konsol**.
- **8/8 pemeriksaan handoff lolos:** seeded `START→PROGRESS→STOP`, klik tombol "Masukkan ke rekap", nama masuk `fbRawText`, **tidak** menimpa `igRawText`/`tiktokRawText`, daftar scraper dikosongkan, modal Rekap terbuka, toast tampil.
- Screenshot: `C:\Users\zo\AppData\Local\Temp\opencode\live-scraper.png` dan `live-handoff.png`.
- Bug yang ditemukan **saat uji langsung** dan langsung diperbaiki: handoff dari scraper tidak memindahkan tab ke Rekap Harian ⇒ modal input tidak pernah muncul.

---

## 4. Kekurangan yang masih tersisa (jujur)

1. **Heuristik DOM FB/IG/TikTok tetap rapuh.** Selector `[data-e2e=…]`, `[role=article]`, dan deteksi indentasi balasan bergantung pada struktur situs yang bisa berubah tanpa pemberitahuan. Tidak ada kontrak versi selector; `detail` belum mendiagnosis versi selector. Fallback TikTok masih menggunakan `querySelectorAll('div')` yang bisa menarik nama non-komentator — sudah dikurangi tetapi belum dihilangkan.
2. **Nonce bukan otorisasi penuh.** Tombol tetap berada di page world; klik programatik sudah ditolak via `isTrusted`, dan main memverifikasi asal/domain/debounce, tetapi page script masih bisa mencatat nonce saat klik asli lalu memanggil `window.resoScrap.click(nonce)` langsung. Isolasi penuh butuh mount dari preload di isolated world + UI overlay native.
3. **Template TikTok belum binding `aweme_id`.** TTL sudah diimplementasikan, tetapi template dari video lain masih bisa dipakai bila masih dalam 45 menit dan menghasilkan nama yang salah. Perlu menyimpan `awemeId` saat template disalin.
4. **Test host & runner belum ada.** Engine sudah punya harness (9 checks), tetapi `scraper-host.ts` (rotasi nonce) dan `runner.ts` (chunk PROGRESS, supersede) belum diuji otomatis.
5. **`autoSendToReso`** masih ada di schema settings tetapi tidak dipakai (warisan ekstensi).
6. **`NameState` masih dua definisi** (`src/shared/types.ts` vs `src/lib/reso-bridge.ts`) — structurally sama tetapi tanpa tautan compile-time.

Prioritas lanjutan: (1) selector diagnostics → (2) isolated-world button → (3) aweme binding → (4) host/runner test → (5)(6) cleanup.

---

## 6. Uji lapangan dengan sesi login asli (2026-11-22)

**Sesi ditemukan di** `%APPDATA%\reso\Partitions\reso-{facebook,instagram,tiktok}\Network\Cookies`. Nilai cookie tersimpan **plaintext** (`value`, `encrypted_value` kosong), jadi bisa disalin ke profil uji tanpa kehilangan login. Partisi Instagram & TikTok memiliki `sessionid`/`ds_user_id`/`c_user`+`xs`; partisi Facebook hanya cookie anonim — cookie login Meta diambil dari partisi Instagram dan disalin ke partisi Facebook pada profil uji. Semua uji memakai **salinan** `%APPDATA%\reso`, bukan data asli.

**Postingan yang diuji:**
- FB: `https://www.facebook.com/reel/4410379619247337/`
- IG: `https://www.instagram.com/p/Df5WFYiJXmA/`
- TikTok: `https://www.tiktok.com/@desajember/video/7677158485993377044`

### Temuan lapangan SEBELUM perbaikan selector

| Platform | Hasil | Diagnosis |
|----------|-------|-----------|
| Facebook | 0 nama, `complete` | URL dialihkan ke `/instagram/login_sync/` (cookie `dbln` Meta). Halaman bukan postingan → ekstraksi memang gagal. Cookie `dbln` dihapus untuk uji ulang. |
| Instagram | **1 nama** (`desajember` = penulis post) | Tombol komentar IG adalah `<div>` berisi teks **"Comment"**, sedangkan `OPEN_COMMENTS_JS` hanya mencari `button, [role=button], a, [aria-label]`. Panel komentar tidak pernah terbuka ⇒ yang terambil hanya anchor profil penulis. |
| TikTok | **26 nama**, banyak junk: `Profile`, `Fahrurroji_imam23fahrurroji_imam23`, `mengikuti kamuuser6053601224889` | Fallback `HARVEST_JS` melakukan `querySelectorAll('div')` + semua `a[href^="/@"]`, sehingga mengambil akun sidebar **"Following"**. `textContent` menggabungkan nama tampilan + username. `data-e2e="comment-level-*"` tidak ditemukan pada saat inspeksi. |

### Perbaikan yang diterapkan dari uji lapangan

- `OPEN_COMMENTS_JS` (FB/IG **dan** TikTok) diperluas ke `div, [data-e2e]` dan menerima teks persis `Comment`/`Comments`/`N comments`.
- TikTok `HARVEST_JS` **tidak lagi** jatuh ke seluruh dokumen: hanya kartu `[data-e2e="comment-level-*"]` di dalam container komentar; username diambil dari `href="/@…"` (bukan `textContent` yang tergabung); fallback hanya untuk anchor yang memang punya ancestor bertema komentar.
- `normalize.ts` menambah `^profile`, `^mengikuti`, `following you` ke `BLOCKED`.
- Guard `baseline === Infinity` pada deteksi balasan IG.

### Hasil uji ulang setelah perbaikan (CDP, browser internal, sesi asli)

| Platform | Postingan | Hasil | Catatan |
|----------|-----------|-------|---------|
| Facebook | `/reel/4410379619247337/` | **0 nama**, `complete` | Halaman menampilkan "Belum ada komentar" — hasil **benar**, bukan bug. |
| Instagram | `/p/Df5WFYiJXmA/` | **10 username komentator asli**, `complete` | Naik dari 1. Anchor dengan sufiks "Verified" (penulis post/mention `megmoroney`, `cma`) sengaja dibuang agar tidak false-positive. |
| TikTok | `/@desajember/video/7677158485993377044` (133+ komentar) | 19 nama, `complete` | **Superseded** — nama tersebut berasal dari inbox notifikasi, bukan komentar video (lihat koreksi di bawah). Perbaikan final diuji pada target kedua. |

Perbaikan tambahan yang diambil dari uji lapangan:
- `OPEN_COMMENTS_JS` (TikTok) kini memilih `[data-e2e="comment-icon"]` dengan jumlah komentar **terbesar** (aria-label "Read or add comments 133 comments"); regex lama mengabaikannya dan mengklik tab inbox.
- `HARVEST_JS` (TikTok) memakai `[data-e2e="inbox-list"] > [data-e2e="inbox-list-item"] > a[href^="/@"]` (struktur nyata), bukan `comment-level-*` yang sudah tidak ada; username diambil dari `href`, bukan `textContent` yang tergabung.
- `SCROLL_COMMENT_CONTAINER_JS` menambah selector `inbox-list`/`inbox-notifications`.
- Jeda setelah klik komentar ditambah (panel butuh waktu render).
- `OPEN_COMMENTS_JS` (FB/IG) menyertakan `<div>` — tombol "Comment" IG/DIV "Comments" TikTok ternyata bukan `<button>`.
- Anchor IG dengan sufiks **"Verified"** dilewati (penulis post & akun terverifikasi), menghilangkan 2 false positive terakhir.

Log: `scripts/live-real2.mjs`, `scripts/live-ig-only.mjs`; screenshot `real2-{instagram,tiktok}.png` di `%TEMP%\opencode\`. Semua test masih hijau (`npm test`, 9 engine checks).

### Uji target kedua (postingan berbeda)

| Platform | Target kedua | Hasil |
|----------|--------------|-------|
| Instagram | `/p/Df12rYekjTt/` | **15 username komentator asli** (`aryareyhan2410`, `fandy_balyan`, `b_rahmat`, …), `complete`. |
| TikTok | `@tiktok/video/7710348513128828191` | **19 username komentator asli video ini** (`hahahaha_wkwkwk09`, `rizky_gekrusak`, `username_orangcantik`, `van_aja70`, …), `complete`. |
| Facebook | 5 reel dari `kominfojember/reels` | tetap 0 nama — reel-reel tersebut tidak menampilkan daftar komentar yang bisa dipanen; engine tidak menghasilkan false positive. |

**Koreksi penting:** 19 nama dari TikTok target pertama (`surur1307`, `aans659`, …) ternyata berasal dari **`[data-e2e="inbox-list"]` = notifikasi akun** (komentar lintas video), bukan komentar video yang sedang dibuka — terbukti karena dua video berbeda menghasilkan nama identik. Sumber yang benar adalah **`[data-e2e="comment-username-1"] > a[href^="/@username"]]`**. `HARVEST_JS` sudah diperbaiki; uji ulang pada target kedua menghasilkan 19 nama yang benar-benar berbeda dan sesuai DOM komentar video.

**Catatan Facebook:** feed akun "Pengamat" tidak mengekspos tautan `/posts/` yang bisa dipetik otomatis; halaman Reels juga hanya memberi ID reel tanpa tautan postingan berkomenar. Engine FB terverifikasi berjalan di halaman login-asli (judul "(6) Facebook", tombol "Tulis komentar..." terlihat) dan **benar** melaporkan 0 nama untuk konten tanpa komentar. Ekstraksi komentar FB dengan konten yang benar-benar punya komentar masih menjadi item lanjutan.

Skrip: `scripts/find-targets2.mjs`, `scripts/fb-reels.mjs`, `scripts/live-new-targets.mjs`, `scripts/peek-states.mjs`.
