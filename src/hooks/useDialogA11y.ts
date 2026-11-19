import { useEffect, useRef } from 'react';

/**
 * Aksesibilitas dialog (pola ARIA modal): saat dialog dibuka fokus dipindah
 * ke dalamnya, Tab/Shift+Tab dipagarkan di dalam dialog, dan saat ditutup
 * fokus dikembalikan ke elemen pemicu.
 *
 * Dialog bertingkat didukung lewat stack modul: hanya dialog paling atas yang
 * memasang focus-trap. Dialog di bawahnya diberi `aria-hidden` sementara agar
 * pembaca layar tidak membaca dua dialog sekaligus.
 *
 * Pasangkan dengan role="dialog" + aria-modal="true" + aria-labelledby pada
 * elemen kontainer, dan berikan tabIndex={-1} agar kontainer bisa menerima
 * fokus awal.
 */
const stack: HTMLElement[] = [];

export function useDialogA11y<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;

    const isTop = () => stack[stack.length - 1] === dialog;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Sembunyikan dialog di bawahnya dari pembaca layar selama dialog ini
    // terbuka, lalu kembalikan nilainya saat ditutup.
    const hidden: Array<{ el: HTMLElement; value: string | null }> = [];
    for (const lower of stack) {
      if (lower === dialog) continue;
      hidden.push({ el: lower, value: lower.getAttribute('aria-hidden') });
      lower.setAttribute('aria-hidden', 'true');
    }

    stack.push(dialog);
    if (isTop()) dialog.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialog || !isTop()) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
          ].join(', ')
        )
      );
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === dialog)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase supaya trap berjalan sebelum handler lain.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const wasTop = isTop();
      const idx = stack.indexOf(dialog);
      if (idx >= 0) stack.splice(idx, 1);
      for (const item of hidden) {
        if (item.value === null) item.el.removeAttribute('aria-hidden');
        else item.el.setAttribute('aria-hidden', item.value);
      }
      if (wasTop && previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return ref;
}
