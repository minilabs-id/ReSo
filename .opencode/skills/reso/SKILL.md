---
name: ReSo Desktop
description: Kontrol aplikasi ReSo Desktop (scraping IG/FB/TikTok, rekap harian, master pegawai, pengaturan) melalui MCP server `reso` — tanpa skrip CDP ad-hoc.
---

# ReSo Desktop

Gunakan skill ini saat user meminta scraping, rekap harian, pegawai, pengaturan, atau debugging aplikasi ReSo Desktop.

## Aturan utama
1. **Jangan tulis skrip CDP ad-hoc lagi.** Semua kontrol lewat MCP tools `reso_*`.
2. Tool MCP tersedia lewat Code Mode dengan path persis `tools.reso.reso_<nama>(...)`.
   Contoh: `tools.reso.reso_status()`, `tools.reso.reso_scrape({ platform: "instagram" })`.
3. Jika tool belum muncul, cek `opencode mcp list`; status harus `connected`. Config ada di `opencode.json` (project root) dengan `protocol: "legacy"`.
4. Aplikasi akan dijangkau di CDP port `9223` (bisa diubah via `RESO_CDP_PORT`).
5. Untuk scraping, **selalu buka satu postingan/video dulu** di browser internal, lalu panggil `reso_scrape`.

## Tools

| Tool | Fungsi |
|---|---|
| `reso_status` | State scraping per platform + URL browser internal |
| `reso_open` | Buka panel Ambil Nama & pilih platform |
| `reso_navigate` | Arahkan browser internal ke URL postingan |
| `reso_scrape` | Jalankan scraping, tunggu hasil, nama otomatis masuk rekap |
| `reso_stop` | Hentikan run aktif (membawa `runId`) |
| `reso_rekap` | Ambil rekap harian (WIB) |
| `reso_employees` | Master pegawai |
| `reso_settings` | Baca/ubah preferensi |
| `reso_error_log` | Log error lokal |

## Alur scraping yang benar

```js
await tools.reso.reso_open({ platform: "instagram" })
await tools.reso.reso_navigate({
  platform: "instagram",
  url: "https://www.instagram.com/p/<shortcode>/",
})
const result = await tools.reso.reso_scrape({ platform: "instagram", includeReplies: false })
```

Ulangi untuk `facebook` dan `tiktok`. Cek hasil dengan `reso_status` / `reso_rekap`.

## Catatan platform
- **Instagram:** jalur utama REST internal + fallback GraphQL; `comment_count` cidade bisa 0 tapi tetap ada komentar — engine sudah menangani.
- **Facebook:** komentar dibaca dari `aria-label` `Komentar oleh …`; fallback HTML main-process bila DOM kosong.
- **TikTok:** komentar harus termuat di panel browser. Bila `count: 0` padahal panel terbuka, kemungkinan sesi/anti-bot — coba logout/login ulang di browser internal.

## Environment (opsional)
- `RESO_APP_DIR` — direktori proyek desktop (default `Reso Desktop`)
- `RESO_EXE` — path exe aplikasi
- `RESO_CDP_PORT` — port CDP (default 9223)
- `RESO_USER_DATA` — profil Electron untuk instance yang diluncurkan MCP

Lihat `references/operations.md` untuk contoh alur lengkap dan troubleshooting.
