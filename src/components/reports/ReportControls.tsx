import React from 'react';
import { motion } from 'motion/react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { itemVariants } from './report-variants';

export interface SortOption {
  value: string;
  label: string;
}

interface ReportControlsProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  currentBadge?: string | null;
  onPrev: () => void;
  onNext: () => void;
  sortOptions: SortOption[];
  activeSort: string;
  onSortChange: (value: string) => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
  onExportImage: () => void;
  canExportImage?: boolean;
  /** Nonaktifkan tombol periode berikutnya (mis. periode mendatang belum ada). */
  canGoNext?: boolean;
  employeeCount?: number;
  isLoading?: boolean;
}

const EXPORT_LIMIT_NOTE = 'Export gambar dibatasi maks 60 pegawai — gunakan PDF/Excel.';

export function ReportControls({
  title,
  subtitle,
  currentBadge,
  onPrev,
  onNext,
  sortOptions,
  activeSort,
  onSortChange,
  onExportPdf,
  onExportExcel,
  onExportImage,
  canExportImage = true,
  canGoNext = true,
  employeeCount,
  isLoading = false,
}: ReportControlsProps) {
  const noData = (employeeCount ?? 0) === 0;
  const imageLimitNote = employeeCount !== undefined
    ? `Gambar maks 60 pegawai (saat ini ${employeeCount})`
    : EXPORT_LIMIT_NOTE;

  return (
    <motion.div
      variants={itemVariants}
      className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm"
    >
      {/* Navigasi periode — satu blok, tidak bertumpuk dengan kontrol lain */}
      <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrev}
          aria-label="Sebelumnya"
          className="rounded-lg text-slate-600 hover:bg-white shrink-0"
        >
          <ChevronLeft size={16} />
        </Button>
        <div className="text-center px-2 min-w-[200px]">
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            {currentBadge && (
              <Badge
                variant="outline"
                className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px] px-1.5 py-0 font-semibold"
              >
                {currentBadge}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!canGoNext}
          title={!canGoNext ? 'Periode mendatang belum tersedia' : undefined}
          aria-label="Berikutnya"
          className="rounded-lg text-slate-600 hover:bg-white shrink-0 disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Urutkan + ekspor — satu baris yang sama dengan navigasi */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Urutkan:
          </span>
          <div
            role="group"
            aria-label="Urutkan laporan"
            className="flex bg-slate-100 p-1.5 rounded-xl"
          >
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSortChange(opt.value)}
                aria-pressed={activeSort === opt.value}
                className={cn(
                  'px-3 py-2 text-xs font-semibold rounded-lg transition-colors',
                  activeSort === opt.value
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={onExportPdf}
            disabled={isLoading || noData}
            title={noData ? 'Belum ada data untuk diekspor' : undefined}
            className="gap-2 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
          >
            <FileText size={14} />
            PDF
          </Button>
          <Button
            onClick={onExportExcel}
            disabled={isLoading || noData}
            title={noData ? 'Belum ada data untuk diekspor' : undefined}
            variant="outline"
            className="gap-2 px-4 border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs"
          >
            <FileSpreadsheet size={14} className="text-emerald-600" />
            Excel
          </Button>
          <Button
            onClick={onExportImage}
            disabled={isLoading || !canExportImage || noData}
            title={noData ? 'Belum ada data untuk diekspor' : !canExportImage ? imageLimitNote : undefined}
            variant="outline"
            className="gap-2 px-4 border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs disabled:opacity-50"
          >
            <ImageIcon size={14} />
            Gambar
          </Button>
        </div>

        {!canExportImage && (
          <p className="text-[11px] text-slate-500 font-medium max-w-[180px]">{imageLimitNote}</p>
        )}
        {isLoading && (
          <p role="status" aria-live="polite" className="text-[11px] font-semibold text-slate-600">
            Menyiapkan ekspor…
          </p>
        )}
      </div>
    </motion.div>
  );
}
