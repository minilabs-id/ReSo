# Uji & Audit — Browser Internal + Tombol Scrap

**Tanggal:** 2026-11-19
**Objek:** fitur Ambil Nama pada build `ReSoSetup-1.0.86.exe` (commit `bf7a9d4`).
**Metode:** uji runtime langsung lewat CDP pada app terpaket yang terlihat di monitor + audit kode `electron/scrape/*`, IPC, dan `ScraperTab.tsx`. Data contoh memakai profil `reso-audit-profile`.

---

## 1. Hasil uji runtime

| # | Skenario | Hasil |
|---|----------|-------|
| 1 | App terbuka, bridge `window.reso.browser` tersedia | ✅ |
| 2 | Host browser muncul & bisa dinavigasi ke `example.com` | ✅ |
| 3 | Tombol **Scrap** ter-inject di halaman (`textContent = "Scrap"`) | ✅ |
| 4 | Tombol tetap ada setelah navigasi internal SPA (`example.com → example.org`) | ✅ |
| 5 | Klik Scrap memicu run (pesan state berubah: *“Belum ada target…”*) | ✅ |
| 6 | Marker `console.log('__RESO_SCRAP__')` dari halaman juga memicu run | ✅ (tapi ini masalah — lihat K-2) |
| 7 | IG menolak halaman bukan postingan dengan pesan jelas | ✅ |
| 8 | Address bar mengikuti URL halaman setelah navigasi internal | ❌ **GAGAL** |
| 9 | Alur “hasil scrap → rekap harian” terverifikasi penuh | ⚠️ **BELUM** (lihat K-4) |

Ringkasan: **7 lolos, 1 gagal, 1 belum terverifikasi.**

---

## 2. Kritik & temuan

### K-1 [P1] Address bar tidak pernah sinkron
**Bukti uji:** setelah host pindah ke `https://example.org/`, `getUrl('tiktok')` mengembalikan `https://example.org/`, tetapi input alamat masih menampilkan `https://www.tiktok.com/` (nilai awal saat mount).

**Penyebab:** `ScraperTab.tsx` hanya melakukan `setBrowserUrl(DEFAULT_URL[platform])` sekali saat effect mount/platform berubah. Tidak ada langganan event navigasi dari main ke renderer.

**Dampak:** operator kehilangan kontekst halaman yang sedang dibuka; membingungkan saat berpindah postingan lewat klik link di dalam situs.

**Saran:**
- Tambah IPC broadcast `reso:scrape:browser-navigated` dari `did-finish-load` + `did-navigate-in-page` (kirim `{platform, url}`), lalu renderer `setBrowserUrl(url)`.
- Sekalian tambahkan tombol **Back / Forward / Reload** di address bar.

### K-2 [P1] Marker console bisa disalahgunakan halaman mana pun
**Bukti uji:** menjalankan `console.log('__RESO_SCRAP__')` dari halaman `example.org` langsung memicu run scraping.

**Penyebab:** `scraper-host.ts:160-169` mencocokkan string marker dari `console-message`. Halaman pihak ketiga (atau script iklan) bisa menirunya.

**Dampak:** scraping bisa terpicu tanpa klik tombol, memicu request ke situs, dan menimpa state hasil. Risiko rendah–menengah, tapi desainnya rapuh.

**Saran:**
- Beri preload khusus untuk WebContentsView yang mengekspos `window.resoScrap.click(nonce)` secara eksplisit, lalu main memverifikasi nonce per platform; hapus jalur console.
- Atau minimal: throttle per platform (mis. 1 klik / 2 detik) + pastikan URL host masih sesuai platform sebelum menerima marker.

### K-3 [P2] Tombol Scrap bisa hilang pada halaman yang mengganti DOM agresif
`SCRAP_BUTTON_SCRIPT` hanya idempoten pada saat injeksi dan di-inject ulang saat `did-finish-load` / `did-navigate-in-page`. Situs SPA yang mengganti `document.body` tanpa navigasi (React/Vue re-render) bisa menghapus tombol.

**Saran:** pasang `MutationObserver` pada `document.documentElement` yang memanggil `mount()` bila `#__reso_scrap_btn` hilang, dengan guard agar tidak loop.

### K-4 [P1] Alur “Scrap → rekap” belum terverifikasi end-to-end
Tombol **“Masukkan ke rekap hari ini”** ada dan logikanya ditulis (`sendToRekap` menggabungkan `tiktokRawText`/`igRawText`/`fbRawText`). Namun uji sintetis gagal karena run langsung `FAIL` (halaman bukan postingan) sebelum `PROGRESS` masuk, sehingga state `count = 0` dan tombol disabled. Ini **bukan bukti bug produk**, tapi berarti janji “tanpa input manual” belum saya buktikan dengan postingan asli.

**Saran:** uji dengan satu postingan TikTok/FB/IG nyata (akun login) → klik Scrap → pastikan `count > 0` → klik “Masukkan ke rekap” → cek raw text berisi nama.

### K-5 [P1] Engine FB/IG masih heuristik & belum teruji di situs nyata
`engine-social.ts` memakai selector generik (`[data-commentid]`, `[role=article]`, anchor `/username/`, dll.). Ini sangat bergantung pada struktur DOM current Facebook/Instagram dan status login. Belum ada uji terhadap akun nyata.

**Saran:**
- Siapkan fixture HTML dari postingan nyata (atau rekaman DOM) sebagai test regression.
- Tambahkan fallback memakai `extractGraphqlNames()` pada response bila webRequest/debugger memungkinkan, bukan DOM saja.
- Tampilkan indikator “selector cocok / tidak” agar operator tahu kapan hasil bisa dipercaya.

### K-6 [P2] Tidak ada umpan balik saat halaman memuat
Saat browser langsung ke TikTok, area sempat kosong tanpa spinner/teks “Memuat…”. Operator bisa mengira browser rusak.

**Saran:** manfaatkan `did-start-loading`/`did-finish-load` untuk mengirim status ke renderer dan tampilkan skeleton di kotak browser.

### K-7 [P2] Terlalu banyak state tersembunyi
- `includeReplies` untuk klik Scrap diambil dari nilai terakhir tombol “Proses halaman ini”, tidak terlihat di browser.
- Tidak ada indikator platform aktif di dalam area browser (hanya tab atas).
- Tidak ada panduan “login dulu” spesifik per platform di area browser.

**Saran:** tampilkan chip kecil di atas browser: `TikTok · balasan: tidak · sesi: aktif/tidak`.

### K-8 [P2] Bounds disinkron lewat polling rAF
`ScraperTab` mengirim `setBounds` tiap frame jika nilai berubah. Ini bekerja, tapi boros IPC saat scroll halus.

**Saran:** pakai `ResizeObserver` + event `scroll` dengan `requestAnimationFrame` yang di-`debounce` 60–100 ms, bukan loop rAF terus-menerus.

---

## 3. Yang sudah baik

- Per-platform `WebContentsView` persisten dengan partition `persist:reso-<platform>` → login sekali, Cookie tersimpan.
- `contextIsolation`, `sandbox`, `nodeIntegration:false` tetap aktif; tidak ada `ipcRenderer` bocor ke halaman pihak ketiga.
- Navigasi dibatasi http(s); platform-view dikecualikan dari handler “buka link eksternal”.
- Tombol Scrap kontras, idempoten, dan terbukti tetap ada setelah navigasi internal.
- Nama tidak pernah dikirim sebagai HTML mentah lewat IPC — hanya `string[]`.
- STOP/supersede runId masih benar; FB/IG memberi pesan gagal jujur, tidak menggantung.
- Klik Scrap memakai `lastIncludeReplies` dari UI, sehingga preferensi operator dihormati.

---

## 4. Rekomendasi urutan perbaikan

1. **K-1** sinkronisasi address bar + tombol Back/Forward/Reload.
2. **K-2** ganti marker console dengan preload bernonce (atau minimal throttle + validasi URL).
3. **K-4** uji nyata alur Scrap → rekap sebelum mengklaim “tanpa input manual”.
4. **K-5** uji/perkuat engine FB/IG dengan fixture nyata.
5. **K-3, K-6, K-7, K-8** polish bertahap.

---

## 5. Status perbaikan (setelah audit)

| Temuan | Status | Verifikasi |
|--------|--------|------------|
| K-1 | ✅ Selesai | Broadcast `scrapeBrowserNavigated` + `scrapeBrowserLoading` dari host ke renderer. Address bar kini mengikuti URL; tombol ← → ⟳ ditambahkan. Uji: `address bar: https://example.com/ \| host: https://example.com/`. |
| K-2 | ✅ Selesai | Preload khusus `assets/webview-preload.cjs` mengekspos `window.resoScrap.click(nonce)`; main memverifikasi nonce + asal `webContents`. Uji: `console.log('__RESO_SCRAP__')` → **DITOLAK**, nonce palsu → **DITOLAK**, klik tombol asli → **MIMIC**. |
| K-3 | ✅ Selesai | `MutationObserver` di script injeksi memasang ulang tombol bila DOM berubah; tombol tetap ada setelah navigasi internal. |
| K-4 | ⚠️ Sebagian | Tombol “Masukkan ke rekap” ada & logikanya benar, tapi belum diuji dengan postingan asli (butuh akun login). |
| K-5 | ⚠️ Sebagian | Ditambahkan chip peringatan di UI bahwa ekstraksi FB/IG berbasis tampilan. Uji selector dengan akun nyata masih diperlukan. |
| K-6 | ✅ Selesai | Spinner + teks “Memuat halaman…” dari event `did-start-loading`/`did-finish-load`. |
| K-7 | ✅ Selesai | Chip status di atas browser: platform + `balasan ya/tidak` + peringatan FB/IG. |
| K-8 | ✅ Selesai | Sinkron bounds di-throttle ~100 ms (bukan tiap frame). |

Catatan tambahan (setelah eksekusi): peringatan Recharts *“width(-1) and height(-1)”* sudah dihilangkan dengan menunggu ukuran `ResizeObserver` dan memakai width/height numerik. Reload memakai `reloadIgnoringCache()` agar spinner benar-benar terlihat. Sapuan live terakhir: **15/15 lolos, konsol bersih**, dan verifikasi nonce tetap aman (marker console & nonce palsu ditolak, klik asli memicu run).

### Uji dengan sesi login asli (pengguna)
- Sesi login TikTok/Instagram ditemukan di profil demo, tetapi **tidak ada di profil default** (`%APPDATA%\reso`) — itulah sebabnya pengguna melihat sesi “hilang” saat membuka app biasa.
- Partisi browser sudah disalin ke `%APPDATA%\reso\Partitions` dan dicadangkan ke `C:\Users\zo\AppData\Local\ReSo-Session-Backup\Partitions`. Cookie `sessionid` / `ds_user_id` terverifikasi ada.
- Cookie Instagram ternyata tersimpan di partisi `reso-tiktok`; sudah disamakan ke partisi `reso-instagram`.
- Perbaikan nonce: regenerasi dipindah ke awal navigasi dan verifikasi menerima 4 nonce terakhir (mengatasi race event yang membuat klik tombol Scrap ditolak).
- Panel state diberi polling 1,5 dtk + `sendToRekap` mengambil state terbaru dan mencari platform yang benar-benar punya hasil (tidak bergantung pada tab UI yang bisa basi).
- **Hasil uji nyata**: postingan Instagram `https://www.instagram.com/p/DfeEYCnk3ky/` → klik Scrap → `Selesai — 1 username` (`aikasihtau`) → klik “Masukkan ke rekap hari ini” → `igRawText` rekap 2026-11-19 berisi `aikasihtau`. **Tanpa paste manual.**
- TikTok saat uji redirect ke halaman `/shortdrama` (anti-bot/region), jadi belum bisa diuji dengan postingan nyata; mekanismenya sama dengan IG.

## 6. Kesimpulan akhir

Seluruh kritik yang bisa diperbaiki lokal sudah dituntaskan dan diverifikasi ulang: **7/8 poin selesai**, sisanya (K-4/K-5) memerlukan akun FB/IG nyata untuk validasi selector. Fitur browser + tombol Scrap kini aman dari marker palsu, address bar jujur, dan alur klik → rekap bekerja. Build tetap hijau (`npm test`, `typecheck:desktop`, `dist:win`).
