# Audit scraping Instagram per jenis postingan

**Tanggal:** 2026-11-26
**Tujuan:** menguji ekstraksi nama komentar untuk (1) postingan banyak foto/carousel,
(2) postingan video/reel, (3) postingan satu foto — dan memastikan hasil masuk rekap.

## 1. Kandidat yang diuji (dari beranda & postingan yang ditemukan)

| Jenis | URL |
|-------|-----|
| Foto/carousel | `instagram.com/p/Df12rYekjTt/` |
| Carousel | `instagram.com/p/DgCratnknyJ/`, `/p/DgAJW8kkv0o/` |
| Video/reel | `instagram.com/reels/Df1KNKmPCUm/` |

## 2. Perbaikan yang diterapkan saat audit

| # | Masalah | Perbaikan |
|---|---------|-----------|
| A1 | `plausibleScrapeTarget()` hanya mengenali `/reel/`, bukan `/reels/` — reel ditolak sebelum engine jalan. | Tambah `/reels/`. |
| A2 | Regex `OPEN_COMMENTS_JS` tidak cocok dengan teks IG terkini **"View all 2,271 comments"** (koma pada angka). | Regex menerima `[\d,]+`. |
| A3 | IG mengabaikan `element.click()` dari `executeJavaScript`. | Tambah percobaan klik trusted lewat `webContents.sendInputEvent` (`mouseMove/down/up`) dengan beberapa kandidat koordinat. |
| A4 | Saat panel dibuka, host bisa tetap tersembunyi (viewport 0) bila bounds belum siap. | `ensureOpen()` + `ResizeObserver` di `ScraperTab`. |
| A5 | Pesan gagal terlalu umum. | "Buka View all comments di postingan, tunggu komentar muncul, lalu klik Ambil nama lagi." |

## 3. Hasil uji langsung (jujur)

| Jenis | Host viewport | Hasil otomatis |
|-------|---------------|----------------|
| Foto/carousel | 713×581 (terlihat) | **0 nama** — panel komentar tidak terbuka |
| Carousel | 713×581 | **0 nama** — panel komentar tidak terbuka |
| Video/reel | 713×581 | **0 nama** — panel komentar tidak terbuka |

### Kenapa belum berhasil
1. Klik programatik pada `<a href="/p/.../comments/">` **diabaikan** Instagram.
2. Klik trusted lewat `webContents.sendInputEvent` **juga diabaikan** (semua koordinat: raw + offset view).
3. Navigasi langsung ke `/p/.../comments/` **di-redirect kembali** ke `/p/.../`.
4. API internal `/api/v1/media/<id>/comments/` mengembalikan hanya `{"status":"ok"}` (tanpa array komentar).
5. Tanpa panel komentar, tidak ada anchor username komentator di DOM → engine tidak punya apa pun untuk dipanen.

Ini adalah **pembatasan anti-automasi Instagram**, bukan bug handoff/DB. Alur handoff
(nama → rekap harian) sudah terverifikasi sebelumnya (**15 nama** otomatis masuk rekap)
ketika komentar dibuka oleh operator sebelum klik Scrap.

## 4. Kesimpulan
- **Belum bisa mengklaim "semua berhasil" otomatis** untuk ketiga jenis postingan.
- Yang sudah diperbaiki: validasi reel, regex tombol komentar, percobaan klik trusted,
  stabilitas host, dan pesan panduan operator.
- **Alur yang masih bekerja**: operator membuka komentar di browser internal → klik
  **Scrap** → nama otomatis masuk rekap harian (tanpa copy/paste).

## 5. Rekomendasi lanjutan
1. Pakai **GraphQL Instagram dengan `doc_id` + `X-CSRFToken`** seperti pola TikTok
   (intersep respons komentar), bukan klik DOM — tahan terhadap perubahan UI.
2. Atau sediakan mode "bantu buka komentar": tombol Scrap menunggu hingga anchor
   komentar muncul (maks 30 dtk) sebelum memutuskan gagal.
3. Uji ulang dengan akun Instagram yang tidak kena checkpoint/rate-limit.
