import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import {
  isElectron,
  getScrapeStates,
  onScrapeStateChanged,
  applyScrapeEvent,
  clearScrapeNames,
  type NameState,
} from '../../lib/reso-bridge';
import { filterNames, sortNamesAz, namesToClipboardText } from '../../shared/normalize';
import { newRunId } from '../../shared/state';
import { wordFor } from '../../shared/messages';
import type { Platform } from '../../shared/types';

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

const EMPTY_STATE: NameState = {
  status: 'idle',
  names: [],
  count: 0,
  message: 'Siap.',
  updatedAt: 0,
  stopReason: null,
  includeReplies: false,
  hasTemplate: false,
  runId: null,
  postHint: '',
  videoHint: '',
};

/**
 * Panel scraper native. Di web (tanpa Electron) panel menampilkan penjelasan
 * bahwa scraping hanya tersedia di aplikasi desktop — tidak ada tombol palsu.
 *
 * State pemilik adalah MAIN PROCESS; komponen ini hanya mengirim event &
 * merender state yang disiarkan (`scrape.stateChanged`).
 */
export default function ScraperPanel() {
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [states, setStates] = useState<Record<Platform, NameState>>({
    facebook: EMPTY_STATE,
    tiktok: EMPTY_STATE,
    instagram: EMPTY_STATE,
  });
  const [query, setQuery] = useState('');
  const [az, setAz] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    let cancelled = false;
    void getScrapeStates().then((all) => {
      if (cancelled || !all) return;
      setStates((prev) => ({ ...prev, ...(all as Record<Platform, NameState>) }));
    });
    const off = onScrapeStateChanged(({ platform: p, state }) => {
      if (cancelled) return;
      setStates((prev) => ({ ...prev, [p as Platform]: state }));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const state = states[platform];
  const visible = useMemo(() => {
    const base = filterNames(state.names, query);
    return az ? sortNamesAz(base) : base;
  }, [state.names, query, az]);

  const start = useCallback(async () => {
    if (!isElectron) return;
    await applyScrapeEvent(platform, {
      type: 'START',
      runId: newRunId(),
      includeReplies: state.includeReplies,
    });
  }, [platform, state.includeReplies]);

  const stop = useCallback(async () => {
    if (!isElectron) return;
    await applyScrapeEvent(platform, { type: 'STOP' });
  }, [platform]);

  const clear = useCallback(async () => {
    if (!isElectron) return;
    await clearScrapeNames(platform);
  }, [platform]);

  const copy = useCallback(async () => {
    const text = namesToClipboardText(state.names, platform);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [state.names, platform]);

  const running = state.status === 'running';

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Ambil Nama Komentar</h1>
        <p className="text-xs text-slate-500 mt-1">
          Mode native (Electron). Ambil nama komentator langsung dari browser bawaan aplikasi.
        </p>
      </div>

      {!isElectron && (
        <Card className="p-4 border-amber-200 bg-amber-50">
          <p className="text-xs text-amber-800 font-medium leading-relaxed">
            Fitur ini hanya aktif di aplikasi <strong>ReSo Desktop</strong>. Versi web tetap bisa
            memakai input rekap manual.
          </p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
          <Button
            key={p}
            variant={p === platform ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPlatform(p)}
          >
            {PLATFORM_LABEL[p]}
            {states[p].count > 0 && (
              <span className="ml-2 text-[10px] font-bold opacity-70">{states[p].count}</span>
            )}
          </Button>
        ))}
      </div>

      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void start()} disabled={!isElectron || running}>
            {running ? 'Berjalan…' : 'Proses'}
          </Button>
          <Button variant="outline" onClick={() => void stop()} disabled={!isElectron || !running}>
            Hentikan
          </Button>
          <Button variant="ghost" onClick={() => void clear()} disabled={!isElectron || state.count === 0}>
            Bersihkan
          </Button>
          <Button variant="ghost" onClick={() => void copy()} disabled={state.count === 0}>
            {copied ? 'Tersalin' : 'Salin'}
          </Button>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
          <span
            className={
              'inline-block w-2 h-2 rounded-full ' +
              (running
                ? 'bg-emerald-500'
                : state.status === 'error'
                  ? 'bg-rose-500'
                  : state.status === 'done' || state.status === 'stopped'
                    ? 'bg-slate-400'
                    : 'bg-slate-300')
            }
          />
          <span className="truncate">{state.message}</span>
        </div>

        {(state.postHint || state.videoHint) && (
          <p className="text-[11px] text-slate-400 truncate">
            Target: {platform === 'tiktok' ? state.videoHint : state.postHint}
          </p>
        )}
      </Card>

      <Card className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            Hasil — {state.count} {wordFor(platform)}
          </h2>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama…"
              className="h-8 w-40 text-xs"
            />
            <Button variant={az ? 'default' : 'outline'} size="sm" onClick={() => setAz((v) => !v)}>
              A–Z
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">
            {state.count === 0 ? 'Belum ada hasil.' : 'Tidak ada yang cocok dengan pencarian.'}
          </p>
        ) : (
          <ol className="divide-y divide-slate-100 max-h-80 overflow-y-auto rounded-lg border border-slate-100">
            {visible.map((name, i) => (
              <li key={`${name}-${i}`} className="px-3 py-2 text-xs text-slate-700 flex gap-3">
                <span className="text-slate-300 tabular-nums w-8 shrink-0 text-right">{i + 1}</span>
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
