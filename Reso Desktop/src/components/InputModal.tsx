import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Instagram, Facebook } from 'lucide-react';
import { setDoc, serverTimestamp, runTransaction, dinasDoc } from '../lib/local-db';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { toast } from '../lib/notify';
import { TiktokIcon } from './icons/TiktokIcon';
import { cn } from '@/lib/utils';
import { useLocal } from './LocalProvider';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { clearDraft, loadDraft, useDraftAutosave } from '../features/rekap/draftStorage';
import { ConfirmDialog } from './ui/confirm-dialog';
import { parseLocalISODate } from '../lib/date';
import { matchEmployeesToEngagement, matchEngagementDetail, engagedIdsEqual } from '../lib/matching';
import type { DailyEngagement, Employee, UnmatchedName } from '../types';

interface InputModalProps {
  open: boolean;
  date: string;
  /** Dokumen rekap tanggal ini dari snapshot parent (boleh undefined). */
  existing?: DailyEngagement;
  employees: Employee[];
  /** Waktu posting yang direkap otomatis, dipakai untuk info di header. */
  postedAt: string[];
  unmatchedCount: number;
  onClose: () => void;
  /** Parent memanggil guard ini untuk Esc/back-button agar dirty-check dipakai. */
  closeGuardRef?: React.MutableRefObject<((afterClose?: () => void) => void) | null>;
  onOpenUnmatched: () => void;
}

function MatchPreviewImpl({ ig, fb, tiktok }: { ig: number; fb: number; tiktok: number }) {
  const chip = (label: string, n: number, cls: string) => (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold', cls)}>
      {label} {n}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
      {chip('IG', ig, 'bg-pink-50 text-pink-600')}
      {chip('FB', fb, 'bg-blue-50 text-blue-600')}
      {chip('TT', tiktok, 'bg-slate-100 text-slate-600')}
      <span>pegawai terdeteksi</span>
    </div>
  );
}

const MatchPreview = React.memo(MatchPreviewImpl);

export function InputModal({
  open,
  date,
  existing,
  employees,
  postedAt,
  unmatchedCount,
  onClose,
  closeGuardRef,
  onOpenUnmatched,
}: InputModalProps) {
  const { user, db } = useLocal();
  const dialogRef = useDialogA11y<HTMLDivElement>(open);

  // ── State lokal: mengetik di sini TIDAK me-render ulang app shell ──
  const [igRawInput, setIgRawInput] = useState('');
  const [fbRawInput, setFbRawInput] = useState('');
  const [tiktokRawInput, setTiktokRawInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);

  const [initialIgRawInput, setInitialIgRawInput] = useState('');
  const [initialFbRawInput, setInitialFbRawInput] = useState('');
  const [initialTiktokRawInput, setInitialTiktokRawInput] = useState('');

  /** Satu sumber kebenaran untuk "ada perubahan belum disimpan". */
  const hasUnsavedChanges = (): boolean =>
    igRawInput !== initialIgRawInput ||
    fbRawInput !== initialFbRawInput ||
    tiktokRawInput !== initialTiktokRawInput;

  const prevDateRef = useRef(date);
  const notifiedDirtyRef = useRef<string | null>(null);


  // Matching preview ditahan (debounce) — hanya dihitung selagi modal terbuka.
  const debouncedIgRawInput = useDebouncedValue(igRawInput);
  const debouncedFbRawInput = useDebouncedValue(fbRawInput);
  const debouncedTiktokRawInput = useDebouncedValue(tiktokRawInput);

  const matchPreview = useMemo(
    () => ({
      ig: matchEmployeesToEngagement(debouncedIgRawInput, employees, 'ig').length,
      fb: matchEmployeesToEngagement(debouncedFbRawInput, employees, 'fb').length,
      tiktok: matchEmployeesToEngagement(debouncedTiktokRawInput, employees, 'tiktok').length,
    }),
    [debouncedIgRawInput, debouncedFbRawInput, debouncedTiktokRawInput, employees]
  );

  // Draf disimpan otomatis (debounced) agar Esc/tutup tidak lagi menjadi jalur
  // kehilangan data. Draf tidak pernah menimpa data tersimpan tanpa konfirmasi.
  const draft = useMemo(
    () => ({
      ig: igRawInput,
      fb: fbRawInput,
      tiktok: tiktokRawInput,
    }),
    [igRawInput, fbRawInput, tiktokRawInput]
  );
  useDraftAutosave(date, draft, open);
  const storedDraft = open ? loadDraft(date) : null;
  const draftDiffers =
    !!storedDraft &&
    (storedDraft.ig !== igRawInput ||
      storedDraft.fb !== fbRawInput ||
      storedDraft.tiktok !== tiktokRawInput);

  // Muat isi dokumen saat modal dibuka / ganti tanggal. Guard "dirty"
  // mencegah data tarikan Meta/API yang belum disimpan tertimpa snapshot baru.
  useEffect(() => {
    if (!open) {
      notifiedDirtyRef.current = null;
      return;
    }

    const isDirty = hasUnsavedChanges();
    const isDateChange = date !== prevDateRef.current;

    if (isDirty) {
      if (isDateChange) {
        const ok = window.confirm('Ada perubahan belum disimpan. Buang perubahan dan muat tanggal baru?');
        if (!ok) return;
      } else {
        if (notifiedDirtyRef.current !== date) {
          notifiedDirtyRef.current = date;
          toast.info('Ada perubahan yang belum disimpan. Simpan terlebih dahulu.');
        }
        return;
      }
    }
    notifiedDirtyRef.current = null;
    prevDateRef.current = date;

    if (existing) {
      setIgRawInput(existing.igRawText || '');
      setFbRawInput(existing.fbRawText || '');
      setTiktokRawInput(existing.tiktokRawText || '');

      setInitialIgRawInput(existing.igRawText || '');
      setInitialFbRawInput(existing.fbRawText || '');
      setInitialTiktokRawInput(existing.tiktokRawText || '');
    } else {
      setIgRawInput('');
      setFbRawInput('');
      setTiktokRawInput('');

      setInitialIgRawInput('');
      setInitialFbRawInput('');
      setInitialTiktokRawInput('');
    }
  }, [open, date, existing]);

  /** Aksi lanjutan setelah modal benar-benar ditutup (mis. pindah menu). */
  const pendingAfterCloseRef = useRef<(() => void) | null>(null);

  /** Semua jalur tutup (Esc/backdrop/X/Batal) lewat sini agar input tidak hilang. */
  const finishClose = (): void => {
    setCloseConfirm(false);
    onClose();
    const after = pendingAfterCloseRef.current;
    pendingAfterCloseRef.current = null;
    after?.();
  };

  /**
   * Guard tutup. `afterClose` dipanggil hanya bila modal benar-benar tertutup —
   * dipakai induk untuk pindah menu tanpa kehilangan input yang belum disimpan.
   */
  const requestClose = (afterClose?: () => void): void => {
    if (isSaving) return;
    if (hasUnsavedChanges()) {
      pendingAfterCloseRef.current = afterClose ?? null;
      setCloseConfirm(true);
      return;
    }
    onClose();
    afterClose?.();
  };

  if (closeGuardRef) closeGuardRef.current = requestClose;

  const handleSave = async () => {
    if (!user || !db) {
      toast.error('Database lokal belum siap — jalankan ReSo Desktop');
      return;
    }

    setIsSaving(true);
    try {
      const currentIgRawInput = igRawInput;
      const currentFbRawInput = fbRawInput;
      const currentTiktokRawInput = tiktokRawInput;

      // Selalu rematch — master pegawai bisa berubah meski raw text sama
      const igEngagedIds = matchEmployeesToEngagement(currentIgRawInput, employees, 'ig');
      const fbEngagedIds = matchEmployeesToEngagement(currentFbRawInput, employees, 'fb');
      const tiktokEngagedIds = matchEmployeesToEngagement(currentTiktokRawInput, employees, 'tiktok');

      const docRef = dinasDoc(db, user.uid, 'dailyEngagement', date);

      const igContentChanged = currentIgRawInput !== initialIgRawInput;
      const fbContentChanged = currentFbRawInput !== initialFbRawInput;
      const tiktokContentChanged = currentTiktokRawInput !== initialTiktokRawInput;

      const igIdsChanged = !engagedIdsEqual(existing?.igEngagedEmployeeIds || [], igEngagedIds);
      const fbIdsChanged = !engagedIdsEqual(existing?.fbEngagedEmployeeIds || [], fbEngagedIds);
      const tiktokIdsChanged = !engagedIdsEqual(existing?.tiktokEngagedEmployeeIds || [], tiktokEngagedIds);

      const igChanged = igContentChanged || igIdsChanged;
      const fbChanged = fbContentChanged || fbIdsChanged;
      const tiktokChanged = tiktokContentChanged || tiktokIdsChanged;

      if (!igChanged && !fbChanged && !tiktokChanged) {
        // Rekap otomatis sudah lengkap di DB — simpan tanpa ubahan
        // cukup menandai terverifikasi. Gunakan transaction agar tidak race dengan extension.
        if (existing?.autoFilledAt && !existing.verifiedAt) {
          await runTransaction(db, async (tx) => {
            tx.set(docRef, { date, verifiedAt: serverTimestamp() }, { merge: true });
          });
          toast.success('Rekap ditandai terverifikasi — data sudah lengkap dari rekap otomatis.');
        } else {
          toast.info('Tidak ada perubahan untuk disimpan');
        }
        onClose();
        return;
      }

      const updateData: Record<string, unknown> = {
        date,
        updatedAt: serverTimestamp(),
        // Menyimpan = operator sudah memeriksa rekap (termasuk yang auto-filled).
        verifiedAt: serverTimestamp()
      };

      if (igChanged) {
        updateData.igRawText = currentIgRawInput;
        updateData.igEngagedEmployeeIds = igEngagedIds;
      }
      if (fbChanged) {
        updateData.fbRawText = currentFbRawInput;
        updateData.fbEngagedEmployeeIds = fbEngagedIds;
      }
      if (tiktokChanged) {
        updateData.tiktokRawText = currentTiktokRawInput;
        updateData.tiktokEngagedEmployeeIds = tiktokEngagedIds;
      }

      // Antrian nama belum terpetakan: platform berubah dihitung ulang, lainnya
      // dipertahankan dari dokumen TERBARU (bukan prop yang bisa basi).
      const buildUnmatched = (source?: DailyEngagement): UnmatchedName[] => {
        const prev = Array.isArray(source?.unmatchedNames) ? source!.unmatchedNames! : [];
        const seen = new Set<string>();
        const result: UnmatchedName[] = [];
        const push = (u: UnmatchedName) => {
          const key = `${u.name.trim().toLowerCase()}|${u.platform}`;
          if (seen.has(key)) return;
          seen.add(key);
          result.push(u);
        };
        for (const p of ['ig', 'fb', 'tiktok'] as const) {
          const changed = p === 'ig' ? igChanged : p === 'fb' ? fbChanged : tiktokChanged;
          if (changed) {
            const raw = p === 'ig' ? currentIgRawInput : p === 'fb' ? currentFbRawInput : currentTiktokRawInput;
            for (const name of matchEngagementDetail(raw, employees, p).unmatched) push({ name, platform: p });
          } else {
            for (const u of prev) if (u.platform === p) push(u);
          }
        }
        return result;
      };
      updateData.unmatchedNames = buildUnmatched(existing);

      await runTransaction(db, async (tx) => {
        // Baca snapshot terbaru untuk hindari last-write-wins dengan extension
        const snap = await tx.get(docRef);
        const latest = snap.exists() ? (snap.data() as unknown as DailyEngagement) : undefined;
        // Jika ekstensi baru saja menulis rawText untuk platform yang tidak kita ubah,
        // jangan timpa — merge dengan data terbaru untuk platform tersebut
        const merged: Record<string, unknown> = { ...updateData };
        if (!igChanged && latest?.igRawText !== undefined) {
          merged.igRawText = latest.igRawText;
          if (latest.igEngagedEmployeeIds !== undefined) merged.igEngagedEmployeeIds = latest.igEngagedEmployeeIds;
        }
        if (!fbChanged && latest?.fbRawText !== undefined) {
          merged.fbRawText = latest.fbRawText;
          if (latest.fbEngagedEmployeeIds !== undefined) merged.fbEngagedEmployeeIds = latest.fbEngagedEmployeeIds;
        }
        if (!tiktokChanged && latest?.tiktokRawText !== undefined) {
          merged.tiktokRawText = latest.tiktokRawText;
          if (latest.tiktokEngagedEmployeeIds !== undefined) merged.tiktokEngagedEmployeeIds = latest.tiktokEngagedEmployeeIds;
        }
        // Hitung ulang antrian dari snapshot terbaru agar auto-fill yang masuk
        // selagi modal terbuka tidak hilang.
        merged.unmatchedNames = buildUnmatched(latest);
        // Sanitasi terakhir sebelum menulis ke SQLite
        for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
        tx.set(docRef, merged, { merge: true });
      });

      // Sinkronkan baseline agar dirty-check menganggap tersimpan.
      setInitialIgRawInput(currentIgRawInput);
      setInitialFbRawInput(currentFbRawInput);
      setInitialTiktokRawInput(currentTiktokRawInput);

      clearDraft(date);
      toast.success(`Data rekap tanggal ${date} berhasil disimpan`);
      onClose();
    } catch (error: unknown) {
      console.error('Error saving engagement:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'permission-denied' || err.message?.includes('Missing or insufficient permissions')) {
        toast.error('Akses ditolak: Anda tidak memiliki izin untuk menyimpan data ini.');
      } else {
        toast.error(`Gagal menyimpan data: ${err.message || 'Kesalahan tidak diketahui'}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Ctrl+S dari shell dipetakan ke simpan rekap saat modal terbuka.
  useEffect(() => {
    if (!open) return;
    const onSaveShortcut = () => void handleSave();
    window.addEventListener('reso:save-rekap', onSaveShortcut);
    return () => window.removeEventListener('reso:save-rekap', onSaveShortcut);
  }, [open, handleSave]);

  return (
    <>
      <AnimatePresence>
        {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4"
          onClick={isSaving ? undefined : () => requestClose()}
          role="presentation"
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="input-rekap-title"
            aria-busy={isSaving}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ ease: "easeOut", duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] shadow-lg border border-slate-200"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 shrink-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 id="input-rekap-title" className="text-sm font-bold tracking-tight text-slate-900">Input Rekapitulasi</h3>
                  {existing?.autoFilledAt && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px] font-bold',
                        existing?.verifiedAt
                          ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                          : 'border-amber-200 text-amber-700 bg-amber-50'
                      )}
                    >
                      {existing?.verifiedAt ? 'Rekap otomatis · Terverifikasi' : 'Rekap otomatis · Perlu review'}
                    </Badge>
                  )}
                  {unmatchedCount > 0 && (
                    <button
                      type="button"
                      onClick={onOpenUnmatched}
                      aria-label={`${unmatchedCount} nama belum terpetakan — buka panel pemetaan`}
                      className="inline-flex rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                    >
                      <Badge variant="warning" className="text-[11px] font-bold cursor-pointer hover:bg-amber-100">
                        {unmatchedCount} belum terpetakan
                      </Badge>
                    </button>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                  {parseLocalISODate(date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  {postedAt.length > 0 && (
                    <span className="ml-2 text-slate-300">•</span>
                  )}
                  {postedAt.length > 0 && (
                    <span className="ml-2">Posting {postedAt.map((t) => t.slice(11)).join(' · ')}</span>
                  )}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => requestClose()} disabled={isSaving} aria-label="Tutup" className="h-8 w-8 shrink-0 rounded-lg hover:bg-slate-100 disabled:opacity-50">
                <X className="text-slate-500" size={16} />
              </Button>
            </div>

            {draftDiffers && storedDraft && (
              <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-2">
                <span className="text-[11px] font-semibold text-amber-800">Draf belum tersimpan ditemukan untuk tanggal ini.</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
                  onClick={() => {
                    setIgRawInput(storedDraft.ig);
                    setFbRawInput(storedDraft.fb);
                    setTiktokRawInput(storedDraft.tiktok);
                  }}
                >
                  Pulihkan draf
                </Button>
              </div>
            )}

            <div className="space-y-3 overflow-y-auto px-4 py-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div>
                  <label className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <Instagram size={11} className="text-pink-500" />
                    List IG
                  </label>
                  <textarea
                    value={igRawInput}
                    onChange={(e) => setIgRawInput(e.target.value)}
                    placeholder="Paste username / nama…"
                    className="h-24 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 md:h-32"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <Facebook size={11} className="text-blue-500" />
                    List FB
                  </label>
                  <textarea
                    value={fbRawInput}
                    onChange={(e) => setFbRawInput(e.target.value)}
                    placeholder="Paste nama / profil…"
                    className="h-24 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 md:h-32"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <TiktokIcon size={13} className="text-slate-800" />
                    List TikTok
                  </label>
                  <textarea
                    value={tiktokRawInput}
                    onChange={(e) => setTiktokRawInput(e.target.value)}
                    placeholder="Paste nama akun TikTok…"
                    className="h-24 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 md:h-32"
                  />
                </div>
              </div>

              {/* Live match preview */}
              <MatchPreview
                ig={matchPreview.ig}
                fb={matchPreview.fb}
                tiktok={matchPreview.tiktok}
              />
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button variant="ghost" onClick={() => requestClose()} disabled={isSaving} className="h-8 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
                Batal
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="h-8 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSaving ? 'Menyimpan…' : 'Simpan Rekap'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
      <ConfirmDialog
        open={closeConfirm}
        title="Buang perubahan yang belum disimpan?"
        description="Perubahan pada rekap ini belum disimpan. Menutup modal akan membuang perubahan tersebut."
        confirmLabel="Buang perubahan"
        cancelLabel="Kembali mengedit"
        onCancel={() => {
          pendingAfterCloseRef.current = null;
          setCloseConfirm(false);
        }}
        onConfirm={finishClose}
      />
    </>
  );
}