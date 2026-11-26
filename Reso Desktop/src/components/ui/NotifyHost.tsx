import { useNotice, type NoticeTone } from '../../lib/notify';

const TONE: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-slate-200 bg-white text-slate-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
};

/**
 * Baris notifikasi statis di pojok kanan bawah. Satu pesan, tanpa animasi,
 * tanpa tombol, dan tidak pernah mendorong/menggeser kontrol aplikasi.
 */
export function NotifyHost() {
  const notice = useNotice();
  return (
    <div
      className="fixed bottom-4 right-4 z-[200] pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={`max-w-[360px] rounded-lg border px-3 py-2 text-[11px] font-semibold leading-snug shadow-sm ${
          notice ? TONE[notice.tone] : 'invisible'
        }`}
      >
        {notice?.text ?? 'placeholder'}
      </div>
    </div>
  );
}
