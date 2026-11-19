import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';
import { useDialogA11y } from '../../hooks/useDialogA11y';

/**
 * Konfirmasi aksi berbahaya/hangus kecil yang konsisten di seluruh aplikasi.
 * Dipakai untuk hapus token, verifikasi massal, bersihkan hasil scraper, dan
 * menutup modal input yang belum disimpan.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Ya, lanjutkan',
  cancelLabel = 'Batal',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useDialogA11y<HTMLDivElement>(open);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        aria-busy={busy}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-lg outline-none"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <AlertTriangle size={18} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-sm font-bold text-slate-900">
              {title}
            </h3>
            {description && (
              <div className="mt-1.5 text-xs leading-relaxed text-slate-600">{description}</div>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'default'}
            size="sm"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? 'Memproses…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
