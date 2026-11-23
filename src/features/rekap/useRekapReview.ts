import { useCallback, useMemo, useState } from 'react';
import { toast } from '../../lib/notify';
import { useAuth } from '../../components/LocalProvider';
import {
  arrayUnion,
  dinasDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from '../../lib/local-db';
import {
  matchEmployeesToEngagement,
  matchEngagementDetail,
} from '../../lib/matching';
import { collectUnverifiedAutoFilled } from '../../lib/auto-fill';
import type { DailyEngagement, Employee, UnmatchedName } from '../../types';

interface ReviewArgs {
  selectedDate: string;
  employees: Employee[];
  dailyEngagementsMap: Record<string, DailyEngagement>;
  setBusyAction: (action: string | null) => void;
}

/** Verifikasi rekap otomatis + pemetaan nama belum terpetakan (alias). */
export function useRekapReview({
  selectedDate,
  employees,
  dailyEngagementsMap,
  setBusyAction,
}: ReviewArgs) {
  const { user, db } = useAuth();
  const unverifiedAutoFilledDates = useMemo(
    () => collectUnverifiedAutoFilled(dailyEngagementsMap),
    [dailyEngagementsMap]
  );
  const [verifyAllConfirm, setVerifyAllConfirm] = useState(false);
  const [isUnmatchedReviewOpen, setIsUnmatchedReviewOpen] = useState(false);
  const [mapSelections, setMapSelections] = useState<Record<string, string>>({});

  const handleVerifyAllAutoFilled = async () => {
    if (!user || !db) {
      toast.error('Database lokal belum siap — coba lagi');
      return;
    }
    if (!unverifiedAutoFilledDates.length) return;
    setBusyAction('verify');
    try {
      const CHUNK = 500;
      for (let i = 0; i < unverifiedAutoFilledDates.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const date of unverifiedAutoFilledDates.slice(i, i + CHUNK)) {
          const ref = dinasDoc(db, user.uid, 'dailyEngagement', date);
          batch.set(ref, { date, verifiedAt: serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      toast.success(`${unverifiedAutoFilledDates.length} rekap otomatis ditandai terverifikasi.`);
    } catch (error: unknown) {
      console.error('Error verifying auto-filled rekaps:', error);
      toast.error('Gagal menandai terverifikasi — coba lagi.');
    } finally {
      setBusyAction(null);
    }
  };

  const selectedUnmatched = useMemo(() => {
    const eng = dailyEngagementsMap[selectedDate];
    return Array.isArray(eng?.unmatchedNames) ? (eng.unmatchedNames as UnmatchedName[]) : [];
  }, [dailyEngagementsMap, selectedDate]);

  const selectedPostedAt = useMemo(() => {
    const eng = dailyEngagementsMap[selectedDate];
    return Array.isArray(eng?.postedAt) ? (eng.postedAt as string[]) : [];
  }, [dailyEngagementsMap, selectedDate]);

  const rematchDate = useCallback(
    async (date: string, empList?: Employee[]): Promise<UnmatchedName[]> => {
      const eng = dailyEngagementsMap[date];
      const list = empList ?? employees;
      const raw = (p: 'ig' | 'fb' | 'tiktok') =>
        (p === 'ig' ? eng?.igRawText : p === 'fb' ? eng?.fbRawText : eng?.tiktokRawText) || '';
      const ids = (p: 'ig' | 'fb' | 'tiktok') => matchEmployeesToEngagement(raw(p), list, p);
      const unmatched = (['ig', 'fb', 'tiktok'] as const).flatMap((p) =>
        matchEngagementDetail(raw(p), list, p).unmatched.map((name) => ({ name, platform: p }))
      );
      await setDoc(
        dinasDoc(db, user.uid, 'dailyEngagement', date),
        {
          igEngagedEmployeeIds: ids('ig'),
          fbEngagedEmployeeIds: ids('fb'),
          tiktokEngagedEmployeeIds: ids('tiktok'),
          unmatchedNames: unmatched,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return unmatched;
    },
    [dailyEngagementsMap, employees, db, user]
  );

  const handleMapUnmatched = async () => {
    const entries = Object.entries(mapSelections).filter(([, empId]) => empId);
    if (!entries.length) return;
    setBusyAction('mapping');
    try {
      const localEmployees = employees.map((e) => ({ ...e }));
      for (const [key, empId] of entries) {
        const name = key.slice(key.indexOf('|') + 1);
        const emp = localEmployees.find((e) => e.id === empId);
        if (!emp) continue;
        await updateDoc(dinasDoc(db, user.uid, 'employees', empId), {
          name: emp.name,
          nip: emp.nip,
          bidang: emp.bidang || '',
          igUsername: emp.igUsername || '',
          igUsername2: emp.igUsername2 || '',
          fbName: emp.fbName || '',
          fbName2: emp.fbName2 || '',
          tiktokName: emp.tiktokName || '',
          tiktokName2: emp.tiktokName2 || '',
          aliases: arrayUnion(name),
          updatedAt: serverTimestamp(),
        });
        emp.aliases = [...(emp.aliases || []), name];
      }
      const remaining = await rematchDate(selectedDate, localEmployees);
      setMapSelections({});
      if (remaining.length === 0) {
        setIsUnmatchedReviewOpen(false);
        toast.success(`Semua nama tanggal ${selectedDate} sudah terpetakan.`);
      } else {
        toast.success(`${entries.length} nama dipetakan — ${remaining.length} belum terpetakan.`);
      }
    } catch (error: unknown) {
      console.error('Error mapping unmatched names:', error);
      toast.error('Gagal memetakan nama — coba lagi.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRematchOnly = async () => {
    setBusyAction('mapping');
    try {
      const remaining = await rematchDate(selectedDate);
      toast.info(`Match ulang selesai — ${remaining.length} nama belum terpetakan.`);
    } catch (error: unknown) {
      console.error('Error rematching:', error);
      toast.error('Gagal match ulang — coba lagi.');
    } finally {
      setBusyAction(null);
    }
  };

  return {
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
  };
}
