import { RefreshCw, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ModalHost } from '../../components/ui/ModalHost';
import { PLATFORM_LABEL_SHORT } from '../../components/shared/platformLabels';
import { parseLocalISODate } from '../../lib/date';
import type { Employee, UnmatchedName } from '../../types';

interface UnmatchedReviewProps {
  open: boolean;
  onClose: () => void;
  date: string;
  unmatched: UnmatchedName[];
  employees: Employee[];
  mapSelections: Record<string, string>;
  onMapSelectionsChange: (next: Record<string, string>) => void;
  isMapping: boolean;
  onMap: () => void;
  onRematch: () => void;
}

/** Antrean review nama belum terpetakan — satu tempat untuk pemetaan alias. */
export function UnmatchedReview({
  open,
  onClose,
  date,
  unmatched,
  employees,
  mapSelections,
  onMapSelectionsChange,
  isMapping,
  onMap,
  onRematch,
}: UnmatchedReviewProps) {
  return (
    <ModalHost open={open} onClose={onClose} labelledBy="unmatched-review-title">
      <div className="p-5 sm:p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/20 shrink-0">
        <div>
          <h3 id="unmatched-review-title" className="text-base sm:text-lg font-black text-slate-900 leading-tight">
            Petakan nama belum terpetakan
          </h3>
          <p className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
            {parseLocalISODate(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}{unmatched.length} nama tanpa pegawai
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Tutup panel pemetaan"
          title="Tutup panel pemetaan"
          className="rounded-full bg-slate-100 hover:bg-slate-200 h-9 w-9"
        >
          <X className="text-slate-600" size={18} />
        </Button>
      </div>

      <div className="p-4 sm:p-6 space-y-3 overflow-y-auto">
        <p className="text-xs text-slate-500">
          Pilih pegawai untuk tiap nama — nama tersimpan sebagai <b>alias</b> pegawai, jadi kiriman berikutnya otomatis cocok.
        </p>
        {unmatched.length === 0 ? (
          <div className="text-center py-10 text-sm font-semibold text-emerald-600">
            Semua nama sudah terpetakan 🎉
          </div>
        ) : (
          unmatched.map((u) => {
            const key = `${u.platform}|${u.name}`;
            return (
              <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[11px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-900 text-white shrink-0">
                    {PLATFORM_LABEL_SHORT[u.platform]}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 truncate">{u.name}</span>
                </div>
                <select
                  className="w-full sm:w-56 h-9 rounded-lg border border-slate-300 text-sm px-2 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                  value={mapSelections[key] || ''}
                  onChange={(e) => onMapSelectionsChange({ ...mapSelections, [key]: e.target.value })}
                >
                  <option value="">— Pilih pegawai —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            );
          })
        )}
      </div>

      <div className="p-4 sm:p-6 border-t border-slate-100 flex flex-col sm:flex-row gap-2 justify-end shrink-0">
        <Button variant="ghost" onClick={onRematch} disabled={isMapping} className="text-xs font-bold">
          <RefreshCw size={14} className="mr-1.5" />
          Match ulang
        </Button>
        <Button
          onClick={onMap}
          disabled={isMapping || unmatched.length === 0 || !Object.values(mapSelections).some(Boolean)}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl h-10 px-5 border-none"
        >
          {isMapping ? 'Menyimpan…' : 'Petakan & simpan'}
        </Button>
      </div>
    </ModalHost>
  );
}
