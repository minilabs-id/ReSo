import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { ConfirmDialog } from '../ui/confirm-dialog';
import {
  isElectron,
  getScrapeStates,
  onScrapeStateChanged,
  applyScrapeEvent,
  clearScrapeNames,
  openScrapeBrowser,
  closeScrapeBrowser,
  setScrapeBrowserBounds,
  navigateScrapeBrowser,
  type NameState,
} from '../../lib/reso-bridge';
import { filterNames, sortNamesAz, namesToClipboardText } from '../../shared/normalize';
import { newRunId } from '../../shared/state';
import { wordFor, fbTargetLabel, igTargetLabel } from '../../shared/messages';
import type { Platform } from '../../shared/types';

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

const DEFAULT_URL: Record<Platform, string> = {
  facebook: 'https://www.facebook.com/',
  tiktok: 'https://www.tiktok.com/',
  instagram: 'https://www.instagram.com/',
};

/** Id banner fallback web — jadi penjelasan aria untuk tombol yang dinonaktifkan. */
const WEB_HELP_ID = 'scraper-web-fallback';

/** Tombol yang mati karena bukan Electron diberi petunjuk yang bisa dibaca screen reader. */
const webDisabledProps = !isElectron
  ? {
      title: 'Hanya tersedia di ReSo Desktop. Lihat pemberitahuan web di atas.',
      'aria-describedby': WEB_HELP_ID,
    }
  : {};

type CalloutTone = 'rose' | 'amber' | 'green' | 'slate';

const CALLOUT_TONE: Record<CalloutTone, string> = {
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

const DOT_TONE: Record<CalloutTone, string> = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  slate: 'bg-slate-400',
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
  const [copiedKind, setCopiedKind] = useState<'filter' | 'all' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** null = ikuti nilai state main; entri = pilihan operator per platform. */
  const [repliesOverride, setRepliesOverride] = useState<Partial<Record<Platform, boolean>>>({});

  // Browser internal: posisi WebContentsView mengikuti kotak ini.
  const browserRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef('');
  const [browserUrl, setBrowserUrl] = useState<string>(DEFAULT_URL.tiktok);
  const [browserError, setBrowserError] = useState('');

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

  /** Pasang browser view terlihat pada kotak yang diberikan, ikuti ukuran/scroll. */
  useEffect(() => {
    if (!isElectron) return;
    let raf = 0;
    const bounds = () => {
      const el = browserRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    void (async () => {
      const b = bounds();
      if (!b) return;
      await openScrapeBrowser(platform, b);
      lastBoundsRef.current = '';
      await navigateScrapeBrowser(platform, DEFAULT_URL[platform]);
      setBrowserUrl(DEFAULT_URL[platform]);
      setBrowserError('');
    })();

    const sync = () => {
      const b = bounds();
      if (!b) return;
      const key = `${b.x}|${b.y}|${b.width}|${b.height}`;
      if (key === lastBoundsRef.current) return;
      lastBoundsRef.current = key;
      void setScrapeBrowserBounds(b);
    };
    const loop = () => {
      sync();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
      void closeScrapeBrowser();
    };
  }, [platform]);

  const openUrl = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const ok = await navigateScrapeBrowser(platform, url);
    if (ok) {
      setBrowserUrl(url);
      setBrowserError('');
    } else {
      setBrowserError('URL tidak valid — gunakan alamat http/https.');
    }
  }, [platform]);

  const state = states[platform];
  const includeReplies = repliesOverride[platform] ?? state.includeReplies;
  const visible = useMemo(() => {
    const base = filterNames(state.names, query);
    return az ? sortNamesAz(base) : base;
  }, [state.names, query, az]);

  const filterActive = query.trim() !== '' || az;

  /** Warna callout mengikuti keparahan pesan, bukan sekadar status. */
  const tone = useMemo<CalloutTone>(() => {
    const reason = state.stopReason ?? '';
    const msg = state.message.toLowerCase();
    if (state.status === 'error' || reason === 'error') return 'rose';
    if (
      reason === 'checkpoint' ||
      reason === 'rate_limit' ||
      reason === 'blocked' ||
      /429|checkpoint|blokir|verifikasi/.test(msg)
    ) {
      return 'amber';
    }
    if (state.status === 'done') return 'green';
    return 'slate';
  }, [state.status, state.stopReason, state.message]);

  /** Label target memakai helper agar token internal engine tidak tampil mentah. */
  const targetLabel = useMemo(() => {
    if (platform === 'facebook') return fbTargetLabel(state.postHint);
    if (platform === 'instagram') return igTargetLabel(state.postHint);
    // TikTok belum punya helper khusus — pakai filter token generik yang sama.
    return fbTargetLabel(state.videoHint);
  }, [platform, state.postHint, state.videoHint]);

  const start = useCallback(async () => {
    if (!isElectron) return;
    await applyScrapeEvent(platform, {
      type: 'START',
      runId: newRunId(),
      includeReplies,
    });
  }, [platform, includeReplies]);

  const stop = useCallback(async () => {
    if (!isElectron) return;
    await applyScrapeEvent(platform, { type: 'STOP' });
  }, [platform]);

  const clear = useCallback(async () => {
    if (!isElectron) return;
    setClearing(true);
    try {
      await clearScrapeNames(platform);
    } finally {
      setClearing(false);
    }
  }, [platform]);

  const flashCopied = useCallback((kind: 'filter' | 'all') => {
    setCopiedKind(kind);
    setTimeout(() => setCopiedKind(null), 1500);
  }, []);

  const copyVisible = useCallback(async () => {
    const text = namesToClipboardText(visible, platform);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied('filter');
    } catch {
      setCopiedKind(null);
    }
  }, [visible, platform, flashCopied]);

  const copyAll = useCallback(async () => {
    const text = namesToClipboardText(state.names, platform);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied('all');
    } catch {
      setCopiedKind(null);
    }
  }, [state.names, platform, flashCopied]);

  const running = state.status === 'running';

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Ambil Nama Komentar</h1>
        <p className="text-[11px] text-slate-500 mt-1">
          Mode native (Electron). Ambil nama komentator langsung dari browser bawaan aplikasi.
        </p>
      </div>

      {!isElectron && (
        <Card id={WEB_HELP_ID} className="p-4 border-amber-200 bg-amber-50">
          <p className="text-[11px] text-amber-800 font-medium leading-relaxed">
            Fitur ini hanya aktif di aplikasi <strong>ReSo Desktop</strong>. Versi web tetap bisa
            memakai input rekap manual.
          </p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Pilih platform">
        {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
          <Button
            key={p}
            variant={p === platform ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPlatform(p)}
          >
            {PLATFORM_LABEL[p]}
            {states[p].count > 0 && (
              <span className="ml-2 text-[11px] font-bold opacity-70">{states[p].count}</span>
            )}
          </Button>
        ))}
      </div>

      {/* Browser internal: buka postingan di sini, lalu klik tombol "Scrap" di halaman. */}
      <Card className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={browserUrl}
            onChange={(e) => setBrowserUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void openUrl(browserUrl);
            }}
            placeholder="https://... buka postingan FB/IG/TikTok"
            aria-label="Alamat postingan"
            className="h-9 flex-1 min-w-[220px] text-[11px]"
            disabled={!isElectron}
          />
          <Button size="sm" onClick={() => void openUrl(browserUrl)} disabled={!isElectron}>
            Buka
          </Button>
          {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              onClick={() => void openUrl(DEFAULT_URL[p])}
              disabled={!isElectron}
              title={`Buka beranda ${PLATFORM_LABEL[p]}`}
            >
              {p === 'facebook' ? 'FB' : p === 'instagram' ? 'IG' : 'TT'}
            </Button>
          ))}
        </div>
        {browserError && <p className="text-[11px] font-medium text-rose-600">{browserError}</p>}
        <div
          ref={browserRef}
          className="h-[520px] w-full rounded-xl border border-slate-200 bg-slate-50 overflow-hidden"
          aria-label={`Browser ${PLATFORM_LABEL[platform]}`}
        >
          {!isElectron && (
            <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-slate-500">
              Browser internal hanya tersedia di ReSo Desktop.
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          Buka satu postingan/video → buka daftar komentar → klik tombol <b>Scrap</b> di kanan atas
          halaman. Nama akan masuk ke daftar di bawah otomatis.
        </p>
      </Card>

      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void start()} disabled={!isElectron || running} {...webDisabledProps}>
            {running ? 'Berjalan…' : 'Proses halaman ini'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void stop()}
            disabled={!isElectron || !running}
            {...webDisabledProps}
          >
            Hentikan
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmClear(true)}
            disabled={!isElectron || state.count === 0}
            {...webDisabledProps}
          >
            Bersihkan
          </Button>
          <Button
            variant="ghost"
            onClick={() => void copyVisible()}
            disabled={visible.length === 0}
            title="Salin daftar hasil yang sedang terlihat (terfilter)"
          >
            {copiedKind === 'filter' ? 'Tersalin' : `Salin hasil filter (${visible.length})`}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copyAll()}
            disabled={state.count === 0}
            title="Salin seluruh nama tanpa filter"
          >
            {copiedKind === 'all' ? 'Tersalin' : 'Salin semua'}
          </Button>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-slate-600 font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeReplies}
            onChange={(e) =>
              setRepliesOverride((prev) => ({ ...prev, [platform]: e.target.checked }))
            }
            className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-900"
          />
          Sertakan balasan
        </label>

        <div
          role="status"
          aria-live="polite"
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${CALLOUT_TONE[tone]}`}
        >
          <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${DOT_TONE[tone]}`} aria-hidden />
          {running ? (
            <span className="flex items-center gap-2 font-medium">
              <Loader2 size={13} className="animate-spin" aria-hidden />
              Mengumpulkan… {state.count} {wordFor(platform)}
            </span>
          ) : (
            <span className="line-clamp-3 font-medium">{state.message}</span>
          )}
        </div>

        {targetLabel && (
          <p className="text-[11px] text-slate-400 break-words">Target: {targetLabel}</p>
        )}
      </Card>

      <Card className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Hasil — {state.count} {wordFor(platform)}
            </h2>
            {filterActive && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                Menampilkan {visible.length} dari {state.count} {wordFor(platform)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama…"
              className="h-8 w-40 text-[11px]"
              aria-label="Cari nama"
            />
            <Button
              variant={az ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAz((v) => !v)}
              aria-pressed={az}
            >
              A–Z
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-[11px] text-slate-400 py-6 text-center">
            {state.count === 0 ? 'Belum ada hasil.' : 'Tidak ada yang cocok dengan pencarian.'}
          </p>
        ) : (
          <ol className="divide-y divide-slate-100 max-h-80 overflow-y-auto rounded-lg border border-slate-100">
            {visible.map((name, i) => (
              <li key={`${name}-${i}`} className="px-3 py-2 text-[11px] text-slate-700 flex gap-3">
                <span className="text-slate-300 tabular-nums w-8 shrink-0 text-right">{i + 1}</span>
                <span className="break-words">{name}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <ConfirmDialog
        open={confirmClear}
        title="Bersihkan hasil?"
        description={
          <>
            Semua {state.count} {wordFor(platform)} untuk {PLATFORM_LABEL[platform]} akan dihapus
            dari penyimpanan lokal. Tindakan ini tidak bisa dibatalkan.
          </>
        }
        confirmLabel="Ya, bersihkan"
        cancelLabel="Batal"
        busy={clearing}
        onConfirm={async () => {
          await clear();
          setConfirmClear(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
