# ReSo Operations — contoh alur & troubleshooting

## Prasyarat
- Aplikasi ReSo Desktop bisa dijalankan dua cara:
  1. Otomatis oleh MCP (`ensureApp`) — memakai `RESO_EXE` atau Electron + `out/main/index.js`.
  2. Manual, dengan CDP aktif: jalankan `ReSo.exe --remote-debugging-port=9223 --user-data-dir=<profil>`.
- Cek koneksi: `opencode mcp list` → `reso  connected`.

## Alur scraping lengkap (3 platform)
Lakukan **satu platform satu waktu**, urut:

```js
// 1. Instagram carousel
await tools.reso.reso_open({ platform: "instagram" })
await tools.reso.reso_navigate({ platform: "instagram", url: "https://www.instagram.com/p/<shortcode>/" })
const ig = await tools.reso.reso_scrape({ platform: "instagram" })

// 2. Facebook postingan
await tools.reso.reso_open({ platform: "facebook" })
await tools.reso.reso_navigate({ platform: "facebook", url: "https://www.facebook.com/<page>/posts/<id>" })
const fb = await tools.reso.reso_scrape({ platform: "facebook" })

// 3. TikTok video
await tools.reso.reso_open({ platform: "tiktok" })
await tools.reso.reso_navigate({ platform: "tiktok", url: "https://www.tiktok.com/@<user>/video/<aweme_id>" })
const tt = await tools.reso.reso_scrape({ platform: "tiktok", includeReplies: false })

// 4. Verifikasi rekap (tanggal WIB)
const recap = await tools.reso.reso_rekap({})
```

Kriteria sukses: `status: "done"`, `count > 0`, pesan bukan "tidak punya komentar", dan `unmatchedNames` di rekap terisi bila ada nama yang belum cocok dengan master pegawai.

## Interpretasi hasil
| `status` | `count` | Arti | Tindakan |
|---|---|---|---|
| `done` | > 0 | Berhasil | Lanjut platform berikutnya |
| `done` | 0 + "tidak punya komentar" | Sah (memang kosong) | Tidak perlu diulang |
| `error` | 0 + "rate limit" | IG/GraphQL kena pembatasan | Tunggu, ganti akun, atau turunkan `maxScrollRounds` |
| `done` | 0 + panel TikTok terbuka | Sesi/anti-bot TikTok | Login ulang di browser internal, coba video lain |

## Timeout & efisiensi
- Default `captureTimeoutMs` 180.000 ms (naik dari 120.000).
- `reso_scrape` menerima `timeoutSec` (maks 600) untuk polling; ini **bukan** timeout engine, hanya batas tunggu agent.
- Hemat memori: panel ditutup (`closeBrowser` lewat UI) → host di-`about:blank` setelah 3 detik bila tidak `busy`. Cookie tetap di session partition.

## Monitoring daemon
Setiap skrip/daemon yang diluncurkan untuk uji:
1. Jalankan via background shell (`background: true`).
2. Pantau output dengan `Get-Content <path> -Tail 10` sekitar tiap 1 menit.
3. Jika tidak ada progres > 3 menit, hentikan PID-nya dan perbaiki pendekatannya — jangan tunggu tanpa batas.

## Troubleshooting MCP
| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `reso` tidak connected | Config belum dimuat | `opencode mcp list`, lalu restart OpenCode |
| `Renderer ReSo tidak ditemukan` | App jalan tanpa CDP | Restart app dengan `--remote-debugging-port=9223` |
| `ReSo gagal berjalan dengan CDP` | Single-instance lock menolak instance ke-2 | Tutup instance lama dulu |
| Tool mengembalikan `isError` | Bridge berubah | Cek `electron/preload.ts`, sesuaikan nama method |
| Tool timeout setelah app di-restart | Koneksi renderer lama | Server MCP sekarang auto-reattach; bila tetap gagal, toggle `disabled` di `opencode.json` lalu aktifkan lagi |
| Klik platform tidak bereaksi | Panel belum terbuka | Panggil `reso_open` dulu sebelum `reso_navigate` |
