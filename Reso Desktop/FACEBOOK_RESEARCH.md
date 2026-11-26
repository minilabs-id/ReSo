# Riset & evaluasi scraping Facebook

**Tanggal:** 2026-11-26
**Status:** riset selesai, rekomendasi utama **sudah diimplementasi & diuji**.

## Implementasi hasil eksekusi
- Pemanen FB sekarang memprioritaskan `[role="article"][aria-label]` dengan pola
  `Komentar/Comment oleh` dan `Balasan/Reply by` (saat `includeReplies`).
- Heuristik lama tetap sebagai fallback.
- Jumlah komentar dari teks hanya dipercaya bila eksplisit (`Lihat/View N komentar`)
  atau angka ≥2 — angka `1` dari reaksi tidak lagi dijadikan acuan.
- Uji ulang postingan detikcom: `done`, **10 nama**, pesan "Diambil 10 nama.",
  handoff tetap otomatis.

## 1. Arsitektur yang relevan

| Permukaan | Bentuk | Cocok untuk scraping |
|-----------|--------|----------------------|
| Desktop `www.facebook.com` (Comet/React) | HTML awal besar + SSR + hidrasi | **Ya.** Komentar ada di HTML/awal DOM. |
| `m.facebook.com` | HTML server-rendered, `div.ufi` | Ya (literatur), tapi sesi uji redirect ke `www`. |
| `/api/graphql/` | Bootstrap, settings, search, photo root | Tidak ada request khusus daftar komentar yang teramati. |
| Graph API resmi | Butuh token | Tidak dipakai (fitur dihapus). |

Riset literatur: `kevinzg/facebook-scraper` memakai `m.facebook.com` dan
`div.ufi` untuk komentar, bukan GraphQL.

## 2. Uji empiris (sesi login uji)

Postingan uji (komentar nyata):

```
https://www.facebook.com/detikcom/posts/pfbid09qxt7bz4u3CLfaXrDssqQQpA6zyXWCUKUpTyV15jM2fTUkoJZU4FyM3V6DTV286il?comment_id=1561573955990353
```

| Pengukuran | Hasil |
|------------|-------|
| `[role="article"]` | 24 node |
| Ber-`aria-label` | 20 node |
| `aria-label` pola `Komentar oleh …` | 20 node |
| **Username unik** | **10** (duplikat node virtualisasi: tiap nama muncul 2×) |
| Hasil klik tombol panel (UI penuh) | `done`, **10 nama**, masuk rekap harian |
| Request GraphQL bertema komentar saat buka post | **0** (hanya mentions composer) |
| Ukuran HTML awal | ~5,7 MB; 107 kemunculan kata terkait komentar |

Contoh `aria-label` yang ditemukan:

```
aria-label="Komentar oleh Ferdy Mutant 7 jam yang lalu" role="article"
```

Ini sinyal **struktural** yang jauh lebih kuat daripada heuristik anchors.

## 3. Evaluasi kode kita saat ini

`buildHarvestScript('facebook', …)` saat ini:
- mencari `[data-commentid]` / `[role="article"]`,
- mengambil nama dari `a[role=link]`, `strong`, `a[href^="/"]`, `[dir=auto]`,
  lalu `aria-label` sebagai fallback terakhir.

**Yang sudah benar:**
- `clean()` membuang zero-width characters (`\u200b/\u200c/\u200d/\ufeff`) — FB menyisipkannya di teks (terlihat jelas di sesi uji).
- Dedupe `mergeNames` menangani node ganda akibat virtualisasi.
- Uji UI: 10 nama bersih masuk rekap.

**Kelemahan:**
1. `aria-label` (sinyal paling akurat) baru dipakai di **urutan terakhir**, jadi bisa kalah oleh teks dalam node yang kebetulan terlihat seperti nama.
2. Tidak ada dukungan eksplisit untuk balasan (`Balasan oleh …` / `Reply by …`).
3. Tidak ada pengecekan total komentar → tidak bisa membedakan "semua komentar terbaca" vs "baru 10 dari 200".
4. Rentan perubahan selector generik & bahasa ( Indonesian vs English ).

## 4. Alternatif yang sudah diselidiki

- **GraphQL doc_id discovery (seperti IG):** tidak layak — tidak ada request daftar komentar yang diamati; yang ada hanya query bootstrap/mentions.
- **Fetch `m.facebook.com` dari halaman:** gagal karena CORS (`Failed to fetch`). Bisa dilakukan dari main process via Electron `session.fetch`, tetapi sesi uji mengarahkan `m.facebook.com` kembali ke `www`, jadi keuntungannya belum terbukti.
- **`plugins/comments.php`:** butuh konfigurasi plugin公开 & tidak diuji; tidak direkomendasikan tanpa bukti.
- **Passive CDP capture:** menangkap request GraphQL, tetapi tidak ada body komentar — sama seperti IG.

## 5. Rekomendasi (butir 1–2 diterapkan; 3–5 sebagian)

1. Tambahkan **pemanen FB prioritas**:
   `[role="article"][aria-label]` dengan regex `^(Komentar|Comment) oleh |^(Comment by )`,
   strip sufiks waktu, dedupe. Pasang sebelum heuristik lama.
2. Balasan: pola `^(Balasan|Reply) oleh |^(Reply by )` hanya saat `includeReplies=true`.
3. Simpan `commentCount` bila tersedia dari teks "Lihat N komentar" / metadata, lalu
   laporkan "tuntas/sebagian" seperti IG.
4. Pertahankan heuristik lama sebagai fallback & `lockUrl`.
5. Uji ulang dengan postingan ber-komentar di atas; target minimal tetap 10 nama,
   tanpa regresi pada handoff.

## 6. Catatan jujur

- Sesi uji memperlihatkan konten terdegradasi di beberapa halaman
  ("Konten Ini Tidak Tersedia Saat Ini", "Belum ada komentar", teks dengan
  zero-width injection). Itu perilaku anti-automasi FB, bukan bug handoff.
- Post uji yang dipakai memiliki 10 komentar unik; ini **bukan** bukti untuk
  postingan dengan ratusan komentar.
- Belum ada jalur kedua sekuat GraphQL fallback IG untuk FB.
