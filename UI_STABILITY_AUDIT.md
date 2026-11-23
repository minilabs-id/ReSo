# Audit Stabilitas UI & Penyederhanaan Notifikasi

**Tanggal:** 2026-11-23
**Permintaan:** rapikan tombol & penataan fitur, semua notifikasi lebih sederhana, tidak boleh menggeser/menggerakkan fitur lain.

---

## 1. Temuan

| # | Masalah | Bukti (sebelum) |
|---|---------|-----------------|
| N1 | Toast Sonner muncul di **top-center** dengan animasi slide/expand, menimpa bagian atas aplikasi. | `<Toaster position="top-center" duration={2500} offset={16} />` |
| N2 | Banyak toast bisa bertumpuk & saling mendorong. | Default Sonner `visibleToasts` > 1, `expand=true`. |
| N3 | **Panel scraper bergeser** saat run selesai: kartu ringkasan handoff dan baris "Target:" muncul di atas browser. | Elemen dirender kondisional → browser turun. |
| N4 | **Checkbox "Sertakan balasan" bergeser** saat tombol "Hentikan" muncul. | `Hentikan` dirender hanya saat `running`. |
| N5 | Pesan error browser (`browserError`) muncul sebagai baris terpisah → menggeser konten. | `<p>` kondisional sebelum baris aksi. |
| N6 | Beberapa notifikasi menyampaikan hal yang sama (toast global + ringkasan panel). | — |

---

## 2. Perbaikan diterapkan

### Notifikasi
- `src/lib/notify.ts` (baru): store satu pesan, API drop-in `toast.success/info/warning/error/message`, auto-hilang 2,6 dtk, tanpa antrean.
- `src/components/ui/NotifyHost.tsx` (baru): satu baris statis `fixed bottom-4 right-4`, `role="status"`, tanpa animasi/transisi, slot tetap ada saat kosong (`invisible`).
- 7 file pemanggil `toast` dialihkan dari `sonner` ke `lib/notify`; `App.tsx` memakai `<NotifyHost />`; `src/components/ui/sonner.tsx` dihapus.
- Error browser kini tampil di dalam blok status scraper, bukan baris terpisah.

### Panel scraper
- **Satu blok status tinggi tetap** (`min-h-[92px]`): baris pesan, baris target, baris ringkasan handoff + tautan "Lihat rekap". Slot kosong tetap disiapkan → browser tidak pernah turun.
- **Slot "Hentikan" selalu ada** tapi `invisible` + disabled saat idle → checkbox dan tombol lain tidak bergeser saat run mulai/berakhir.
- Tombol "Lihat rekap" jadi tautan teks ringan di dalam blok status (bukan Button terpisah yang mengubah tinggi).
- Toolbar, pemilih platform, dan browser memakai posisi/ketinggian yang sama di semua keadaan.

---

## 3. Verifikasi CDP (app terpaket)

| Pengukuran | Awal | Saat run | Selesai |
|------------|------|----------|---------|
| Y browser scraper | 460 | **460** | **460** |
| X checkbox "Sertakan balasan" | 1037 | **1037** | **1037** |
| Tinggi blok status | 92 | **92** | **92** |
| Y tombol navigasi sidebar | 117 | 117 | 117 |

Notifikasi: `[data-sonner-*]` = **0**; host notifikasi `position: fixed`, `animation-duration: 0s`, `transition-duration: 0s`; teks "Cadangan data berhasil diunduh" tampil dan posisi sidebar tetap 117 px sebelum/sesudah.

`npx tsc --noEmit` ✅ · `npm test` ✅ · `npm run build` ✅ · `npm run build:desktop` ✅ · bundle renderer 1.318 → **1.262 KB** (sonner terhapus).
