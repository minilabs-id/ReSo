import { cn } from '@/lib/utils';
import { PLATFORM_LABEL_SHORT } from './platformLabels';

type ShortPlatform = 'ig' | 'fb' | 'tiktok';

const DOT_COLOR: Record<ShortPlatform, string> = {
  ig: 'bg-pink-500',
  fb: 'bg-blue-500',
  tiktok: 'bg-slate-700',
};

/** Badge platform kecil: titik warna konsisten + label pendek. */
export function PlatformBadge({
  platform,
  showIcon = true,
  className,
}: {
  platform: ShortPlatform;
  showIcon?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700',
        className
      )}
    >
      {showIcon && (
        <span
          className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT_COLOR[platform])}
          aria-hidden="true"
        />
      )}
      <span>{PLATFORM_LABEL_SHORT[platform]}</span>
    </span>
  );
}
