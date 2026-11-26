import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { cn } from '@/lib/utils';

interface ModalHostProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
}

/**
 * Satu-satunya jalur untuk dialog & sheet aplikasi.
 * Menyatukan portal, focus trap (`useDialogA11y`), Escape, scroll lock milik
 * hook pemanggil, dan tangga z-index — menggantikan empat implementasi modal.
 */
export function ModalHost({
  open,
  onClose,
  labelledBy,
  children,
  className,
}: ModalHostProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    // Capture phase: dialog teratas lebih dulu mendengar Escape.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ ease: 'easeOut', duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-white w-full max-w-xl rounded-t-2xl sm:rounded-xl overflow-hidden flex flex-col max-h-[88vh] sm:max-h-[82vh] shadow-2xl border border-slate-200',
              className
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
