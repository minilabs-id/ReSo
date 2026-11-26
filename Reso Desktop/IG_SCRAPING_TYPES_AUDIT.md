# Audit scraping Instagram per jenis postingan — status akhir

**Tanggal:** 2026-11-26
**Detail arsitektur:** `INSTAGRAM_ARCHITECTURE_RESEARCH.md`

## Hasil uji langsung (tombol panel "Ambil nama dari halaman ini")

| Jenis | URL | Hasil |
|-------|-----|-------|
| Foto, 2284 komentar | `instagram.com/p/Df12rYekjTt/` | **2232 username** unik → rekap harian (tuntas) |
| Carousel, 169 komentar | `instagram.com/p/DgCratnknyJ/` | **121 username** → rekap harian |
| Carousel, 11 komentar | `instagram.com/p/DgAJW8kkv0o/` | **5 username** → rekap harian |
| Reel, 378 komentar | `instagram.com/reels/Df_iOFQSKqW/` | **199 username** → rekap harian (tuntas) |
| Reel, 262 komentar | `instagram.com/reels/DeMhGZeSlri/` | **194 username** → rekap harian |
| Reel (memang 0 komentar) | `instagram.com/reels/Df1KNKmPCUm/` | **0 username**, pesan: "Postingan ini tidak punya komentar." |

Semua angka di atas berasal dari simulasi UI sungguhan: buka panel Ambil Nama →
pilih Instagram → buka postingan di browser internal → klik satu tombol di panel.
Tidak ada copy/paste manual. Rekap harian terisi otomatis via handoff.

## Perubahan yang membuatnya berhasil

1. **Jalur utama = Instagram Private Web API**, bukan klik DOM:
   `GET /api/v1/media/<pk>/comments/?can_support_threading=true&permalink_enabled=false`
   dengan cookie sesi + `X-IG-App-ID` + `X-CSRFToken`.
2. **Media pk dari shortcode URL pakai BigInt** (HTML reel memuat media
   rekomendasi yang menyesatkan).
3. **Paginasi dua mode & tuntas**: `max_id` bila `has_more_comments`, `min_id`
   bila `has_more_headload_comments`; berhenti saat semua komentar terbaca atau
   cursor habis, retry 429/5xx, guard cursor berulang, dedupe nama.
4. **Balasan**: `preview_child_comments` + endpoint `inline_child_comments`
   (hanya bila opsi balasan aktif).
5. **Target dikunci** ke postingan saat tombol ditekan; bila operator pindah
   postingan saat proses, hasil dibuang.
6. **Pesan akhir jujur** untuk postingan tanpa komentar.
7. Satu tombol saja di panel; tombol "Scrap" in-page dihapus.

## Catatan

- Klik "View all comments" tetap diabaikan Instagram; engine tidak lagi
  bergantung padanya (DOM hanya fallback).
- Jika sesi/login habis atau IG memberi 429, engine jatuh ke fallback DOM dan
  pesan panduan muncul.
