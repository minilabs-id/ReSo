# Riset arsitektur Instagram — dasar perbaikan scraping

**Tanggal:** 2026-11-26
**Tujuan:** mencari jalur pengambilan nama komentator yang *benar-benar* bekerja untuk
semua jenis postingan (foto, carousel, reel), bukan menebak-nebak DOM / klik trusted.

## 1. Tiga lapis yang dipakai Instagram

| Lapis | Bentuk | Keandalan untuk scraping |
|-------|--------|--------------------------|
| UI web (DOM) | React/Relay, tombol "View all N comments" | **Rendah.** Klik programatik & trusted sering diabaikan; selector berubah. |
| Private web API | `https://www.instagram.com/api/v1/...` | **Tinggi.** Dipakai sendiri oleh halaman web;响应 JSON terstruktur. |
| GraphQL | `/graphql/query`, `/api/graphql` dengan `doc_id` | Sedang. `doc_id` berubah-ubah; butuh LSD + header tambahan. |

Kesimpulan riset: **pakai lapis private API sebagai jalur utama**, DOM hanya fallback.

## 2. Identitas postingan: shortcode → media pk

- URL memakai *shortcode* (mis. `Df12rYekjTt`), API memakai **media pk** 19 digit.
- Shortcode adalah bilangan base64 dengan alphabet
  `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_` (instagrapi,
  `InstagramIdCodec.decode`, memotong ke 11 karakter pertama).
- Konversi **wajib BigInt**: `Number` hanya presisi sampai 2^53. Contoh:
  - `Df12rYekjTt` → `4032369517111948525` (BigInt, benar)
  - perhitungan dengan `Number` dulu menghasilkan `4032369517111948300` (salah 225)
  → inilah sebab endpoint dulu menjawab `{"status":"ok"}` tanpa komentar.
- **Shortcode dari URL adalah sumber utama**, bukan HTML. Uji langsung membuktikan
  halaman `/reels/` memuat banyak `"media_id"` dari reel rekomendasi; mengambil
  yang pertama menghasilkan pk `3975112056545812239` (10886 komentar dari
  postingan lain), padahal URL `Df1KNKmPCUm` → pk `4032173926577349926`
  (0 komentar). HTML `"media_id"` hanya dipakai bila path tidak punya shortcode.

## 3. Endpoint komentar (terverifikasi langsung)

```
GET /api/v1/media/<pk>/comments/?can_support_threading=true&permalink_enabled=false
headers: X-IG-App-ID: 936619743392459
         X-CSRFToken: <cookie csrftoken>
         X-Requested-With: XMLHttpRequest
credentials: include (cookie sessionid)
```

Field penting respons:
- `comments[]` — tiap elemen punya `user.username`, `pk`, `child_comment_count`,
  `preview_child_comments[]`, `next_min_child_cursor`.
- `comment_count` — total komentar (mis. 2277).
- `has_more_comments` + `next_max_id` — mode kronologis.
- `has_more_headload_comments` + `next_min_id` — mode **ranked** (kasus kita).
- `status: "ok"`.

Kontrak paginasi (sumber: `instagrapi/mixins/comment.py`, `media_comments()`):
```
while (has_more_comments && next_max_id) || (has_more_headload_comments && next_min_id):
    if has_more_comments: params = { max_id: next_max_id }
    else:                 params = { min_id: next_min_id }
```
`instagram-private-api` (`MediaCommentsFeed`) memakai `can_support_threading=true`
serta mengirim `max_id` **dan** `min_id`. Jadi **dua mode harus didukung**, bukan
hanya `min_id` seperti implementasi pertama kita.

Agar tuntas (bukan terikat `maxScrollRounds`), engine berhenti hanya bila
`rawCount >= comment_count` atau cursor habis/berulang. Ada retry 4× dengan
backoff untuk HTTP 429/5xx. Batas 500 halaman (~7500 komentar) hanya pengaman.

`next_min_id` berupa string JSON:
`{"cached_comments_cursor":"...","bifilter_token":"..."}` — dikirim utuh sebagai
`min_id` (URL-encoded). Terverifikasi: 15 komentar/halaman, 30 halaman → 436
komentar mentah, 430 unik (ada sedikit overlap ranking → dedupe wajib).

## 4. Balasan (reply)

Sumber: `instagrapi/mixins/comment.py` → `media_comment_replies()`.

```
GET /api/v1/media/<pk>/comments/<comment_pk>/inline_child_comments/
respons: child_comments[], has_more_head_child_comments, next_min_child_cursor
lanjutan: ?min_id=<next_min_child_cursor>
```

Juga tersedia **gratis** di respons utama: `preview_child_comments[]` di tiap
komentar. Implementasi pertama kita salah membaca `c.replies.comments` (field ini
**tidak ada** di payload IG), sehingga balasan tidak pernah terambil.

Endpoint `/comments/<pk>/replies/` → **404**. Endpoint `?comment_id=<pk>` →
mengembalikan daftar komentar induk, bukan balasan. Jangan dipakai.

## 5. Sesi & anti-automasi

- Cookie `sessionid`, `csrftoken`, `ds_user_id`, `mid` disimpan di partition
  `persist:reso-instagram` (sudah ada di aplikasi).
- Header `X-IG-App-ID: 936619743392459` = app id web Instagram; `X-CSRFToken`
  dari cookie. Tidak perlu device id / UUID untuk endpoint GET ini.
- Klik "View all comments" diabaikan baik lewat `element.click()` maupun input
  trusted Electron/CDP. Ini bukan bug aplikasi — desain anti-automasi IG.
- Endpoint GraphQL dengan doc_id yang dicoba (`17852405266163336`,
  `6974885689225067`, `7171917939589632`) mengembalikan HTML login / error,
  jadi tidak dijadikan jalur utama.

## 6. Verifikasi empiris di aplikasi (sebelum perubahan lanjutan)

| Postingan | Jenis | Hasil |
|-----------|-------|-------|
| `/p/Df12rYekjTt/` | foto, 2284 komentar | **2232 username** unik masuk rekap (tuntas, 116 dtk) |
| `/p/DgCratnknyJ/` | carousel, 169 komentar | **121 username** masuk rekap |
| `/p/DgAJW8kkv0o/` | carousel, 11 komentar | **5 username** masuk rekap |
| `/reels/Df1KNKmPCUm/` | reel | **0 komentar memang** (bukan gagal) — API balas `comment_count: 0` |
| `/reels/Df_iOFQSKqW/` | reel, 378 komentar | **199 username** → rekap harian (tuntas, 14 dtk) |
| `/reels/DeMhGZeSlri/` | reel, 262 komentar | **194 username** → rekap harian |

Reel ber-komentar ditemukan lewat `/api/v1/discover/topical_explore/` (endpoint
`/api/v1/clips/user/` kena 429 pada sesi uji). Jalur reel memakai endpoint & pk
yang sama dengan postingan `/p/`, jadi tidak ada kode khusus reel.

Sebelum perbaikan terakhir, `maxScrollRounds: 42` membatasi hasil jadi 607 nama.
Sekarang paginasi tidak terikat putaran scroll: berhenti saat
`rawCount >= comment_count` atau cursor habis, dengan retry 429/5xx. Angka
2232 dari 2284 komentar = seluruh komentar terbaca; selisihnya duplikat
username yang sengaja di-dedupe. Batas waktu IG diperlebar ke minimal 180 dtk.

## 7. Konsekuensi untuk kode kita

1. Jalur utama IG = private API; DOM fallback tetap ada untuk FB & kondisi darurat.
2. Paginasi mengikuti kontrak resmi: `max_id` bila `has_more_comments`,
   selain itu `min_id` bila `has_more_headload_comments`. Ada guard cursor
   berulang + batas halaman.
3. Balasan: baca `preview_child_comments`, lalu `inline_child_comments` hanya
   bila `includeReplies=true`, dibatasi jumlah induk & halaman agar tidak
   memicu rate limit.
4. Post dengan `comment_count === 0` harus dilaporkan sebagai "tidak punya
   komentar", bukan "buka View all comments".
5. `lockUrl` tetap berlaku: bila operator berpindah postingan saat run,
   hasil dibuang.
6. Semua nama tetap melewati `isPlausibleHandle` + `mergeNames` sebelum masuk
   rekap; handoff tidak diubah.

## 8. Fallback kedua (riset lanjutan)

Jalur REST tetap satu titik kegagalan. Setelah riset lanjutan:

- **GraphQL Relay** `PolarisPostCommentsPaginationQuery` terbukti bisa dipanggil
  dari halaman dan mengembalikan username komentar. Dua hal yang harus
  ditemukan saat runtime:
  1. `doc_id` — dibaca dari bundle JS (`..._instagramRelayOperation` →
     `a.exports="<digits>"`). Riset menemukan `29250323357962155` pada sesi uji;
     kode tidak meng-hardcode nilai ini.
  2. Template parameter (`lsd`, `__dyn`, `__csr`, `fb_dtsg`, …) — ditangkap dari
     request GraphQL asli halaman dengan patch XHR/fetch yang dipasang di
     document-start lewat CDP `Page.addScriptToEvaluateOnNewDocument`.
  - Variabel wajib: `after`, `first`, `is_mobile_web`,
    `liked_by_author_badge_enabled`, `media_id` (string!), `sort_order`, plus
    variabel relay internal. `media_id` bertipe ID Relay → harus string;
    angka 19 digit dibulatkan JS dan mengembalikan `comments_media: null`.
  - Paginasi: `page_info.after` / `end_cursor` (`has_next_page`).
  - Uji: 122 username dari carousel 169 komentar tanpa memanggil REST sama sekali.

- **Jalur yang terbukti buntu** (tidak dipakai):
  - `https://i.instagram.com/api/v1/media/.../comments/` → `status: fail`
    (cookies `www` tidak diterima host tersebut).
  - HTML awal halaman → tidak mengandung array `comments` yang bisa dipanen.
  - Menangkap respons GraphQL bawaan saat halaman dibuka → ada, tapi isinya
    feed/badge/reels, bukan daftar komentar (panel tidak terbuka).
  - GraphQL dengan doc_id lama dari literatur → error `missing_required_variable_value`.

Engine sekarang: REST → bila belum tuntas/gagal → GraphQL → bila tetap gagal,
pesan error jujur (tidak lagi menyarankan klik "View all comments").

## 9. Sumber

- `subzeroid/instagrapi` — `instagrapi/mixins/comment.py`,
  `instagrapi/mixins/media.py`, `instagrapi/utils/ids.py`
- `dilame/instagram-private-api` — `src/feeds/media-comments.feed.ts`,
  `src/responses/media-comments.feed.response.ts`
- Pengujian langsung pada sesi IG aplikasi (CDP `9223`), 2026-11-26.
