import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type EngagementStatusValue = 'selesai' | 'perlu-review' | 'terverifikasi';

const STATUS_STYLE: Record<EngagementStatusValue, string> = {
  selesai: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'perlu-review': 'border-amber-200 bg-amber-50 text-amber-700',
  terverifikasi: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const STATUS_LABEL: Record<EngagementStatusValue, string> = {
  selesai: 'Selesai',
  'perlu-review': 'Perlu review',
  terverifikasi: 'Terverifikasi',
};

/** Badge status rekap dengan warna konsisten dan ikon centang untuk terverifikasi. */
export function EngagementStatus({
  status,
  className,
}: {
  status: EngagementStatusValue;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
        STATUS_STYLE[status],
        className
      )}
    >
      {status === 'terverifikasi' && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </span>
  );
}
