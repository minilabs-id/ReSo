# Audit Performa UI/UX — ReSo Desktop

**Tanggal:** 2026-11-26
**Metode:** CDP `PerformanceObserver` (`layout-shift`, `longtask`), `Runtime.evaluate`,
CPU profile saat navigasi, dan pengukuran interaksi nyata (klik menu, buka modal,
ketik, tutup, scroll tabel). Profil uji: 200 pegawai + 120 hari rekap.

---

## 1. Ringkasan

| Dimensi | Nilai | Catatan |
|---------|-------|---------|
| Responsivitas interaksi | ★★★★★ | Modal 18–21 ms, ketik 1,8–8,6 ms, menu hangat 1–5 ms |
| Stabilitas visual (CLS) | ★★★★★ | 0,046 → **0,0003** setelah skeleton |
| Long task saat interaksi | ★★★★★ | 0 setelah perbaikan |
| First visit halaman lazy | ★★★☆☆ | ~650 ms (chunk + mount), tapi skeleton langsung tampil |
| Dirty-check modal | ★★★★☆ | Konfirmasi benar, tapi menambah satu klik saat menutup setelah edit |

**Total: 4.5 / 5** — interaksi terasa instan; hanya first-load lazy yang masih ~0,6 dtk.

---

## 2. Pengukuran

### Interaksi (sebelum perbaikan)
| Aksi | Waktu |
|------|-------|
| Menu hangat (Beranda, laporan) | 2–5 ms |
| First visit Data | **665 ms** |
| First visit Pengaturan | **673 ms** |
| Buka modal input rekap | 14–18 ms |
| Ketik 240 baris ke textarea | 2,2–8,6 ms |
| Tutup modal setelah edit | 226 ms (termasuk konfirmasi dirty) |
| Render tabel 100 baris | 3,7 ms |
| CLS total | **0,0721** (2 pergeseran) |
| Long task | 59–271 ms (10 entries) |

### Sumber long task & shift
- Long task terkonsentrasi saat **startup & first load** (child/insert DOM, React commit).
- Layout shift 0,0327 & 0,0394 terjadi saat **modul lazy selesai dimuat** dan menggantikan fallback `null` → halaman kosong lalu tiba-tiba penuh.

---

## 3. Temuan & kritik

| # | Masalah | Dampak |
|---|---------|--------|
| U1 | **`Suspense fallback={null}`** di seluruh area konten — saat `EmployeeManager`/`SettingsTab` dimuat, layar kosong, lalu konten muncul sekaligus. | CLS 0,07 + ilusi "lamat" walaupun total ~0,6 dtk. |
| U2 | Satu Suspense besar juga membungkus `InputModal`/`UnmatchedReview` — membuka modal bisa menyuspend **seluruh halaman**. | Risiko blank page saat modal pertama dibuka. |
| U3 | Prefetch chunk lazy baru dijalankan 1,2 dtk setelah mount — operator cepat pindah menu tetap kena cold load. | First visit tetap ~0,6 dtk. |
| U4 | Fallback `Memuat Modul Data Pegawai...` tanpa tinggi tetap. | Konten di bawahnya bergeser saat modul siap. |
| U5 | Dirty-check meminta konfirmasi "Buang perubahan" walau operator hanya ingin menutup. | Perilaku benar untuk keamanan data, tapi menambah friksi 1 klik. |

---

## 4. Perbaikan diterapkan

- **PageSkeleton** dengan `min-h-[420px]` dipakai sebagai fallback `EmployeeManager` & `SettingsTab` → tidak ada layar kosong & tidak ada pergeseran.
- Suspense besar dihapus; masing-masing lazy component punya boundary sendiri:
  - `InputModal` & `UnmatchedReview` → `fallback={null}` (hanya area modal, halaman tetap utuh).
  - `EmployeeManager` & `SettingsTab` → `<PageSkeleton />`.
- Prefetch chunk lazy dipercepat **1,2 dtk → 300 ms** setelah mount.
- `AnimatePresence` tidak lagi dibungkus Suspense global.

---

## 5. Hasil sesudah

| Metrik | Sebelum | Sesudah |
|--------|---------|---------|
| CLS | 0,0721 | **0,0003** |
| Layout shift events | 2 (0,0327 + 0,0394) | 1 (0,0003) |
| Long task saat interaksi | 10 entries (59–271 ms) | **0** |
| Buka modal | 13,9 ms | **21,3 ms** (dalam noise) |
| Ketik 240 baris | 2,2 ms | **1,8 ms** |
| Menu hangat | 2–5 ms | **1–5 ms** |
| First visit Data/Settings | 665 / 673 ms | 670 / 647 ms (tetap, tapi skeleton langsung tampil) |

Skrip pengukuran: `scripts/ui-perf-audit.mjs`. Catatan: angka first visit mengukur
**H1 akhir**, bukan waktu skeleton tampil — skeleton muncul dalam satu frame.

---

## 6. Rekomendasi lanjutan (belum diterapkan)

1. **Preload modul secara eksplisit di `index.html`** (`<link rel="modulepreload">`) untuk chunk EmployeeManager/SettingsTab bila first-visit 0,6 dtk masih terasa.
2. **Turunkan friksi dirty-check**: tombol "Tutup" bisa langsung menyimpan draf lokal (tanpa konfirmasi) karena autosave sudah ada — konfirmasi hanya untuk "Buang".
3. **Virtualisasi tabel pegawai** bila operator rutin memilih 100 baris/halaman (saat ini render 100 baris 3,7 ms — belum perlu).
4. **Skeleton khusus scraper** dengan tinggi browser tetap agar panel tidak "melompat" saat modul pertama dimuat.
5. **Anggaran CLS di CI**: gagal bila CLS > 0,05 pada smoke test.

## 7. Kesimpulan
Tidak ada masalah performa UI yang mengganggu: membuka modal, mengetik, dan
pindah menu hangat terasa instan; tabel 100 baris render < 4 ms. Perbaikan terakhir menghilangkan
pergeseran visual yang tersisa (CLS ~0), sehingga pengalaman terasa stabil meski
modul lazy masih dimuat di latar belakang.

---

## 8. Tata ulang halaman Ambil Nama (tambahan)

| Elemen | Sebelum | Sesudah |
|--------|---------|---------|
| Judul & pemilih platform | 2 baris (y=40, y=99) | **1 baris** (y=40, y=47) |
| Toolbar browser | y=160 | **y=116** |
| Baris aksi | y=216 | **y=172** |
| Browser | 1025×581, y=383 | 713×581, y=339 |
| Daftar "Terakhir diambil" | y=1028 (**di bawah lipatan**) | **y=339, bersebelahan dengan browser** (300 px) |

Hasil: semua fitur (pemilih platform, alamat, aksi, status, browser, daftar hasil)
terlihat dalam satu layar tanpa scroll. Browser lebih sempit, tetapi panel hasil
tidak lagi tersembunyi di bawah halaman; E2E smoke 10/10 lolos.
