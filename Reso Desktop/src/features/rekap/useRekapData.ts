import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '../../lib/notify';
import { useLocal } from '../../components/LocalProvider';
import {
  dinasCollection,
  onSnapshot,
  orderBy,
  query,
  where,
} from '../../lib/local-db';
import {
  getLocalISODate,
  parseLocalISODate,
} from '../../lib/date';
import type { DailyEngagement, Employee } from '../../types';

export type DataStatus = 'loading' | 'ready' | 'error';

const HISTORY_LOOKBACK_DAYS = 120;

/**
 * Satu-satunya pemilik data rekap (master pegawai + rekap harian).
 * Komponen lain mengonsumsi hasilnya; tidak ada langganan onSnapshot duplikat.
 */
export function useRekapData() {
  const { user, loading, db } = useLocal();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dailyEngagements, setDailyEngagements] = useState<DailyEngagement[]>([]);
  const [dataStatus, setDataStatus] = useState<DataStatus>('loading');

  // Window riwayat STATIS: ±4 bulan ke belakang dari sesi aplikasi.
  // Sengaja tidak mengikuti navigasi bulan/minggu agar snapshot tidak
  // re-subscribe & mengunduh ulang seluruh riwayat hanya karena pindah periode.
  const historyWindowStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - HISTORY_LOOKBACK_DAYS);
    return getLocalISODate(d);
  }, []);

  const isOutsideHistoryWindow = useCallback(
    (d: Date) => {
      const earliest = parseLocalISODate(historyWindowStart);
      earliest.setHours(0, 0, 0, 0);
      return d < earliest;
    },
    [historyWindowStart]
  );

  const notifyHistoryLimit = useCallback(() => {
    toast.info('Riwayat rekap tersedia sekitar 4 bulan terakhir.');
  }, []);

  useEffect(() => {
    if (loading || !user || !db) {
      setEmployees([]);
      return;
    }

    const q = query(dinasCollection(db, user.uid, 'employees'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEmployees(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
        setDataStatus('ready');
      },
      (err) => {
        console.error('Gagal memuat pegawai:', err);
        setDataStatus('error');
        toast.error('Gagal memuat data pegawai');
      }
    );
    return unsubscribe;
  }, [user, loading, db]);

  useEffect(() => {
    if (loading || !user || !db) {
      setDailyEngagements([]);
      return;
    }

    const q = query(
      dinasCollection(db, user.uid, 'dailyEngagement'),
      where('date', '>=', historyWindowStart),
      orderBy('date', 'desc')
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setDailyEngagements(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as DailyEngagement))
        );
        setDataStatus('ready');
      },
      (err) => {
        console.error('Gagal memuat rekap harian:', err);
        setDataStatus('error');
        toast.error('Gagal memuat data rekap');
      }
    );
    return unsubscribe;
  }, [user, loading, db, historyWindowStart]);

  const dailyEngagementsMap = useMemo(
    () =>
      dailyEngagements.reduce<Record<string, DailyEngagement>>((acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      }, {}),
    [dailyEngagements]
  );

  return {
    employees,
    dailyEngagements,
    dailyEngagementsMap,
    dataStatus,
    isOutsideHistoryWindow,
    notifyHistoryLimit,
  };
}
