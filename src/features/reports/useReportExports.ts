import type { RefObject } from 'react';
import { toast } from '../../lib/notify';
import { getLocalISODate, parseLocalISODate } from '../../lib/date';
import type { DailyEngagement, Employee } from '../../types';

type ReportType = 'daily' | 'weekly' | 'monthly';

interface WeeklyReport { dates: string[]; weekNumber: number; year: number; weekRange?: string }
interface MonthlyReport { dates: string[]; monthName: string; year: number }

const IMAGE_EXPORT_LIMIT = 60;
let logoDataUrlCache: Promise<string | null> | null = null;

export interface ReportExportsArgs {
  sortedEmployees: Employee[];
  dailyEngagementsMap: Record<string, DailyEngagement>;
  weeklyReports: WeeklyReport[];
  monthlyReports: MonthlyReport[];
  currentDailyDate: Date;
  appLogo: string;
  setBusyAction: (action: string | null) => void;
  printRefs: {
    daily: RefObject<HTMLDivElement | null>;
    weekly: RefObject<HTMLDivElement | null>;
    monthly: RefObject<HTMLDivElement | null>;
  };
}

export function useReportExports({
  sortedEmployees,
  dailyEngagementsMap,
  weeklyReports,
  monthlyReports,
  currentDailyDate,
  appLogo,
  setBusyAction,
  printRefs,
}: ReportExportsArgs) {
  const buildReportData = (type: 'daily' | 'weekly' | 'monthly') => {
    const todayStr = getLocalISODate(new Date());
    let title = '';
    let subtitle = '';
    let dates: string[] = [];
    if (type === 'daily') {
      dates = [getLocalISODate(currentDailyDate)];
      title = 'LAPORAN HARIAN';
      const d = parseLocalISODate(dates[0]);
      subtitle = `Rekapitulasi Engagement • ${d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
    } else if (type === 'weekly') {
      if (!weeklyReports[0]) return null;
      dates = weeklyReports[0].dates;
      title = 'LAPORAN MINGGUAN';
      subtitle = `Rekapitulasi Engagement • Minggu ke-${weeklyReports[0].weekNumber} • ${weeklyReports[0].year}`;
    } else {
      if (!monthlyReports[0]) return null;
      dates = monthlyReports[0].dates;
      title = 'LAPORAN BULANAN';
      subtitle = `Rekapitulasi Engagement • ${monthlyReports[0].monthName} ${monthlyReports[0].year}`;
    }

    let totalActual = 0, totalPossible = 0;
    const daysPassed = dates.filter(d => d <= todayStr).length || 1;
    const rows: { _empId: string; name: string; nip: string; bidang: string; ig: boolean; fb: boolean; tt: boolean }[] = [];
    sortedEmployees.forEach(emp => {
      if (type === 'daily' && dates[0]) {
        const e = dailyEngagementsMap[dates[0]];
        if (e) {
          totalActual += (e.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0) + (e.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0) + (e.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0);
        }
        // Tanggal depan belum tersedia — jangan hitung denominator/rate.
        if (dates[0] <= todayStr) totalPossible += 3;
        rows.push({
          _empId: emp.id,
          name: emp.name,
          nip: emp.nip || '-',
          bidang: emp.bidang || '—',
          ig: e?.igEngagedEmployeeIds?.includes(emp.id) ?? false,
          fb: e?.fbEngagedEmployeeIds?.includes(emp.id) ?? false,
          tt: e?.tiktokEngagedEmployeeIds?.includes(emp.id) ?? false,
        });
      } else {
        let igC = 0, fbC = 0, ttC = 0;
        dates.forEach(d => {
          if (d > todayStr) return;
          const e = dailyEngagementsMap[d];
          if (e) {
            if (e.igEngagedEmployeeIds?.includes(emp.id)) igC++;
            if (e.fbEngagedEmployeeIds?.includes(emp.id)) fbC++;
            if (e.tiktokEngagedEmployeeIds?.includes(emp.id)) ttC++;
          }
        });
        totalActual += igC + fbC + ttC;
        totalPossible += daysPassed * 3;
        rows.push({
          _empId: emp.id,
          name: emp.name,
          nip: emp.nip || '-',
          bidang: emp.bidang || '—',
          ig: igC > 0,
          fb: fbC > 0,
          tt: ttC > 0,
        });
      }
    });
    const rate = totalPossible > 0 ? Math.round((totalActual / totalPossible) * 100) : 0;
    return { title, subtitle, dates, rows, rate, todayStr };
  };

  const handleExportPDF = async (type: 'daily' | 'weekly' | 'monthly', filename: string) => {
    setBusyAction('export');
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const report = buildReportData(type);
      if (!report) return;
      const { title, subtitle, rows, rate, dates, todayStr } = report;

      // Bulanan punya banyak kolom tanggal (28–31) → landscape agar 1 baris
      // pegawai muat; mingguan (7 hari) cukup portrait dengan kolom maksimal.
      const landscape = type === 'monthly';
      const pageW = landscape ? 297 : 210;
      const pageH = landscape ? 210 : 297;
      const margin = 12;
      const pdf = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'mm', format: 'a4' });

      // ---- Logo (fetch SVG → canvas → PNG) ----
      const logoDataUrl = await fetchLogoDataUrl();

      // ---- Hitung per-tanggal (0–3 platform) untuk weekly/monthly ----
      const daysPassed = dates.filter((d) => d <= todayStr).length || 1;
      const perEmp = new Map<string, { perDay: number[]; total: number }>();
      for (const r of rows) {
        const perDay = dates.map((d) => {
          if (d > todayStr) return 0;
          const e = dailyEngagementsMap[d];
          let c = 0;
          if (e) {
            if (e.igEngagedEmployeeIds?.includes(r._empId)) c++;
            if (e.fbEngagedEmployeeIds?.includes(r._empId)) c++;
            if (e.tiktokEngagedEmployeeIds?.includes(r._empId)) c++;
          }
          return c;
        });
        perEmp.set(r._empId, {
          perDay,
          total: perDay.reduce((a, b) => a + b, 0),
        });
      }

      // ---- Header & footer digambar di SEMUA halaman (didDrawPage) ----
      const HEADER_H = 32;
      let pageNum = 0;
      const drawHeaderFooter = () => {
        pageNum++;
        if (logoDataUrl) {
          pdf.addImage(logoDataUrl, 'PNG', margin, 8, 14, 14);
        }
        const txtX = margin + (logoDataUrl ? 19 : 0);
        pdf.setFontSize(13);
        pdf.setFont('helvetica', 'bold');
        pdf.text(title, txtX, 16);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(subtitle, txtX, 22);
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Rate: ${rate}%`, pageW - margin, 16, { align: 'right' });
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`ReSo • Gen: ${new Date().toLocaleDateString('id-ID')}`, pageW - margin, 22, { align: 'right' });
        pdf.setFontSize(7);
        pdf.text(`Hal. ${pageNum}`, pageW - margin, pageH - 8, { align: 'right' });
        pdf.text('ReSo — Rekap Engagement Sosmed', margin, pageH - 8);
      };

      // ---- Susun head & body ----
      // Bulanan: judul sudah memuat bulan → header tanggal cukup ANGKA HARI
      // (hemat ruang untuk kolom yang sempit); mingguan tetap "1 Agu".
      const dateLabels = dates.map((d) => {
        const p = parseLocalISODate(d);
        return type === 'monthly'
          ? String(p.getDate())
          : p.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      });
      let head: string[];
      let body: (string | number)[][];
      let colWidths: number[];

      if (type === 'daily') {
        head = ['Nama Pegawai', 'NIP', 'Bidang', 'IG', 'FB', 'TT'];
        body = rows.map((r) => [
          r.name, r.nip, r.bidang,
          r.ig ? 'Eng' : 'x', r.fb ? 'Eng' : 'x', r.tt ? 'Eng' : 'x',
        ]);
        colWidths = [74, 34, 42, 12, 12, 12];
      } else {
        head = ['Nama Pegawai', 'NIP', 'Bidang', ...dateLabels, 'Total', '% ENG'];
        body = rows.map((r) => {
          const { perDay, total } = perEmp.get(r._empId) || { perDay: dates.map(() => 0), total: 0 };
          return [
            r.name, r.nip, r.bidang,
            ...perDay,
            total,
            Math.round((total / (daysPassed * 3)) * 100),
          ];
        });
        // Lebar tabel = pageW − margin×2; nama/nip/bidang tetap, sisanya untuk tanggal.
        // Mingguan portrait: 186mm untuk 7 tanggal + Total + %ENG.
        // Bulanan landscape: 273mm untuk 28–31 tanggal + Total + %ENG.
        // NIP bulanan dibuat sempit + font khusus (di didParseCell) agar 18
        // digit tetap 1 baris, sisa ruang diberikan ke kolom tanggal.
        const fixed = type === 'weekly' ? [42, 20, 18, 12, 14] : [34, 13, 13, 8, 10];
        const fixedTotal = fixed[0] + fixed[1] + fixed[2] + fixed[3] + fixed[4];
        const avail = pageW - margin * 2 - fixedTotal;
        const dateW = Math.floor((avail / dates.length) * 10) / 10;
        colWidths = [...fixed.slice(0, 3), ...dates.map(() => dateW), fixed[3], fixed[4]];
      }

      // ---- Tabel autoTable (auto page break, header+footer tiap halaman) ----
      const isDense = type === 'monthly';
      autoTable(pdf, {
        startY: HEADER_H,
        head: [head],
        body,
        styles: {
          fontSize: type === 'daily' ? 8 : isDense ? 5 : 7,
          cellPadding: type === 'daily' ? 2.2 : 1.2,
          overflow: 'linebreak',
          valign: 'middle',
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: type === 'daily' ? 9 : isDense ? 5.5 : 7.5,
        },
        columnStyles: Object.fromEntries(
          colWidths.map((w, i) => [i, { cellWidth: w, ...(i >= 3 ? { halign: 'center' as const } : {}) }])
        ),
        didParseCell: (data) => {
          // NIP bulanan: kolom sempit (13mm) → font khusus agar 18 digit
          // tetap 1 baris, tanpa melipat ke 2 baris.
          if (isDense && data.section === 'body' && data.column.index === 1) {
            data.cell.styles.fontSize = 4;
            data.cell.styles.overflow = 'hidden';
            data.cell.styles.cellPadding = { top: 0.5, right: 0.8, bottom: 0.5, left: 0.8 };
            data.cell.styles.halign = 'center';
          }
        },
        margin: { left: margin, right: margin, top: HEADER_H, bottom: 12 },
        pageBreak: 'auto',
        didDrawPage: drawHeaderFooter,
      });

      pdf.save(`${filename}.pdf`);
      toast.success("PDF berhasil diunduh");
    } catch (error) {
      console.error(error);
      toast.error("Gagal membuat PDF");
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportImage = async (type: 'daily' | 'weekly' | 'monthly', filename: string) => {
    const report = buildReportData(type);
    if (!report) return;
    if (report.rows.length > IMAGE_EXPORT_LIMIT) {
      toast.error(`Data terlalu banyak untuk export gambar (maks ${IMAGE_EXPORT_LIMIT} pegawai). Gunakan export PDF atau Excel.`);
      return;
    }
    const ref = printRefs[type];
    const source = ref.current;
    if (!source) return;
    setBusyAction('export');

    // Host off-screen — bebas dari ancestor overflow-hidden, animasi motion,
    // dan media query responsif. Clone report di sini lalu paksa gaya cetak.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;';
    let clone: HTMLElement | null = null;
    try {
      clone = source.cloneNode(true) as HTMLElement;
      host.appendChild(clone);
      document.body.appendChild(host);
      // Tunggu font/layout clone benar-benar siap.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // ★ Paksa gaya cetak inline pada clone (menang atas class responsif):
      // - lepas transform/opacity animasi motion
      // - tabel melebar ke max-content (semua kolom), tanpa max-h/overflow
      // - card list mobile disembunyikan, wrapper tabel dipaksa tampil penuh
      clone.style.transform = 'none';
      clone.style.opacity = '1';
      clone.style.width = 'max-content';
      clone.style.maxWidth = 'none';
      clone.style.overflow = 'visible';
      const mobileCardList = clone.querySelector('[class*="md:hidden"]') as HTMLElement | null;
      if (mobileCardList) mobileCardList.style.display = 'none';
      const tableWrapper = clone.querySelector('[class*="max-h-"]') as HTMLElement | null;
      if (tableWrapper) {
        tableWrapper.style.display = 'block';
        tableWrapper.style.maxHeight = 'none';
        tableWrapper.style.overflow = 'visible';
      }
      const table = clone.querySelector('table') as HTMLElement | null;
      if (table) {
        table.style.width = 'max-content';
      }

      // ★ Padatkan spasi gambar (inline override class responsif layar):
      // - padding container kecil, tanpa min-h (tidak ada ruang kosong di bawah)
      // - jarak judul↔tabel rapat, subtitle lebih ramping
      // - rate box dipadatkan
      clone.style.padding = '12px';
      clone.style.minHeight = '0';
      const header = clone.firstElementChild as HTMLElement | null;
      if (header) {
        header.style.marginBottom = '10px';
        header.style.paddingBottom = '10px';
        const subtitle = header.querySelector('h3 + p') as HTMLElement | null;
        if (subtitle) {
          subtitle.style.fontSize = '11px';
          subtitle.style.marginTop = '2px';
        }
        const rateBox = header.querySelector('[class*="rounded-lg"][class*="bg-slate-50"]') as HTMLElement | null;
        if (rateBox) rateBox.style.padding = '6px 10px';
      }
      await new Promise(r => requestAnimationFrame(r));

      // ★ Lebar/tinggi konten penuh — dioper EKSPLISIT ke domToPng supaya canvas
      // selebar konten (bukan getBoundingClientRect yang terkunci max-h).
      const w = clone.scrollWidth;
      const h = clone.scrollHeight;
      const { domToPng } = await import('modern-screenshot');
      const imgData = await domToPng(clone, {
        scale: 2,
        backgroundColor: '#ffffff',
        width: w,
        height: h,
        style: { overflow: 'visible', maxHeight: 'none' },
      });
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = imgData;
      link.click();
      toast.success("Gambar berhasil disimpan");
    } catch (error) {
      console.error(error);
      toast.error("Gagal membuat gambar");
    } finally {
      host.remove();
      setBusyAction(null);
    }
  };

  const handleExportExcel = async (type: 'daily' | 'weekly' | 'monthly', filename: string) => {
    const report = buildReportData(type);
    if (!report) return;
    const { title, subtitle, rows, rate, dates, todayStr } = report;
    setBusyAction('export');
    try {
      // Kolom per tanggal untuk mingguan/bulanan: nilai 0–3 (jumlah platform aktif).
      // Tambahkan tahun bila rentang lintas tahun (mis. Des 2026 → Jan 2027).
      const years = new Set(dates.map((d) => parseLocalISODate(d).getFullYear()));
      const showYear = years.size > 1;
      const dateLabels = dates.map((d) =>
        parseLocalISODate(d).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
          ...(showYear ? { year: 'numeric' } : {}),
        })
      );
      const daysPassed = dates.filter((d) => d <= todayStr).length || 1;

      const header: string[] =
        type === 'daily'
          ? ['Nama Pegawai', 'NIP', 'Bidang', 'IG', 'FB', 'TT']
          : ['Nama Pegawai', 'NIP', 'Bidang', ...dateLabels, 'Total', '% ENG'];

      const body: (string | number)[][] = rows.map((r) => {
        if (type === 'daily') {
          return [r.name, r.nip, r.bidang, r.ig ? 'Eng' : 'x', r.fb ? 'Eng' : 'x', r.tt ? 'Eng' : 'x'];
        }
        // Mingguan/bulanan: hitung per tanggal (0–3) dari dailyEngagementsMap.
        let total = 0;
        const perDay = dates.map((d) => {
          const e = dailyEngagementsMap[d];
          let count = 0;
          if (d <= todayStr && e) {
            if (e.igEngagedEmployeeIds?.includes(r._empId)) count++;
            if (e.fbEngagedEmployeeIds?.includes(r._empId)) count++;
            if (e.tiktokEngagedEmployeeIds?.includes(r._empId)) count++;
          }
          total += count;
          return count;
        });
        return [r.name, r.nip, r.bidang, ...perDay, total, Math.round((total / (daysPassed * 3)) * 100)];
      });

      const aoa: (string | number)[][] = [
        [title],
        [subtitle],
        ['Rate', `${rate}%`],
        [],
        header,
        ...body,
      ];

      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      worksheet['!cols'] = header.map((h, i) => ({
        wch: h === 'Nama Pegawai' ? 32 : h === 'NIP' ? 20 : h === 'Bidang' ? 14 : h.includes('ENG') || h === 'Total' ? 8 : 7,
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, type === 'daily' ? 'Harian' : type === 'weekly' ? 'Mingguan' : 'Bulanan');
      XLSX.writeFile(workbook, `${filename}.xlsx`);
      toast.success("Excel berhasil diunduh");
    } catch (error) {
      console.error(error);
      toast.error("Gagal membuat Excel");
    } finally {
      setBusyAction(null);
    }
  };

  async function fetchLogoDataUrl(): Promise<string | null> {
    if (logoDataUrlCache) {
      const prev = await logoDataUrlCache.catch(() => null);
      if (prev !== null) return prev;
      logoDataUrlCache = null;
    }
    logoDataUrlCache = (async (): Promise<string | null> => {
      try {
        // `appLogo` adalah data URL SVG dari Vite — bekerja di web dan di
        // file:// Electron (fetch('/logo.svg') dulu jadi file:///D:/logo.svg).
        const img = new Image();
        img.src = appLogo;
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(); });
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 64, 64);
        return c.toDataURL('image/png');
      } catch {
        logoDataUrlCache = null;
        return null;
      }
    })();
    return logoDataUrlCache;
  }

  return { handleExportPDF, handleExportImage, handleExportExcel };
}