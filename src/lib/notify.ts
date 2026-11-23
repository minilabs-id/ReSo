/**
 * Notifikasi minimal: SATU pesan, tanpa animasi, tanpa tumpukan.
 * Dipasang sekali di App via <NotifyHost />. Tidak pernah mengubah layout
 * konten karena elemen memakai fixed positioning dan slot kosong tetap ada.
 */
import { useSyncExternalStore } from 'react'

export type NoticeTone = 'success' | 'info' | 'warning' | 'error'

export interface Notice {
  id: number
  text: string
  tone: NoticeTone
}

let current: Notice | null = null
let sequence = 0
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((listener) => listener())

function show(text: string, tone: NoticeTone): void {
  const id = ++sequence
  current = { id, text: String(text), tone }
  emit()
  window.setTimeout(() => {
    if (current?.id === id) {
      current = null
      emit()
    }
  }, 2600)
}

/** Drop-in pengganti `toast` dari sonner — API yang dipakai ReSo saja. */
export const toast = {
  success: (text: string) => show(text, 'success'),
  info: (text: string) => show(text, 'info'),
  warning: (text: string) => show(text, 'warning'),
  error: (text: string) => show(text, 'error'),
  message: (text: string) => show(text, 'info'),
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useNotice = (): Notice | null =>
  useSyncExternalStore(subscribe, () => current, () => null)
