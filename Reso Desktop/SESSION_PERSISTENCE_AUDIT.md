# Audit & Penguatan Sesi Login Browser Internal

**Tanggal:** 2026-11-23
**Permintaan:** sesi login sosmed lebih tahan, tidak sering logout; halaman default = profil/postingan akun sendiri.

---

## 1. Kondisi sebelumnya

| Aspek | Status | Catatan |
|-------|--------|---------|
| Partition browser | ✅ `persist:reso-<platform>` — cookie tersimpan di userData. | Sudah benar. |
| View browser | ✅ `WebContentsView` persisten per platform, hanya disembunyikan saat pindah menu. | Tidak di-destroy. |
| Cookie **session** (tanpa `expirationDate`) | ❌ **Tidak tersimpan ke disk** — hilang saat aplikasi ditutup. | Penyebab utama "sering logout". |
| User-Agent | ❌ UA Electron (`Electron/33`) memicu deteksi bot/checkpoint TikTok/IG. | Faktor logout tambahan. |
| Halaman awal | ❌ Selalu homepage `facebook.com` / `tiktok.com` / `instagram.com`. | Operator harus cari profil/post sendiri tiap buka. |

Tidak ada kode yang menghapus cookie/session saat startup — `hardenSession()` hanya mematikan izin kamera/mikrofon.

---

## 2. Perbaikan diterapkan

### A. Sesi lebih tahan (`electron/scrape/scraper-host.ts`)
- `ensureSession()` memasang **UA Chrome biasa** (`Chrome/133`, tanpa "Electron/xx") pada tiap session platform — mengurangi checkpoint/anti-bot.
- `persistSessionCookies()` (dipanggil tiap `did-finish-load`, throttled 60 dtk):
  - membaca semua cookie session,
  - menulis ulang cookie yang belum punya expiry dengan `expirationDate` **+1 tahun**,
  - sehingga cookie auth tetap ada di disk setelah aplikasi ditutup.
- `WebContentsView` tetap persisten & hanya hidden — sesi tidak terputus saat pindah menu.

### B. Halaman awal profil/postingan sendiri
- Preferensi baru di settings-store (divalidasi domain): `homeUrlFacebook`, `homeUrlInstagram`, `homeUrlTiktok` — **tidak ditampilkan di menu Pengaturan** supaya tetap ringkas.
- `ScraperTab`:
  - saat host belum punya halaman, memakai halaman awal tersimpan, baru fallback ke homepage;
  - tombol **Bookmark** di toolbar browser: "Jadikan halaman awal" — menyimpan URL yang sedang terbuka (mis. profil/postingan sendiri) untuk platform itu.
- Halaman yang sudah terbuka tetap dipulihkan (tidak pernah di-navigasi ulang ke homepage hanya karena panel di-mount).

---

## 3. Verifikasi CDP (app terpaket, profil uji)

| Pengujian | Hasil |
|-----------|-------|
| Simpan `homeUrlFacebook` via bridge lalu buka platform Facebook | Address bar = URL tersimpan ✅ |
| Buka postingan TikTok → klik Bookmark → `homeUrlTiktok` | Tersimpan persis ✅ |
| UA host TikTok | `Chrome/133.0.0.0 Safari/537.36` (tanpa Electron) ✅ |
| Cookie sesi dibaca & ditulis ulang | 53 cookie TikTok + 9 cookie Facebook diproses ✅ |
| Cookie expiry | Ditetapkan 1 tahun ke depan (kode `persistSessionCookies`) ✅ |
| Test engine (fake view tanpa `sendInputEvent`) | Tidak lagi membuang waktu; 9 checks OK ✅ |

`npx tsc --noEmit` ✅ · `npm run typecheck:desktop` ✅ · `npm test` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅ · bundle 1.263 KB.

---

## 4. Cara pakai
1. Buka **Rekap Harian ▸ Ambil Nama**, pilih platform.
2. Login sekali di browser internal (jika belum).
3. Buka profil/postingan sendiri, lalu klik ikon **Bookmark** ("Jadikan halaman awal").
4. Setiap kali platform dibuka, halaman itu yang muncul — session tetap tersimpan walau aplikasi ditutup.

## 5. Catatan
- Kredensial/login **tidak pernah** disimpan ReSo; hanya cookie browser bawaan Electron di profil pengguna.
- Bila platform melakukan logout sendiri (mis. karena verifikasi/checkpoint dari pihak platform), operator perlu login ulang sekali; setelah itu cookie dipersist kembali otomatis.
