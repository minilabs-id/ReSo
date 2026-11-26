# Audit Efisiensi & Performa — ReSo Desktop v1.0.89

**Tanggal:** 2026-11-26
**Metode:** pengukuran CDP (`Performance.getMetrics`, `Runtime.evaluate`), ukuran artefak build, dan review pola render/IPC/database.

---

## 1. Ringkasan

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Runtime after-load | ★★★★★ | Reload 427 ms, script 60 ms, layout 15 ms, heap 9,7 MB |
| Cold start | ★★★☆☆ | ~5,4 s dari proses launch sampai H1 tampil |
| Ukuran bundle | ★★★★☆ | Awal 1,24 MB JS + 74 KB CSS; total aset 4,5 MB (lazy chunks) |
| IPC & database | ★★★★☆ | Ringan; satu jendela, data 120 hari |
| Penanganan log | ★★★☆☆ | Log error lokal baik, tapi tanpa rotasi ukuran |

**Total: 4.1 / 5** — performa runtime sangat baik; yang bisa ditingkatkan ada di startup dan kebersihan jangka panjang.

---

## 2. Pengukuran langsung

| Metrik | Nilai |
|--------|-------|
| Cold start (launch → H1) | **5.437 ms** |
| Reload renderer (cache diabaikan) | **427 ms** |
| `ScriptDuration` (reload) | 0,060 s |
| `LayoutDuration` | 0,015 s |
| `RecalcStyleDuration` | 0,016 s |
| `TaskDuration` | 0,141 s |
| JS heap setelah render | **9,69 MB** (limit 3.586 MB) |
| Node DOM | 164 elemen |
| Aset `out/renderer/assets` | 4.545 KB total |

### Rincian aset terbesar
| File | Ukuran | Dikapa |
|------|--------|--------|
| `index-*.js` | 1.238 KB | **Dekat awal** (dari `index.html`) |
| `xlsx-*.js` | 846 KB | Lazy (ekspor Excel) |
| `EngagementChart-*.js` | 803 KB | Lazy (`React.lazy`) |
| `jspdf.es.min-*.js` | 585 KB | Lazy (ekspor PDF) |
| `index.es-*.js` | 353 KB | Lazy |
| `html2canvas.esm-*.js` | 342 KB | Lazy |
| `index-*.css` | 74 KB | Awal |

`index.html` hanya memuat satu JS + satu CSS pada awal — pustaka berat sudah
di-`import()` dinamis di `useReportExports.ts` (baris 112, 113, 335, 410). Ini **sudah baik**.

---

## 3. Yang sudah efisien ✅

- **Satu pemilik data**: `useRekapData()` — tidak ada `onSnapshot` duplikat di komponen.
- **Satu pemilik state scraping**: `runController` di main; renderer hanya merender siaran.
- **Perhitungan berat di-`useMemo`**: statistik, chart 7 hari, sorting pegawai, agregasi mingguan/bulanan.
- **Debounce**: `useDebouncedValue` untuk preview matching di input rekap.
- **Lazy loading**: `EmployeeManager`, `EngagementChart`, dan semua library ekspor.
- **IPC ringan**: `safeHandle` satu channel per operasi; `batchSave` transaksi atomik untuk tulis banyak.
- **Polling terukur**: state scraping tiap 4 dtk; bounds browser hanya dikirim saat berubah (throttle 250 ms).
- **Tidak ada telemetri** — privasi & overhead jaringan nol.

---

## 4. Temuan & kritik

### P1 — Layak diperbaiki

| # | Masalah | Bukti | Dampak |
|---|---------|-------|--------|
| E1 | **Jeda buatan 200 ms saat startup.** | `src/App.tsx:76` — `setTimeout(..., 200)` "agar transisi tidak berkedip". | Menambah ~4% dari cold start tanpa manfaat nyata di Electron (tidak ada transisi halaman web). |
| E2 | **Log error tanpa rotasi.** | `electron/main.ts` `logError()` menulis `reso-error.log` selamanya. | Bila renderer error berulang, file bisa tumbuh besar di `%APPDATA%`. |
| E3 | **Chunk awal 1,24 MB masih bisa dipangkas.** | `index-*.js` memuat seluruh shell + motion + base-ui + shared. | Parse ~60 ms saat reload — saat ini masih cepat, tapi akan bertambah seiring fitur. |

### P2 — Perbaikan ringan / debt

| # | Masalah | Bukti |
|---|---------|-------|
| E4 | `loadRows('settings')` melakukan **N+1 IPC** (`listSettings` lalu `getSetting` per key). | `src/lib/local-db.ts:100-113` — praktis hanya 0–1 key, jadi dampaknya kecil. |
| E5 | Tiga `WebContentsView` (IG/FB/TT) tetap ada setelah dipakai, hanya di-`hideHost()`. | `electron/scrape/scraper-host.ts` — memori sesi sengaja dipertahankan untuk login; trade-off disengaja. |
| E6 | Cek auto-update tiap startup memakai jaringan. | `main.ts` `setTimeout(..., 4000)` — sudah jeda, aman. |
| E7 | `broadcastDbChanged()` mengirim ke semua `BrowserWindow`. | Saat ini hanya satu jendela — tidak ada overhead nyata. |
| E8 | Installer ~99 MB. | Ukuran Electron + native + library PDF/Excel; wajar untuk desktop offline. |

---

## 5. Rekomendasi

| Prioritas | Tindakan |
|-----------|----------|
| **P1** | E1 — hapus jeda 200 ms di `App.tsx` (atau turunkan ke 0); ukur ulang cold start. |
| **P1** | E2 — rotasi log: bila `reso-error.log` > 1 MB, pindahkan ke `reso-error.1.log` sebelum append; batasi 3 file. |
| **P2** | E3 — pecah lagi chunk awal: lazy-load `SettingsTab`, `InputModal`, dan `UnmatchedReview` bila ternyata lebih banyak halaman kecil yang jarang dibuka. |
| **P2** | E4 — ganti N+1 IPC dengan satu `getAllSettings()` IPC bila jumlah kunci bertambah. |
| **P2** | Tambah anggaran bundle di CI (mis. gagal bila chunk awal > 1,3 MB) supaya regresi terdeteksi. |
| **P2** | E2 lanjutan — tombol "Salin log error" di Pengaturan agar operator mudah melaporkan. |

### Target yang realistis
- Cold start < 4 s (dengan E1 + mengurangi chunk awal).
- Chunk awal < 1 MB.
- Heap setelah render < 15 MB (sudah terpenuhi).

---

## 6. Kesimpulan
Untuk aplikasi desktop offline dengan ratusan pegawai dan ~120 hari rekap,
performanya **sudah sangat memadai**. Tidak ada bottleneck CPU/memori yang
mengganggu operasi. Fokus perbaikan berikutnya bukan kecepatan mentah, melainkan
**startup**, **rotasi log**, dan **guard ukuran bundle** agar tetap efisien saat
fitur bertambah.

Audit ini tidak mengubah kode — hanya pengukuran & rekomendasi.
