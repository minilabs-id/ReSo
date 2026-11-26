import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { toast } from '../lib/notify';
import { useLocal } from './LocalProvider';
import { useAppLogo } from '../hooks/useAppLogo';
import { cn } from '@/lib/utils';
import { getLocalISODate, parseLocalISODate } from '../lib/date';
import {
  onScrapeHandoff,
  getUpdateState,
  onUpdateStateChanged,
  checkForUpdates,
  installUpdate,
  type UpdateState,
} from '../lib/reso-bridge';
import { APP_VERSION } from '../lib/version';
import {
  MAIN_NAV,
  REPORT_SUBTABS,
  REKAP_SUBTABS,
  type MainTabId,
  type ReportViewId,
  type RekapViewId,
} from '../app/navConfig';
import { containerVariants, itemVariants } from '../shared/motion';
import { useRekapData } from '../features/rekap/useRekapData';
import { useReportExports } from '../features/reports/useReportExports';
import { useReportState } from '../features/reports/useReportState';

import { DashboardTab } from './tabs/DashboardTab';
import ScraperTab from './tabs/ScraperTab';
import { DailyReportView } from './reports/DailyReportView';
import { WeeklyReportView } from './reports/WeeklyReportView';
import { MonthlyReportView } from './reports/MonthlyReportView';
import { ConfirmDialog } from './ui/confirm-dialog';
import { CalendarPanel } from '../features/rekap/CalendarPanel';
import { useRekapReview } from '../features/rekap/useRekapReview';
const EmployeeManager = React.lazy(() => import('./EmployeeManager'));
// Komponen yang tidak selalu dipakai dipecah ke chunk terpisah agar chunk awal kecil.
const InputModal = React.lazy(() => import('./InputModal').then((m) => ({ default: m.InputModal })));
const SettingsTab = React.lazy(() => import('./tabs/SettingsTab').then((m) => ({ default: m.SettingsTab })));
const UnmatchedReview = React.lazy(() =>
  import('../features/rekap/UnmatchedReview').then((m) => ({ default: m.UnmatchedReview }))
);

// Batas pegawai untuk export gambar — satu lembar gambar, lebih dari ini wajib PDF/Excel.
const IMAGE_EXPORT_LIMIT = 60;

export default function EngagementDashboard() {
  const { user, db } = useLocal();
  const appLogo = useAppLogo();

  // ── Satu pemilik per konsep: data rekap ──
  const {
    employees,
    dailyEngagements,
    dailyEngagementsMap,
    dataStatus,
    isOutsideHistoryWindow,
    notifyHistoryLimit,
  } = useRekapData();

  // Scraper selesai → nama otomatis masuk rekap harian & terpetakan.
  useEffect(
    () =>
      onScrapeHandoff((p) => {
        const platform = p.platform === 'facebook' ? 'Facebook' : p.platform === 'instagram' ? 'Instagram' : 'TikTok';
        toast.success(
          `${p.added} ${platform} masuk rekap ${p.date} · ${p.matched} terpetakan${p.unmatched ? ` · ${p.unmatched} belum` : ''}`
        );
      }),
    []
  );

  // Hangatkan chunk lazy saat idle — kunjungan pertama ke Pengaturan/Input
  // tidak perlu menunggu ~600 ms memuat modul.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./InputModal');
      void import('./tabs/SettingsTab');
      void import('../features/rekap/UnmatchedReview');
      void import('./EmployeeManager');
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  // Auto-update: ambil status awal & dengarkan siaran dari main process.
  useEffect(() => {
    void getUpdateState().then(setUpdate);
    return onUpdateStateChanged(setUpdate);
  }, []);

  const {
    currentDailyDate,
    setCurrentDailyDate,
    setCurrentWeekDate,
    currentMonthlyReportDate,
    setCurrentMonthlyReportDate,
    weeklySortMode,
    setWeeklySortMode,
    monthlySortMode,
    setMonthlySortMode,
    weeklyReports,
    weeklyDatesList,
    weeklyStats,
    changeWeek,
    monthlyReports,
    monthlyStats,
    sortedMonthlyEmployees,
    changeDailyDate,
    canGoNextWeekly,
    canGoNextMonthly,
    canGoNextDaily,
  } = useReportState({ employees, dailyEngagementsMap, isOutsideHistoryWindow, notifyHistoryLimit });

  // ── Satu model "sibuk": menggantikan lima flag loading terpisah ──
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const isLoading = busyAction !== null;
  const isVerifyingAll = busyAction === 'verify';
  const isMapping = busyAction === 'mapping';

  // ── Shell & navigasi ──
  const [activeTab, setActiveTab] = useState<MainTabId>('dashboard');
  const [reportView, setReportView] = useState<ReportViewId>('daily');
  const [rekapView, setRekapView] = useState<RekapViewId>('kalender');
  // SATU tanggal aktif untuk seluruh aplikasi: kalender, modal input, review,
  // dan Laporan Harian. Tidak ada lagi `selectedDate` yang berdiri sendiri.
  const currentDailyDateStr = getLocalISODate(currentDailyDate);
  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dailySortMode, setDailySortMode] = useState<'name' | 'bidang'>('bidang');

  const printRef = useRef<HTMLDivElement>(null);
  const printMonthlyRef = useRef<HTMLDivElement>(null);
  const printDailyRef = useRef<HTMLDivElement>(null);

  const {
    unverifiedAutoFilledDates,
    verifyAllConfirm,
    setVerifyAllConfirm,
    handleVerifyAllAutoFilled,
    isUnmatchedReviewOpen,
    setIsUnmatchedReviewOpen,
    mapSelections,
    setMapSelections,
    selectedUnmatched,
    selectedPostedAt,
    handleMapUnmatched,
    handleRematchOnly,
  } = useRekapReview({ selectedDate: currentDailyDateStr, employees, dailyEngagementsMap, setBusyAction });

  /** Diisi InputModal supaya Esc/back-button memakai dirty-check-nya. */
  const inputCloseGuardRef = useRef<((afterClose?: () => void) => void) | null>(null);
  const closeInputModal = () => {
    setIsInputModalOpen(false);
    if (window.history.state?.modal === 'input') {
      window.history.back();
    }
  };

  /** Buka sub-tab laporan: periodenya mengikuti tanggal aktif (satu sumber). */
  const openReportView = (view: ReportViewId) => {
    setReportView(view);
    const d = parseLocalISODate(currentDailyDateStr);
    if (view === 'weekly') setCurrentWeekDate(d);
    if (view === 'monthly') {
      setCurrentMonthlyReportDate(d);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  };

  /** Pindah menu utama. Modal input yang belum disimpan ditanyakan dulu. */
  const goToTab = (tab: MainTabId) => {
    if (tab === activeTab) return;
    const proceed = () => {
      setActiveTab(tab);
      if (tab === 'laporan') openReportView(reportView);
    };
    if (isInputModalOpen) inputCloseGuardRef.current?.(proceed);
    else proceed();
  };

  /** Pindah sub-tab Rekap Harian dengan guard yang sama. */
  const switchRekapView = (view: RekapViewId) => {
    if (view === rekapView) return;
    const proceed = () => setRekapView(view);
    if (isInputModalOpen) inputCloseGuardRef.current?.(proceed);
    else proceed();
  };

  /** Buka input rekap untuk hari ini dari mana saja (CTA / Ctrl+N). */
  const openInputForToday = () => {
    const proceed = () => {
      setCurrentDailyDate(new Date());
      setActiveTab('rekap');
      setRekapView('kalender');
      setIsInputModalOpen(true);
    };
    if (isInputModalOpen) inputCloseGuardRef.current?.(proceed);
    else proceed();
  };

  useEffect(() => {
    const handlePopState = () => {
      if (isInputModalOpen) {
        setIsInputModalOpen(false);
      }
    };

    if (isInputModalOpen) {
      window.history.pushState({ modal: 'input' }, '');
      window.addEventListener('popstate', handlePopState);
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isInputModalOpen]);

  // Notifikasi pengisian otomatis dari scraper native — sekali per tanggal per sesi.
  const notifiedAutoFillRef = useRef<Set<string>>(new Set());

  // Data datang langsung dari scraper native ke database lokal. Real-time
  // onSnapshot sudah memuatnya; di sini beri tahu operator — data sudah
  // tersimpan otomatis, tinggal dicek (tidak wajib simpan).
  useEffect(() => {
    const eng = dailyEngagementsMap[currentDailyDateStr];
    if (eng?.autoFilledAt && !notifiedAutoFillRef.current.has(currentDailyDateStr)) {
      notifiedAutoFillRef.current.add(currentDailyDateStr);
      const count =
        typeof eng.autoFilledCount === 'number' && eng.autoFilledCount > 0
          ? ` (${eng.autoFilledCount} nama baru)`
          : '';
      toast.info(`Rekap ${currentDailyDateStr} diisi otomatis (${count} nama) — sudah tersimpan lokal, cek rekapnya.`);
    }
  }, [currentDailyDateStr, dailyEngagementsMap]);

  const sortedEmployees = useMemo(() => {
    return employees.slice().sort((a, b) => {
      if (dailySortMode === 'name') {
        return a.name.localeCompare(b.name);
      }
      return (a.bidang || '').localeCompare(b.bidang || '') || a.name.localeCompare(b.name);
    });
  }, [employees, dailySortMode]);

  // ---- Bangun data laporan (title, subtitle, rows, rate) — dipakai PDF & Gambar ----

  const chartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return getLocalISODate(d);
    });

    return last7Days.map(date => {
      const engagement = dailyEngagementsMap[date];
      const igCount = engagement?.igEngagedEmployeeIds?.length || 0;
      const fbCount = engagement?.fbEngagedEmployeeIds?.length || 0;
      const tiktokCount = engagement?.tiktokEngagedEmployeeIds?.length || 0;
      // Parse as local date to avoid UTC weekday shift
      const [y, m, day] = date.split('-').map(Number);
      const localDate = new Date(y, m - 1, day);
      return {
        name: localDate.toLocaleDateString('id-ID', { weekday: 'short' }),
        ig: igCount,
        fb: fbCount,
        tiktok: tiktokCount,
        total: igCount + fbCount + tiktokCount
      };
    });
  }, [dailyEngagementsMap]);

  const stats = useMemo(() => {
    const totalEmployees = employees.length;
    // Use local date — UTC ISO breaks "today" stats after 07:00 WIB
    const today = getLocalISODate(new Date());
    const todayEng = dailyEngagements.find(d => d.id === today);
    const todayCount = (todayEng?.igEngagedEmployeeIds?.length || 0) + (todayEng?.fbEngagedEmployeeIds?.length || 0) + (todayEng?.tiktokEngagedEmployeeIds?.length || 0);
    const totalEngagements = dailyEngagements.reduce((acc, curr) => 
      acc + (curr.igEngagedEmployeeIds?.length || 0) + (curr.fbEngagedEmployeeIds?.length || 0) + (curr.tiktokEngagedEmployeeIds?.length || 0), 0
    );
    
    // Satu definisi engagement rate untuk seluruh aplikasi (sama seperti
    // laporan): aktual / (jumlah pegawai × 3 platform). Untuk "hari ini",
    // daysPassed = 1 sehingga penyebutnya employees.length × 3.
    const maxPossibleToday = totalEmployees * 3;
    return {
      totalEmployees,
      todayCount,
      totalEngagements,
      engagementRate: maxPossibleToday > 0 ? Math.round((todayCount / maxPossibleToday) * 100) : 0,
    };
  }, [employees, dailyEngagements]);

  // Kunci scroll hanya saat dialog benar-benar terbuka.
  useEffect(() => {
    if (!isInputModalOpen && !isUnmatchedReviewOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isInputModalOpen, isUnmatchedReviewOpen]);

  // Escape menutup dialog teratas. Modal input memakai guard-nya sendiri agar
  // perubahan yang belum disimpan tidak hilang. Pintasan berikut dipakai
  // operator setiap hari: Ctrl+N input rekap, Ctrl+S simpan, 1/2/3 ganti
  // granularitas laporan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isUnmatchedReviewOpen) {
          setIsUnmatchedReviewOpen(false);
          return;
        }
        if (isInputModalOpen) {
          if (inputCloseGuardRef.current) inputCloseGuardRef.current();
          else closeInputModal();
          return;
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openInputForToday();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('reso:save-rekap'));
        return;
      }
      if (activeTab === 'laporan' && !isInputModalOpen && ['1', '2', '3'].includes(e.key)) {
        const views: ReportViewId[] = ['daily', 'weekly', 'monthly'];
        openReportView(views[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isUnmatchedReviewOpen, isInputModalOpen, activeTab]);

  const changeMonth = (offset: number) => {
    const newMonth = new Date(currentMonth);
    // Normalisasi ke tanggal-1 agar pembanding tidak salah karena ujung bulan.
    newMonth.setDate(1);
    newMonth.setMonth(newMonth.getMonth() + offset);
    if (isOutsideHistoryWindow(newMonth)) {
      notifyHistoryLimit();
      return;
    }
    setCurrentMonth(newMonth);
    // Kalender dan Laporan Bulanan memakai satu konteks bulan.
    setCurrentMonthlyReportDate(newMonth);
  };

  /** Panah bulan di Laporan Bulanan ikut menggeser kalender Rekap Harian. */
  const handleMonthlyReportChange = (offset: number) => {
    const next = new Date(currentMonthlyReportDate);
    next.setMonth(next.getMonth() + offset);
    if (isOutsideHistoryWindow(next)) {
      notifyHistoryLimit();
      return;
    }
    setCurrentMonthlyReportDate(next);
    setCurrentMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };

  // Ekspor laporan — logika dipindah ke feature hook
  const { handleExportPDF, handleExportImage, handleExportExcel } = useReportExports({
    sortedEmployees,
    dailyEngagementsMap,
    weeklyReports,
    monthlyReports,
    currentDailyDate,
    appLogo,
    setBusyAction,
    printRefs: { daily: printDailyRef, weekly: printRef, monthly: printMonthlyRef },
  });
  const currentDailyEngagementOptions = dailyEngagementsMap[currentDailyDateStr];
  let dailyPossible = 0;
  let dailyActual = 0;
  if (currentDailyDateStr <= getLocalISODate(new Date())) {
    employees.forEach(emp => {
      // Wajib 3 platform untuk semua pegawai (IG, FB, TikTok)
      dailyPossible += 3;
      if (currentDailyEngagementOptions?.igEngagedEmployeeIds?.includes(emp.id)) dailyActual++;
      if (currentDailyEngagementOptions?.fbEngagedEmployeeIds?.includes(emp.id)) dailyActual++;
      if (currentDailyEngagementOptions?.tiktokEngagedEmployeeIds?.includes(emp.id)) dailyActual++;
    });
  }
  const dailyEngagementRate = dailyPossible > 0 ? Math.round((dailyActual / dailyPossible) * 100) : 0;

  // Export gambar dibatasi satu lembar (maks IMAGE_EXPORT_LIMIT pegawai);
  // lewat batas → tombol Gambar dinonaktifkan, fokus PDF/Excel.
  const canExportImage = employees.length <= IMAGE_EXPORT_LIMIT;

  if (!db) return null;

  return (
    <>
    <div className="flex h-[100dvh] bg-slate-50 font-sans overflow-hidden relative">
      {/* Satu-satunya navigasi. Aplikasi desktop ber-minWidth 1024 — tidak ada
          drawer, bottom nav, atau sheet "Lainnya" yang menduplikasi daftar ini. */}
      <aside aria-label="Navigasi utama" className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 mb-8">
            <img src={appLogo} alt="ReSo" className="w-10 h-10 object-contain shrink-0" />
            <div>
              <span className="text-xl font-bold tracking-tight text-slate-900 leading-none" aria-label="ReSo">ReSo</span>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">Rekap Engagement Sosmed</p>
            </div>
          </div>

          <nav className="space-y-1.5" aria-label="Menu utama">
            {MAIN_NAV.map((item) => (
              <NavItem
                key={item.id}
                active={activeTab === item.id}
                onClick={() => goToTab(item.id)}
                icon={item.icon}
                label={item.label}
              />
            ))}
          </nav>

          {(activeTab === 'laporan' || activeTab === 'rekap') && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-2 px-3">
                {activeTab === 'laporan' ? 'Periode' : 'Tampilan'}
              </p>
              <nav className="space-y-1" aria-label="Sub-menu">
                {(activeTab === 'laporan' ? REPORT_SUBTABS : REKAP_SUBTABS).map((sub) => {
                  const active = activeTab === 'laporan' ? reportView === sub.id : rekapView === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() =>
                        activeTab === 'laporan'
                          ? openReportView(sub.id as ReportViewId)
                          : switchRekapView(sub.id as RekapViewId)
                      }
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors',
                        active ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      )}
                    >
                      {sub.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}
        </div>

        <div className="p-4 mt-auto border-t border-slate-200 bg-slate-50/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-500">ReSo v{APP_VERSION}</p>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Lokal
            </span>
          </div>
          {/* Slot tetap: status update tidak menggeser navigasi saat berubah. */}
          <div className="flex min-h-[20px] items-center">
            {update.status === 'ready' && (
              <button
                type="button"
                onClick={() => void installUpdate()}
                className="text-[11px] font-bold text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
                title={update.message}
              >
                Versi {update.version} siap — pasang sekarang
              </button>
            )}
            {update.status === 'downloading' && (
              <span className="text-[11px] font-medium text-slate-500">
                Mengunduh update… {update.progress ?? 0}%
              </span>
            )}
            {update.status === 'available' && (
              <span className="text-[11px] font-medium text-slate-500">
                Update {update.version} tersedia…
              </span>
            )}
            {update.status === 'checking' && (
              <span className="text-[11px] font-medium text-slate-500">Memeriksa update…</span>
            )}
            {update.status === 'error' && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-rose-600">
                Gagal memeriksa update
                <button
                  type="button"
                  onClick={() => void checkForUpdates()}
                  className="font-bold underline underline-offset-2 hover:text-rose-800"
                  title={update.message}
                >
                  Coba lagi
                </button>
              </span>
            )}
            {(update.status === 'idle' || update.status === 'not-available') && (
              <button
                type="button"
                onClick={() => void checkForUpdates()}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:underline underline-offset-2"
              >
                Cek update
              </button>
            )}
            {(update.status === 'ready' || update.status === 'error') && (
              <a
                href="https://github.com/minilabs-id/ReSo/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto shrink-0 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:underline underline-offset-2"
                title="Riwayat versi / rollback manual"
              >
                Riwayat versi
              </a>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
          <div className="px-4 py-5 md:px-6 lg:px-8 xl:px-10 max-w-[1800px] mx-auto w-full">
            {activeTab === 'laporan' && (
              <div className="mb-5">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">Laporan</h1>
                <p className="text-xs text-slate-500 mt-0.5">Rekapitulasi engagement pegawai per periode</p>
              </div>
            )}
            <React.Suspense fallback={null}>
            <AnimatePresence mode="wait">
              {activeTab === 'dashboard' && (
                <DashboardTab 
                  stats={stats}
                  chartData={chartData}
                  dailyEngagements={dailyEngagements}
                  onGoInput={openInputForToday}
                  onGoDaily={() => { setActiveTab('laporan'); openReportView('daily'); }}
                  dataLoading={dataStatus === 'loading'}
                />
              )}
               {activeTab === 'rekap' && rekapView === 'kalender' && (
                <motion.div 
                  key="overview"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="space-y-4 md:space-y-5"
                >
                  <CalendarPanel
                    currentMonth={currentMonth}
                    onChangeMonth={changeMonth}
                    selectedDate={currentDailyDateStr}
                    dailyEngagementsMap={dailyEngagementsMap}
                    unverifiedAutoFilledDates={unverifiedAutoFilledDates}
                    onVerifyAll={() => setVerifyAllConfirm(true)}
                    isVerifyingAll={isVerifyingAll}
                    onSelectDate={(date) => { setCurrentDailyDate(parseLocalISODate(date)); setIsInputModalOpen(true); }}
                    isOutsideHistoryWindow={isOutsideHistoryWindow}
                    notifyHistoryLimit={notifyHistoryLimit}
                  />
                  <InputModal
                    open={isInputModalOpen}
                    date={currentDailyDateStr}
                    existing={dailyEngagementsMap[currentDailyDateStr]}
                    employees={employees}
                    postedAt={selectedPostedAt}
                    unmatchedCount={selectedUnmatched.length}
                    onClose={closeInputModal}
                    closeGuardRef={inputCloseGuardRef}
                    onOpenUnmatched={() => setIsUnmatchedReviewOpen(true)}
                  />

                  {/* Modal review nama belum terpetakan — lewat ModalHost tunggal */}
                                    <UnmatchedReview
                    open={isUnmatchedReviewOpen}
                    onClose={() => setIsUnmatchedReviewOpen(false)}
                    date={currentDailyDateStr}
                    unmatched={selectedUnmatched}
                    employees={employees}
                    mapSelections={mapSelections}
                    onMapSelectionsChange={setMapSelections}
                    isMapping={isMapping}
                    onMap={handleMapUnmatched}
                    onRematch={handleRematchOnly}
                  />
                </motion.div>
              )}

               {activeTab === 'rekap' && rekapView === 'scraper' && (
                 <React.Suspense fallback={null}>
                   <ScraperTab
                      onOpenCalendar={() => {
                        setCurrentDailyDate(new Date());
                        switchRekapView('kalender');
                      }}
                    />
                 </React.Suspense>
               )}

{activeTab === 'laporan' && reportView === 'daily' && (
                <DailyReportView
                  currentDailyDate={currentDailyDate}
                  changeDailyDate={changeDailyDate}
                  canGoNext={canGoNextDaily}
                  employeeCount={employees.length}
                  sortMode={dailySortMode}
                  onSortChange={setDailySortMode}
                  handleExportPDF={handleExportPDF}
                  handleExportImage={handleExportImage}
                  handleExportExcel={handleExportExcel}
                  canExportImage={canExportImage}
                  printDailyRef={printDailyRef}
                  isLoading={isLoading}
                  sortedEmployees={sortedEmployees}
                  dailyEngagementsMap={dailyEngagementsMap}
                  dailyEngagementRate={dailyEngagementRate}
                />
              )}

              {activeTab === 'laporan' && reportView === 'weekly' && (
                <WeeklyReportView
                  weeklyReports={weeklyReports}
                  weeklyStats={weeklyStats}
                  weeklyDatesList={weeklyDatesList}
                  changeWeek={changeWeek}
                  canGoNext={canGoNextWeekly}
                  employeeCount={employees.length}
                  weekRange={weeklyReports[0]?.weekRange}
                  weeklySortMode={weeklySortMode}
                  setWeeklySortMode={setWeeklySortMode}
                  handleExportPDF={handleExportPDF}
                  handleExportImage={handleExportImage}
                  handleExportExcel={handleExportExcel}
                  canExportImage={canExportImage}
                  printRef={printRef}
                  isLoading={isLoading}
                  sortedEmployees={sortedEmployees}
                  dailyEngagementsMap={dailyEngagementsMap}
                />
              )}

              {activeTab === 'laporan' && reportView === 'monthly' && (
                <MonthlyReportView
                  monthlyReports={monthlyReports}
                  monthlyStats={monthlyStats}
                  sortedMonthlyEmployees={sortedMonthlyEmployees}
                  changeMonthlyReportDate={handleMonthlyReportChange}
                  canGoNext={canGoNextMonthly}
                  employeeCount={employees.length}
                  monthlySortMode={monthlySortMode}
                  setMonthlySortMode={setMonthlySortMode}
                  handleExportPDF={handleExportPDF}
                  handleExportImage={handleExportImage}
                  handleExportExcel={handleExportExcel}
                  canExportImage={canExportImage}
                  printMonthlyRef={printMonthlyRef}
                  isLoading={isLoading}
                />
              )}

              {activeTab === 'data' && (
                <motion.div
                  key="employees"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                >
                  <React.Suspense fallback={<div className="w-full h-full flex mt-20 items-center justify-center text-slate-500 text-[11px] font-bold">Memuat Modul Data Pegawai...</div>}>
                    <EmployeeManager employees={employees} />
                  </React.Suspense>
                </motion.div>
              )}

            {activeTab === 'pengaturan' && (
              <SettingsTab />
            )}
          </AnimatePresence>
            </React.Suspense>
        </div>
      </div>
    </main>
    </div>

      <ConfirmDialog
        open={verifyAllConfirm}
        title={`Verifikasi ${unverifiedAutoFilledDates.length} rekap otomatis?`}
        description={`Ini akan menandai ${unverifiedAutoFilledDates.length} tanggal dari seluruh rentang riwayat yang dimuat (±4 bulan) sebagai terverifikasi. Periksa dulu datanya jika ragu.`}
        confirmLabel="Ya, verifikasi semua"
        cancelLabel="Batal"
        tone="primary"
        busy={isVerifyingAll}
        onCancel={() => setVerifyAllConfirm(false)}
        onConfirm={async () => {
          setVerifyAllConfirm(false);
          await handleVerifyAllAutoFilled();
        }}
      />
    </>
  );
}

const NavItem = React.memo(function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <Button 
      variant="ghost" 
      className={cn(
        'w-full justify-start gap-3 h-11 rounded-xl px-4 transition-colors',
        active 
          ? 'bg-slate-900 text-white hover:bg-slate-800 hover:text-white' 
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      )}
      onClick={onClick}
    >
      <span className={active ? 'text-white' : 'text-slate-500'}>{icon}</span>
      <span className="font-semibold text-sm tracking-tight">{label}</span>
      {active && <span className="ml-auto w-1.5 h-1.5 bg-white/80 rounded-full" />}
    </Button>
  );
});


