# Riset & evaluasi scraping TikTok

**Tanggal:** 2026-11-27
**Status:** riset lapangan + literatur selesai; **belum ada perubahan kode**.

## 1. Arsitektur & kontrak (dari literatur + pengamatan)

- Halaman video TikTok tidak mengirim daftar komentar saat load awal. Komentar
  dimuat lewat `GET https://www.tiktok.com/api/comment/list/` ketika panel
  komentar dibuka / di-scroll.
- Parameter penting (dikonfirmasi implementasi `davidteather/TikTok-Api`):
  `aid=1988`, `app_name=tiktok_web`, `browser_*`, `device_platform=web_pc`,
  `aweme_id=<video_id>`, `count`, `cursor`, `msToken`.
- Anti-bot: URL ditandatangani. Implementasi referensi memanggil
  `window.byted_acrawler.frontierSign(url)` → `X-Bogus`, lalu `fetch()` dari
  dalam halaman (cookie + same-origin). Varian terbaru juga memakai `a_bogus`.
- Balasan: endpoint terpisah `/api/comment/list/reply/` dengan `comment_id`.

## 2. Uji lapangan (sesi uji)

| Pengujian | Hasil |
|---|---|
| Video `@tiktok/video/7710348513128828191` | panel terbuka, **0 request** `/api/comment/list`, 0 nama komentar |
| Video `@kulinerjember/video/7675591856700460295` | sama: panel "Comments" muncul, tetapi tidak ada request komentar & tidak ada `[data-e2e="comment-username*"]` |
| `window.byted_acrawler` | **ada**; `frontierSign()` menghasilkan `X-Bogus` |
| Cookie `msToken` | ada |
| Fetch langsung `/api/comment/list/?…&msToken=…&X-Bogus=…` | HTTP **200**, `content-type: application/json`, **body kosong (len 0)** untuk varian `plain`, `X-Bogus`, maupun `a_bogus` |
| Fetch dari **main process** (cookie + header browser lengkap) | `comment/list` **len 0**, `item/detail` **len 0** → bukan masalah CORS |
| HTML video di-fetch main process | 449 KB, tapi `"comments":[]`, 0 `comment-username-*`, hanya 3 `uniqueId` → tidak ada komentar di HTML awal |
| Lacak **semua** respons JSON setelah panel dibuka | tidak ada satu pun body yang memuat nama komentator |
| Generator `a_bogus` di bundle | tidak ditemukan; yang ada hanya `frontierSign()` → `X-Bogus` |
| Uji engine UI penuh | **10 nama**, diambil dari `[data-e2e="comment-username-*"]` di DOM |
| Halaman search TikTok | menyediakan daftar URL video (cara menemukan video uji) |
| Feed & profil sendiri | tidak menampilkan tautan video (konten terdegradasi) |

Kesimpulan: sesi uji sedang kena **pembatasan anti-bot TikTok** — panel
komentar tidak benar-benar memuat data, dan endpoint mengembalikan body kosong.
Ini bukan bug tanda tangan/handoff.

## 3. Evaluasi engine kita saat ini

`electron/scrape/engine-tiktok.ts` punya dua jalur:
1. **template** — navigasi ke URL `/api/comment/list` yang sudah divalidasi TTL &
   `aweme_id`, lalu parse JSON. Ini jalur **paling bisa diandalkan** bila sesi
   sehat, tapi URL template harus tersedia/divalidasi operator.
2. **navigation** — buka halaman video, klik ikon komentar trusted, lalu panen
   `[data-e2e="comment-username-*"]` dari DOM sambil scroll container komentar.

**Yang sudah benar:**
- Intersep `webRequest` memakai satu listener bersama per-session + sink per run
  (tidak membocorkan listener antar run).
- Deteksi 429/403 dipetakan ke `rate_limit`/`blocked`.
- Dedupe lintas putaran scroll.

**Kelemahan:**
- Tidak ada pengambilan body JSON dari respons yangditangkap (hanya URL/status).
- Navigation bergantung pada panel komentar yang di sesi uji tidak memuat data.
- Tidak ada retry/backoff untuk 429 di jalur navigation.
- Tidak ada dukungan `a_bogus`; hanya `X-Bogus` yang tersedia dari `frontierSign`.
- Saat body API kosong, pesan akhir bisa terdengar seperti "berhasil" padahal 0 nama.

## 4. Alternatif yang sudah dinilai

- **Direct signed fetch** (`frontierSign` + `msToken` + paginasi `cursor`): mekanisme
  terbukti dari literatur dan fungsinya ada, tapi di sesi uji menghasilkan body
  kosong — **belum bisa divalidasi di sini**.
- **Passive CDP capture + replay**: tangkap request `/api/comment/list` asli dari
  halaman (template parameter + signature), lalu ulang dengan `cursor` berbeda.
  Ini paling tahan terhadap perubahan parameter, tapi butuh sesi tempat request
  itu benar-benar terjadi.
- **DOM harvest**: sudah ada, tapi tidak kuat terhadap virtualisasi & perubahan UI.

## 5. Rekomendasi (belum diterapkan)

1. Tambah jalur **API JSON langsung** sebagai fallback: bangun URL komentar dengan
   parameter sesi + `msToken`, tandai dengan `frontierSign`, `fetch` dari halaman,
   parse via `parseTikTokComments`, paginasi sampai `cursor` habis.
2. Simpan **template request asli** yang ditangkap via CDP `document-start`
   (mirip dependency CDP di IG) sebagai sumber parameter paling akurat.
3. Bedakan pesan "komentar kosong" vs "diblokir/anti-bot" — jangan klaim tuntas
   bila body API kosong.
4. Tetap pertahankan jalur template & navigation.

## 6. Kesimpulan pemeriksaan "ada yang macet?"
- Tidak ada proses yang macet: probe background sudah selesai; node/tsx sisa
  dihentikan; aplikasi utama tetap responsif dengan CDP port 9223 aktif.
- Hasil negatif di atas konsisten: sesi/IP sedang dibatasi TikTok, bukan bug
  signature atau handoff.

## 7. Yang dibutuhkan untuk eksekusi aman
Riset ini sengaja **belum mengubah kode** karena mekanisme direct API tidak bisa
divalidasi pada sesi yang sedang terkena pembatasan. Untuk menuntaskan, saya
membutuhkan salah satu:
- URL video TikTok yang komentarnya **benar-benar tampil** di browser internal, atau
- sesi TikTok yang tidak terkena checkpoint/anti-bot (coba logout-login ulang).

Sampai saat itu, jalur yang terbukti tetap **DOM `[data-e2e="comment-username-*"]`**
(10 nama pada video uji) dan jalur **template** bila operator punya URL API valid.
