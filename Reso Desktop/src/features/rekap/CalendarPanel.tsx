import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, CheckCircle2, Check, CalendarIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PLATFORM_LABEL_SHORT } from '../../components/shared/platformLabels';
import { containerVariants, itemVariants } from '../../shared/motion';
import { getLocalISODate, parseLocalISODate } from '../../lib/date';
import { cn } from '@/lib/utils';
import type { DailyEngagement } from '../../types';

interface CalendarPanelProps {
  currentMonth: Date;
  onChangeMonth: (offset: number) => void;
  selectedDate: string;
  dailyEngagementsMap: Record<string, DailyEngagement>;
  unverifiedAutoFilledDates: string[];
  onVerifyAll: () => void;
  isVerifyingAll: boolean;
  onSelectDate: (date: string) => void;
  isOutsideHistoryWindow: (d: Date) => boolean;
  notifyHistoryLimit: () => void;
}

/** Kalender rekap + ringkasan bulan + aksi cepat (satu feature, tidak di shell). */
export function CalendarPanel({
  currentMonth,
  onChangeMonth,
  selectedDate,
  dailyEngagementsMap,
  unverifiedAutoFilledDates,
  onVerifyAll,
  isVerifyingAll,
  onSelectDate,
  isOutsideHistoryWindow,
  notifyHistoryLimit,
}: CalendarPanelProps) {
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days = [];
    // Padding for start of month
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push({
        day: null, date: '', isCurrentMonth: false, isToday: false, isFilled: false,
        isFuture: false, isAutoFilled: false, isVerified: false, hasUnmatched: false,
        hasIgData: false, hasFbData: false, hasTtData: false, unmatchedCount: 0,
      });
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const dateStr = getLocalISODate(date);
      const engagement = dailyEngagementsMap[dateStr];
      days.push({
        day: d,
        date: dateStr,
        isCurrentMonth: true,
        isToday: dateStr === getLocalISODate(new Date()),
        isFilled: !!engagement && (
          (engagement.igEngagedEmployeeIds?.length || 0) > 0 ||
          (engagement.fbEngagedEmployeeIds?.length || 0) > 0 ||
          (engagement.tiktokEngagedEmployeeIds?.length || 0) > 0 ||
          !!(engagement.igRawText || engagement.fbRawText || engagement.tiktokRawText)
        ),
        isAutoFilled: !!engagement?.autoFilledAt,
        isVerified: !!engagement?.verifiedAt,
        hasUnmatched: !!engagement?.unmatchedNames?.length,
        // Platform yang benar-benar punya catatan pada tanggal itu (id cocok
        // atau raw text) — sumber dot IG/FB/TT di sel kalender.
        hasIgData: !!engagement && ((engagement.igEngagedEmployeeIds?.length || 0) > 0 || !!engagement.igRawText),
        hasFbData: !!engagement && ((engagement.fbEngagedEmployeeIds?.length || 0) > 0 || !!engagement.fbRawText),
        hasTtData: !!engagement && ((engagement.tiktokEngagedEmployeeIds?.length || 0) > 0 || !!engagement.tiktokRawText),
        unmatchedCount: engagement?.unmatchedNames?.length || 0,
        isFuture: dateStr > getLocalISODate(new Date())
      });
    }
    return days;
  }, [currentMonth, dailyEngagementsMap]);

  const monthSummary = useMemo(() => {
    const filled = calendarDays.filter(d => d.isFilled).length;
    const needReview = calendarDays.filter(d => d.isAutoFilled && !d.isVerified).length;
    const verified = calendarDays.filter(d => d.isVerified).length;
    const unmatched = calendarDays.filter(d => d.hasUnmatched).length;
    return { filled, needReview, verified, unmatched };
  }, [calendarDays]);

  return (
                  <motion.div variants={itemVariants} className="bg-white rounded-xl p-4 sm:p-5 md:p-6 border border-slate-200">
                    {/* Header: bulan nav + indikator + tombol terima */}
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5 mb-3">
                      <div className="flex items-center justify-between lg:justify-start gap-2">
                        <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200 shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => onChangeMonth(-1)} aria-label="Bulan sebelumnya" title="Bulan sebelumnya" className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0">
                            <ChevronLeft size={14} />
                          </Button>
                          <div className="text-center min-w-[128px]">
                            <h2 className="text-sm font-bold text-slate-900">
                              {currentMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}
                            </h2>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => onChangeMonth(1)} aria-label="Bulan berikutnya" title="Bulan berikutnya" className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0">
                            <ChevronRight size={14} />
                          </Button>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onSelectDate(getLocalISODate(new Date()))}
                          className="text-[11px] font-bold border-slate-200 text-slate-600 hover:bg-slate-100 h-8 shrink-0"
                        >
                          Hari ini
                        </Button>
                      </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-slate-900" /> Terisi
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-amber-400" /> Perlu review
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Check size={10} strokeWidth={3.5} className="text-emerald-600 shrink-0" aria-hidden /> Terverifikasi
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-black text-amber-500 leading-none">!</span> Belum terpetakan
                            </div>
                          </div>

                        {unverifiedAutoFilledDates.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={onVerifyAll}
                            disabled={isVerifyingAll}
                            className="text-[11px] font-bold border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 h-8 shrink-0"
                          >
                            <CheckCircle2 size={13} className="mr-1.5" />
                            {isVerifyingAll
                              ? 'Menandai…'
                              : `Terima ${unverifiedAutoFilledDates.length} rekap otomatis`}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
                      {/* Kalender */}
                      <div className="overflow-y-auto min-w-0">
                        <div className="min-w-[280px] sm:min-w-[400px] h-[calc(100dvh-14.5rem)] md:h-[calc(100dvh-12rem)] lg:h-[calc(100dvh-10.5rem)] min-h-[340px]">
                          <div className="grid grid-cols-7 grid-rows-[repeat(7,minmax(0,1fr))] gap-0.5 sm:gap-1 h-full">
                            {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(day => (
                              <div key={day} className="text-center py-0.5 md:py-1 text-[11px] font-bold text-slate-500 uppercase tracking-widest self-end">
                                {day}
                              </div>
                            ))}
                            {calendarDays.map((day, idx) => (
                              <div key={idx} className="h-full min-h-0">
                                {day.day ? (
                                  <button
                                    onClick={() => onSelectDate(day.date)}
                                    disabled={day.isFuture}
                                    aria-current={day.date === selectedDate ? 'date' : undefined}
                                    aria-label={[
                                      `${day.day} ${currentMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}`,
                                      day.isFuture ? 'belum bisa diisi' : day.isFilled ? 'rekap terisi' : 'belum ada rekap',
                                      day.isToday ? 'hari ini' : null,
                                      day.isVerified ? 'terverifikasi' : null,
                                      day.unmatchedCount > 0 ? `${day.unmatchedCount} nama belum terpetakan` : null,
                                    ].filter(Boolean).join(', ')}
                                    className={cn(
                                      "w-full h-full rounded-md md:rounded-lg flex flex-col items-center justify-center gap-0.5 md:gap-1 transition-all relative group border",
                                      day.isFuture ? "bg-slate-50/50 cursor-not-allowed opacity-30 border-transparent" :
                                      day.isToday && day.isFilled ? "bg-slate-900 text-white border-slate-900 ring-1 ring-inset ring-emerald-300" :
                                      day.isFilled ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800" :
                                      day.isToday ? "bg-white text-slate-900 border-emerald-500 border-2 hover:bg-emerald-50" :
                                      "bg-white text-slate-600 hover:bg-slate-50 border-slate-200",
                                      // Tanggal aktif = satu konteks dengan modal input & laporan harian.
                                      day.date === selectedDate && "ring-2 ring-slate-900 ring-offset-1"
                                    )}
                                  >
                                    <span className="text-sm sm:text-base font-bold leading-none">{day.day}</span>
                                    {day.isToday && !day.isFilled && (
                                      <span className="text-[11px] font-bold text-emerald-600 leading-none">Hari ini</span>
                                    )}
                                    <div className="flex gap-0.5 items-center">
                                      {/* Dot amber = rekap otomatis yang belum direview operator */}
                                      {day.isAutoFilled && !day.isVerified && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-amber-300" : "bg-amber-400")} />
                                      )}
                                      {day.hasUnmatched && (
                                        <span className="text-[11px] font-black text-amber-500 leading-none" title="Ada nama belum terpetakan">!</span>
                                      )}
                                      {/* Dot platform hanya muncul untuk platform yang benar-benar ada datanya */}
                                      {day.hasIgData && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-pink-300" : "bg-pink-400")} />
                                      )}
                                      {day.hasFbData && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-blue-300" : "bg-blue-400")} />
                                      )}
                                      {day.hasTtData && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-slate-300" : "bg-slate-500")} />
                                      )}
                                    </div>
                                    {/* Tanda terverifikasi — berlaku untuk rekap manual maupun otomatis */}
                                    {day.isVerified && (
                                      <Check
                                        size={9}
                                        strokeWidth={3.5}
                                        aria-hidden
                                        className={cn(
                                          "absolute right-[3px] top-[3px]",
                                          day.isFilled ? (day.isToday ? "text-emerald-300" : "text-emerald-400") : "text-emerald-600"
                                        )}
                                      />
                                    )}
                                  </button>
                                ) : (
                                  <div className="w-full h-full" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Ringkasan bulan */}
                      <div className="flex flex-col gap-3 min-w-0">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                            Ringkasan bulan
                          </h4>
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <div className="w-2 h-2 rounded-full bg-slate-900" />
                                Hari terisi
                              </div>
                              <span className="text-sm font-bold text-slate-900">{monthSummary.filled}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <div className="w-2 h-2 rounded-full bg-amber-400" />
                                Perlu review
                              </div>
                              <span className="text-sm font-bold text-amber-600">{monthSummary.needReview}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <Check size={11} strokeWidth={3.5} className="text-emerald-600 shrink-0" aria-hidden />
                                Terverifikasi
                              </div>
                              <span className="text-sm font-bold text-emerald-600">{monthSummary.verified}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <span className="w-2 h-2 rounded-full bg-amber-200 flex items-center justify-center text-[11px] font-black text-amber-600 leading-none">!</span>
                                Belum terpetakan
                              </div>
                              <span className="text-sm font-bold text-amber-600">{monthSummary.unmatched}</span>
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>
                  </motion.div>


  );
}