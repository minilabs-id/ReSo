import { useMemo, useState } from 'react';
import { getLocalISODate, parseLocalISODate } from '../../lib/date';
import type { DailyEngagement, Employee } from '../../types';

interface ReportStateArgs {
  employees: Employee[];
  dailyEngagementsMap: Record<string, DailyEngagement>;
  isOutsideHistoryWindow: (d: Date) => boolean;
  notifyHistoryLimit: () => void;
}

/** State & agregasi laporan harian/mingguan/bulanan dalam satu hook. */
export function useReportState({
  employees,
  dailyEngagementsMap,
  isOutsideHistoryWindow,
  notifyHistoryLimit,
}: ReportStateArgs) {
  const [currentWeekDate, setCurrentWeekDate] = useState(new Date());
  const [currentMonthlyReportDate, setCurrentMonthlyReportDate] = useState(new Date());
  const [currentDailyDate, setCurrentDailyDate] = useState(new Date());
  const [weeklySortMode, setWeeklySortMode] = useState<'name' | 'bidang'>('bidang');
  const [monthlySortMode, setMonthlySortMode] = useState<'rank' | 'bidang' | 'name'>('rank');
  const weeklyReports = useMemo(() => {
    if (employees.length === 0) return [];

    // Get Monday of the current week date
    const date = new Date(currentWeekDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDates.push(getLocalISODate(d));
    }

    // Calculate ISO week number
    // Weekday dihitung dari tanggal WIB, bukan zona lokal mesin.
    const mondayISO = getLocalISODate(monday);
    const target = new Date(monday.valueOf());
    const dayNr = (new Date(`${mondayISO}T00:00:00Z`).getUTCDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    const todayStr = getLocalISODate(new Date());

    return [{
      weekNumber: weekNum,
      monthName: parseLocalISODate(mondayISO).toLocaleDateString('id-ID', { month: 'long', timeZone: 'Asia/Jakarta' }),
      year: Number(mondayISO.slice(0, 4)),
      weekRange: `${parseLocalISODate(weekDates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${parseLocalISODate(weekDates[6]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      dates: weekDates,
      isCurrentWeek: weekDates.includes(todayStr)
    }];
  }, [employees, currentWeekDate]);

  const weeklyDatesList = useMemo(() => weeklyReports.flatMap(w => w.dates), [weeklyReports]);

  const weeklyStats = useMemo(() => {
    if (weeklyReports.length === 0) return { employeeTotals: {} as Record<string, number>, maxEngagements: 3, top3Ids: [], bottom3Ids: [], bidangRates: [] as { bidang: string, rate: number }[] };
    
    const weekDates = weeklyReports[0].dates;
    const todayStr = getLocalISODate(new Date());
    
    let daysPassed = 0;
    weekDates.forEach(date => {
      if (date <= todayStr) daysPassed++;
    });
    if (daysPassed === 0) daysPassed = 1; // Prevent division by zero

    const maxEngagements = daysPassed * 3;
    
    const employeeTotals: Record<string, number> = {};
    const bidangStats: Record<string, { possible: number, actual: number }> = {};

    employees.forEach(emp => {
      let totalEngagements = 0;
      weekDates.forEach(date => {
        if (date > todayStr) return;
        const engagement = dailyEngagementsMap[date];
        const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        totalEngagements += (hasIg + hasFb + hasTiktok);
      });
      employeeTotals[emp.id] = totalEngagements;

      const bidang = emp.bidang || 'Lainnya';
      if (!bidangStats[bidang]) bidangStats[bidang] = { possible: 0, actual: 0 };
      bidangStats[bidang].possible += maxEngagements;
      bidangStats[bidang].actual += totalEngagements;
    });

    const uniqueScores = Array.from(new Set(Object.values(employeeTotals))).sort((a, b) => b - a);
    const top3Scores = uniqueScores.slice(0, 3);
    const bottom3Scores = [...uniqueScores].reverse().slice(0, 3);

    const top3Ids = employees.filter(e => top3Scores.includes(employeeTotals[e.id])).map(e => e.id);
    const bottom3Ids = employees.filter(e => bottom3Scores.includes(employeeTotals[e.id]) && !top3Ids.includes(e.id)).map(e => e.id);

    // Calculate rate per bidang
    const bidangRates = Object.entries(bidangStats).map(([bidang, stats]) => ({
      bidang,
      rate: stats.possible > 0 ? Math.round((stats.actual / stats.possible) * 100) : 0
    })).sort((a, b) => b.rate - a.rate);

    return { employeeTotals, maxEngagements, top3Ids, bottom3Ids, bidangRates };
  }, [weeklyReports, employees, dailyEngagementsMap]);

  const changeWeek = (offset: number) => {
    const newDate = new Date(currentWeekDate);
    newDate.setDate(newDate.getDate() + (offset * 7));
    if (isOutsideHistoryWindow(newDate)) {
      notifyHistoryLimit();
      return;
    }
    setCurrentWeekDate(newDate);
  };

  const monthlyReports = useMemo(() => {
    if (employees.length === 0) return [];
    
    const year = currentMonthlyReportDate.getFullYear();
    const month = currentMonthlyReportDate.getMonth();
    
    // Get all days in the current month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthDates: string[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
        monthDates.push(getLocalISODate(new Date(year, month, i)));
    }
    
    const monthName = currentMonthlyReportDate.toLocaleDateString('id-ID', { month: 'long' });
    const todayStr = getLocalISODate(new Date());

    return [{
       monthName,
       year,
       monthRange: `${parseLocalISODate(monthDates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${parseLocalISODate(monthDates[monthDates.length - 1]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
       dates: monthDates,
       isCurrentMonth: monthDates.includes(todayStr)
    }];
  }, [employees, currentMonthlyReportDate]);

  const monthlyStats = useMemo(() => {
    if (monthlyReports.length === 0) return { employeeTotals: {} as Record<string, number>, employeePlatformStats: {} as Record<string, { igPercent: number, fbPercent: number, tiktokPercent: number }>, maxEngagements: 3, top3Ids: [], bottom3Ids: [], bidangRates: [] as { bidang: string, rate: number }[] };
    
    const monthDates = monthlyReports[0].dates;
    const todayStr = getLocalISODate(new Date());
    
    let daysPassed = 0;
    monthDates.forEach(date => {
      if (date <= todayStr) daysPassed++;
    });
    if (daysPassed === 0) daysPassed = 1; // Prevent division by zero

    const maxEngagements = daysPassed * 3;
    
    const employeeTotals: Record<string, number> = {};
    const employeePlatformStats: Record<string, { igPercent: number, fbPercent: number, tiktokPercent: number }> = {};
    const bidangStats: Record<string, { possible: number, actual: number }> = {};

    employees.forEach(emp => {
      let totalIg = 0;
      let totalFb = 0;
      let totalTiktok = 0;
      let totalEngagements = 0;
      
      monthDates.forEach(date => {
        if (date > todayStr) return;
        const engagement = dailyEngagementsMap[date];
        const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        totalIg += hasIg;
        totalFb += hasFb;
        totalTiktok += hasTiktok;
        totalEngagements += (hasIg + hasFb + hasTiktok);
      });
      employeeTotals[emp.id] = totalEngagements;
      employeePlatformStats[emp.id] = {
        igPercent: daysPassed > 0 ? Math.round((totalIg / daysPassed) * 100) : 0,
        fbPercent: daysPassed > 0 ? Math.round((totalFb / daysPassed) * 100) : 0,
        tiktokPercent: daysPassed > 0 ? Math.round((totalTiktok / daysPassed) * 100) : 0,
      };

      const bidang = emp.bidang || 'Lainnya';
      if (!bidangStats[bidang]) bidangStats[bidang] = { possible: 0, actual: 0 };
      bidangStats[bidang].possible += maxEngagements;
      bidangStats[bidang].actual += totalEngagements;
    });

    const uniqueScores = Array.from(new Set(Object.values(employeeTotals))).sort((a, b) => b - a);
    const top3Scores = uniqueScores.slice(0, 3);
    const bottom3Scores = [...uniqueScores].reverse().slice(0, 3);

    const top3Ids = employees.filter(e => top3Scores.includes(employeeTotals[e.id])).map(e => e.id);
    const bottom3Ids = employees.filter(e => bottom3Scores.includes(employeeTotals[e.id]) && !top3Ids.includes(e.id)).map(e => e.id);

    // Calculate rate per bidang
    const bidangRates = Object.entries(bidangStats).map(([bidang, stats]) => ({
      bidang,
      rate: stats.possible > 0 ? Math.round((stats.actual / stats.possible) * 100) : 0
    })).sort((a, b) => b.rate - a.rate);

    return { employeeTotals, employeePlatformStats, maxEngagements, top3Ids, bottom3Ids, bidangRates };
  }, [monthlyReports, employees, dailyEngagementsMap]);

  const sortedMonthlyEmployees = useMemo(() => {
    return employees.slice().sort((a, b) => {
      if (monthlySortMode === 'rank') {
        const scoreA = monthlyStats.employeeTotals[a.id] || 0;
        const scoreB = monthlyStats.employeeTotals[b.id] || 0;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
      } else if (monthlySortMode === 'name') {
        return a.name.localeCompare(b.name);
      }
      return (a.bidang || '').localeCompare(b.bidang || '') || a.name.localeCompare(b.name);
    });
  }, [employees, monthlySortMode, monthlyStats.employeeTotals]);

  const changeMonthlyReportDate = (offset: number) => {
    const newDate = new Date(currentMonthlyReportDate);
    newDate.setMonth(newDate.getMonth() + offset);
    if (isOutsideHistoryWindow(newDate)) {
      notifyHistoryLimit();
      return;
    }
    setCurrentMonthlyReportDate(newDate);
  };

  const changeDailyDate = (offset: number) => {
    const newDate = new Date(currentDailyDate);
    newDate.setDate(newDate.getDate() + offset);
    if (isOutsideHistoryWindow(newDate)) {
      notifyHistoryLimit();
      return;
    }
    setCurrentDailyDate(newDate);
  };


  const currentDailyDateStr = getLocalISODate(currentDailyDate);
  const todayISO = getLocalISODate(new Date());
  const lastWeeklyISO = weeklyDatesList.reduce((a, b) => (a > b ? a : b), '');
  const canGoNextDaily = currentDailyDateStr < todayISO;
  // Tanpa data periode (master kosong), tombol "Berikutnya" ikut dinonaktifkan
  // supaya konsisten dengan Harian/Bulanan — bukan malah aktif.
  const canGoNextWeekly = lastWeeklyISO ? lastWeeklyISO < todayISO : false;
  const canGoNextMonthly =
    currentMonthlyReportDate.getFullYear() < new Date().getFullYear() ||
    (currentMonthlyReportDate.getFullYear() === new Date().getFullYear() &&
      currentMonthlyReportDate.getMonth() < new Date().getMonth());

  return {
    currentDailyDate,
    setCurrentDailyDate,
    currentWeekDate,
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
    changeMonthlyReportDate,
    changeDailyDate,
    canGoNextWeekly,
    canGoNextMonthly,
    canGoNextDaily,
  };
}