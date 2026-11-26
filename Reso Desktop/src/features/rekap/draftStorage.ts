import { useEffect } from 'react';

const PREFIX = 'reso:draft:';

export interface RekapDraft {
  ig: string;
  fb: string;
  tiktok: string;
}

const draftKey = (date: string) => `${PREFIX}${date}`;

export function loadDraft(date: string): RekapDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RekapDraft;
    if (
      typeof parsed.ig !== 'string' ||
      typeof parsed.fb !== 'string' ||
      typeof parsed.tiktok !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(date: string, draft: RekapDraft): void {
  try {
    localStorage.setItem(draftKey(date), JSON.stringify(draft));
  } catch {
    // Penyimpanan penuh / diblokir — draft bersifat best-effort, bukan sumber data.
  }
}

export function clearDraft(date: string): void {
  try {
    localStorage.removeItem(draftKey(date));
  } catch {
    // Abaikan.
  }
}

/** Simpan draf secara otomatis (debounced) saat pengguna mengetik. */
export function useDraftAutosave(date: string, draft: RekapDraft, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => saveDraft(date, draft), 400);
    return () => window.clearTimeout(timer);
  }, [date, draft.ig, draft.fb, draft.tiktok, enabled]);
}
