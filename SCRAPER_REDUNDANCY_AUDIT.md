# Audit Redundansi & Tata Letak Tombol — Rekap Harian ▸ Ambil Nama

**Tanggal:** 2026-11-23
**Metode:** inspeksi DOM langsung (CDP `Runtime.evaluate`) pada app terpaket, pengukuran koordinat tiap tombol, uji klik nyata, dan review kode `ScraperTab.tsx` + `main.ts` (validasi IPC).

---

## 1. Penilaian sebelum perubahan

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Redundansi kontrol | ★★☆☆☆ | 3 tempat ganti platform, 3 tampilan jumlah, 2 tombol mulai, 4 teks penjelas. |
| Posisi tombol aksi | ★★☆☆☆ | Tombol utama di **y = 947 px**, sedangkan viewport hanya **761 px** — butuh scroll. |
| Konsistensi negara tombol | ★★★☆☆ | "Hentikan" selalu tampil walaupun disabled. |
| Kepadatan panel | ★★★☆☆ | Dua kartu + chip + callout + emerald text saling tumpang tindih maknanya. |

**Total: 2.8 / 5** — kontrol berfungsi, tapi operator harus mencari tombol dan membaca informasi yang sama berulang kali.

---

## 2. Temuan redundansi (sebelum)

| # | Redundansi | Bukti terukur |
|---|-----------|---------------|
| R1 | **Tiga pemilih/platform indicator**: tombol `Facebook/TikTok/Instagram` (y=125), pintasan `FB/TT/IG` (y=204), chip `TikTok · Balasan: tidak` (y=262). | 9 kontrol/teks untuk 2 fakta (platform & opsi balasan). |
| R2 | **Pintasan FB/TT/IG rusak & duplikat.** Tombol itu memanggil `openUrl(DEFAULT_URL[p])` di host **platform aktif**, lalu IPC `scrapeNavigate` menolak domain lain (`isAllowedScrapeUrl(url, platform)`). | Klik "IG" saat platform TikTok → error "URL tidak valid". Hanya tombol yang sama dengan platform aktif yang bekerja. |
| R3 | **Jumlah nama ditampilkan 3×**: badge di tombol platform ("Instagram15"), teks progres "Mengumpulkan… N", dan judul "Terakhir diambil — N". | `states[p].count` dipakai dua kali di layar yang sama. |
| R4 | **Dua tombol mulai** (in-page "Scrap" + panel) tanpa penjelas mana yang utama. | Keduanya memanggil `START`. |
| R5 | **Tombol "Hentikan" selalu render** walaupun disabled saat idle. | 1 tombol mati permanen di UI awal. |
| R6 | **Empat teks penjelas berurutan**: subtitle header, chip platform/balasan, teks emerald pasca-aksi, dan callout status. | Makna "nama masuk rekap" diulang 2×. |
| R7 | **Tombol aksi di bawah lipatan layar.** | Tombol "Ambil dari halaman ini" dan "Hentikan" pada **y=947**, viewport **761 px** → scroll wajib untuk jalur cadangan. |
| R8 | Toast global + ringkasan handoff di panel menyampaikan hasil yang sama. | `EngagementDashboard` toast + panel `lastHandoff`. |

---

## 3. Kritik utama

1. **Urutan kognitif terbalik**: operator membuka postingan di browser, lalu harus menggulir ke bawah untuk tombol aksi. Jalur utama (tombol di halaman) memang terlihat, tetapi jalur cadangan — yang justru disiapkan untuk kondisi tombol in-page gagal — tidak terlihat.
2. **Pintasan platform adalah ilusi kontrol**: terlihat seperti ganti platform, padahal menavigasi host yang salah dan ditolak IPC. Ini lebih buruk daripada sekadar duplikat.
3. **Badge jumlah di tombol platform bersifat basi**: angka dari run lama melekat pada tombol, berdampingan dengan judul hasil yang bisa berbeda setelah run baru.
4. **Status dan opsi dicampur di chip**: "Balasan: tidak" mengulang checkbox yang ada beberapa ratus piksel di bawahnya.

---

## 4. Tata letak ideal (diterapkan)

```
Ambil Nama Komentar
Satu baris penjelas

[Facebook] [TikTok] [Instagram]        ← SATU-SATUNYA pemilih platform

┌─ Kartu workstation ────────────────────────────────────┐
│ [←] [→] [⟳] [ alamat postingan .............. ] [Buka]│  toolbar
│ [Ambil dari halaman ini] [Hentikan*]   [✓ Sertakan balasan] │  aksi (y=271)
│ ● Siap. / Mengumpulkan… N                              │  status
│ Target: https://…                                      │  target
│ Masuk rekap … · N terpetakan · M belum  [Lihat rekap] │  handoff
│ ┌ browser internal 440px ────────────────────────────┐ │
│ └────────────────────────────────────────────────────┘ │
│ Buka postingan → komentar → klik Scrap. Tombol atas = cadangan │
└─────────────────────────────────────────────────────────┘

Terakhir diambil — N username
  1. …
```

`* Hentikan` hanya dirender saat `running === true`.

Alasan:
- Toolbar, aksi, status, dan handoff **semua di atas lipatan** (y ≤ 452 px pada viewport 761 px).
- Browser ditempatkan **setelah** kontrol, bukan sebelum — operator melihat tombol dulu, lalu area kerja.
- Satu fakta = satu tempat: platform hanya di pemilih, balasan hanya di checkbox, jumlah hanya di status + judul hasil.

---

## 5. Perubahan yang diterapkan

| # | Tindakan | File |
|---|----------|------|
| R1/R2 | Hapus pintasan `FB/TT/IG` dan chip `Platform · Balasan:` dari toolbar. | `ScraperTab.tsx` |
| R1 | Hapus badge jumlah dari tombol platform. | `ScraperTab.tsx` |
| R4 | Tombol panel diberi label "Ambil dari halaman ini" + teks bawah kartu yang menyebut tombol **Scrap** sebagai jalur utama. | `ScraperTab.tsx` |
| R5 | `Hentikan` dirender kondisional hanya saat run berjalan. | `ScraperTab.tsx` |
| R6 | Teks emerald pasca-aksi dihapus; penjelasan disatukan jadi satu baris di bawah browser. | `ScraperTab.tsx` |
| R7 | Baris aksi + status + ringkasan handoff dipindah **sebelum** browser; tinggi browser 520 → **440 px**. | `ScraperTab.tsx` |
| R8 | Toast global dipertahankan (lintas menu), ringkasan panel dipertahankan (persisten & ada "Lihat rekap"). | — |
| — | Badge `PlatformBadge` di kartu hasil dihapus (platform sudah ditunjukkan pemilih). | `ScraperTab.tsx` |

---

## 6. Verifikasi langsung (CDP, app terpaket)

| Pengukuran | Sebelum | Sesudah |
|------------|---------|---------|
| Posisi tombol "Ambil dari halaman ini" | y = **947 px** (di bawah lipatan 761 px) | y = **271 px** ✅ |
| Tombol "Hentikan" saat idle | tampil, disabled | **tidak dirender** ✅ |
| Tombol "Hentikan" saat running | y = 947 | y = **271**, aktif ✅ |
| Tombol "Lihat rekap" | y ≈ 947+ | y = **452 px** ✅ |
| Tombol pintasan FB/TT/IG | 3 buah | **0** ✅ |
| Chip "Balasan: ya/tidak" | ada | **tidak ada** ✅ |
| Jumlah kontrol ganti platform | 3 tempat | **1 tempat** ✅ |
| Scrape IG nyata (viewport 789 px) | 0 → 14 nama (perbaikan sebelumnya) | **15 nama** ✅ |

`npx tsc --noEmit` ✅ · `npm test` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅ · bundle 1.317 → **1.315 KB**.

---

## 7. Saran lanjutan (belum diterapkan)

1. **Toast vs ringkasan panel** — bila dianggap berlebih, toast global bisa ditekan menjadi 1× per runId (mis. `lastHandoff.runId`), sehingga tidak dobel saat operator tetap di panel. Saat ini sengaja dipertahankan karena toast berguna saat operator pindah menu.
2. **Dua permukaan mulai run** — tidak bisa dihapus tanpa mengorbankan fallback. Alternatif: sembunyikan tombol panel saat tombol in-page terdeteksi aktif di halaman (butuh sinyal balik dari WebContentsView), sehingga hanya satu tombol yang tampil pada satu waktu.
3. **Sticky action bar** — bila browser dipakai pada layar lebih pendek (<700 px), baris aksi bisa dibuat `sticky top-0` di dalam kontainer scroll agar tetap terlihat.
4. **Undo handoff** — tombol "Lihat rekap" baru satu arah; tombol "Batalkan handoff terakhir" bisa ditambahkan bila operator sering salah klik Scrap (perlu simulated enum runId di DB).
