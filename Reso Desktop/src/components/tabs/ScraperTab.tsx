import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Loader2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import {
  isElectron,
  getScrapeStates,
  onScrapeStateChanged,
  applyScrapeEvent,
  openScrapeBrowser,
  closeScrapeBrowser,
  setScrapeBrowserBounds,
  navigateScrapeBrowser,
  browserBack,
  browserForward,
  browserReload,
  getBrowserNavState,
  getScrapeBrowserUrl,
  getSettings,
  updateSettings,
  onBrowserNavigated,
  onBrowserLoading,
  onScrapeHandoff,
  type NameState,
  type ResoSettings,
  type ScrapeHandoffPayload,
} from '../../lib/reso-bridge';
import { toast } from '../../lib/notify';
import { newRunId } from '../../shared/state';
import { isAllowedScrapeUrl, plausibleScrapeTarget } from '../../shared/platform';
import { wordFor, fbTargetLabel, igTargetLabel } from '../../shared/messages';
import type { Platform } from '../../shared/types';
import { PLATFORM_LABEL_FULL } from '../shared/platformLabels';

const DEFAULT_URL: Record<Platform, string> = {
  facebook: 'https://www.facebook.com/',
  tiktok: 'https://www.tiktok.com/',
  instagram: 'https://www.instagram.com/',
};

/** Kunci preferensi halaman awal per platform (profil/postingan operator). */
const HOME_KEY: Record<Platform, keyof ResoSettings> = {
  facebook: 'homeUrlFacebook',
  instagram: 'homeUrlInstagram',
  tiktok: 'homeUrlTiktok',
};

/** Platform terakhir dipertahankan saat panel di-unmount (pindah menu). */
let lastSelectedPlatform: Platform = 'tiktok';

interface ScraperPanelProps {
  onOpenCalendar?: () => void;
}

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
export default function ScraperPanel({ onOpenCalendar }: ScraperPanelProps) {
  const [platform, setPlatform] = useState<Platform>(lastSelectedPlatform);
  const [lastHandoff, setLastHandoff] = useState<ScrapeHandoffPayload | null>(null);
  const [states, setStates] = useState<Record<Platform, NameState>>({
    facebook: EMPTY_STATE,
    tiktok: EMPTY_STATE,
    instagram: EMPTY_STATE,
  });
  /** Naik setiap ada broadcast — dipakai menolak hasil `getAll` yang basi. */
  const generationRef = useRef(0);

  // Browser internal: posisi WebContentsView mengikuti kotak ini.
  const browserRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef('');
  const openedRef = useRef(false);
  const [browserUrl, setBrowserUrl] = useState<string>(DEFAULT_URL.tiktok);
  const [browserError, setBrowserError] = useState('');
  const [browserLoading, setBrowserLoading] = useState(false);
  const [navState, setNavState] = useState({ canBack: false, canForward: false });

  useEffect(() => {
    if (!isElectron) return;
    let cancelled = false;

    // Siaran dipasang DULUAN. Setiap broadcast menaikkan generation; sebuah
    // `getAll` yang dikirim sebelum broadcast tetapi selesai sesudahnya harus
    // dibuang — kalau tidak, state bisa mundur (done → running, count turun).
    const off = onScrapeStateChanged(({ platform: p, state }) => {
      if (cancelled) return;
      generationRef.current += 1;
      setStates((prev) => ({ ...prev, [p as Platform]: state }));
    });

    const fetchAll = () => {
      const generation = generationRef.current;
      void getScrapeStates().then((all) => {
        if (cancelled || !all || generation !== generationRef.current) return;
        setStates((prev) => ({ ...prev, ...(all as Record<Platform, NameState>) }));
      });
    };
    fetchAll();
    // Jaring pengaman bila siaran tidak sampai saat panel di-remount.
    const poll = setInterval(fetchAll, 4000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      off();
    };
  }, []);

  // Ringkasan handoff ditampilkan di panel — toast global cepat hilang.
  useEffect(() => onScrapeHandoff(setLastHandoff), []);

  /** Pasang browser view terlihat pada kotak yang diberikan, ikuti ukuran/scroll. */
  useEffect(() => {
    if (!isElectron) return;
    lastSelectedPlatform = platform;
    let raf = 0;
    let cancelled = false;
    const bounds = () => {
      const el = browserRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    openedRef.current = false;
    const ensureOpen = async (): Promise<boolean> => {
      const b = bounds();
      if (!b || b.width < 120 || b.height < 120) return false;
      const ok = await openScrapeBrowser(platform, b);
      if (ok) {
        openedRef.current = true;
        lastBoundsRef.current = '';
      }
      return ok;
    };
    void (async () => {
      let opened = await ensureOpen();
      if (!opened && !cancelled) {
        await new Promise((r) => requestAnimationFrame(r));
        opened = await ensureOpen();
      }
      if (!opened || cancelled) {
        if (!cancelled) setBrowserError('Browser internal gagal dibuka — coba ganti platform.');
        return;
      }
      // Pulihkan halaman yang sedang terbuka di host. Bila host belum punya
      // halaman, pakai halaman awal yang disimpan operator (profil/postingan
      // sendiri), baru jatuh ke homepage platform.
      const current = await getScrapeBrowserUrl(platform);
      const shouldKeep = isAllowedScrapeUrl(current, platform);
      let target = shouldKeep ? current : DEFAULT_URL[platform];
      if (!shouldKeep) {
        const settings = await getSettings();
        const preferred = settings?.[HOME_KEY[platform]] as string | undefined;
        if (typeof preferred === 'string' && isAllowedScrapeUrl(preferred, platform)) {
          target = preferred;
        }
        await navigateScrapeBrowser(platform, target);
      }
      if (cancelled) return;
      setBrowserUrl(target);
      setBrowserError('');
      setNavState(await getBrowserNavState(platform));
    })();

    const offNav = onBrowserNavigated(({ platform: p, url }) => {
      if (p !== platform) return;
      setBrowserUrl(url);
      void getBrowserNavState(platform).then(setNavState);
    });
    const offLoading = onBrowserLoading(({ platform: p, loading }) => {
      if (p === platform) setBrowserLoading(loading);
    });

    const sync = () => {
      const b = bounds();
      if (!b) return;
      const key = `${b.x}|${b.y}|${b.width}|${b.height}`;
      if (key === lastBoundsRef.current) return;
      lastBoundsRef.current = key;
      void setScrapeBrowserBounds(b);
    };
    // Throttle 250 ms — siaran navigasi sudah langsung; ini hanya pengaman.
    let lastSync = 0;
    const loop = (t: number) => {
      if (t - lastSync > 250) {
        lastSync = t;
        sync();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Layout bisa berubah setelah module lazy selesai — buka ulang bila view
    // belum pernah berhasil dipasang.
    const ro = new ResizeObserver(() => {
      if (!openedRef.current) void ensureOpen();
    });
    if (browserRef.current) ro.observe(browserRef.current);
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);

    return () => {
      cancelled = true;
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
      offNav();
      offLoading();
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

  /** Simpan halaman yang sedang terbuka sebagai halaman awal platform ini. */
  const saveHome = useCallback(async () => {
    if (!isElectron || !isAllowedScrapeUrl(browserUrl, platform)) return;
    const saved = await updateSettings({ [HOME_KEY[platform]]: browserUrl } as Partial<ResoSettings>);
    if (saved) toast.success(`Halaman awal ${PLATFORM_LABEL_FULL[platform]} disimpan`);
  }, [browserUrl, platform]);

  const state = states[platform];
  // Satu sumber kebenaran: state main. Checkbox mengirim SET_OPTIONS ke main,
  // sehingga tombol Scrap di halaman memakai opsi yang sama dengan UI.
  const includeReplies = state.includeReplies;
  const running = state.status === 'running';
  /** State dari sesi sebelumnya tidak boleh tampil seolah hasil baru. */
  const isStale =
    state.updatedAt > 0 &&
    new Date(state.updatedAt).toDateString() !== new Date().toDateString();
  const shownMessage = browserError || (isStale ? 'Siap.' : state.message);

  /** Warna callout mengikuti keparahan pesan, bukan sekadar status. */
  const tone = useMemo<CalloutTone>(() => {
    const reason = state.stopReason ?? '';
    const msg = shownMessage.toLowerCase();
    if (browserError || state.status === 'error' || reason === 'error') return 'rose';
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
  }, [state.status, state.stopReason, shownMessage, browserError]);

  /** Label target memakai helper agar token internal engine tidak tampil mentah. */
  const targetLabel = useMemo(() => {
    if (isStale) return '';
    if (platform === 'facebook') return fbTargetLabel(state.postHint);
    if (platform === 'instagram') return igTargetLabel(state.postHint);
    return fbTargetLabel(state.videoHint);
  }, [platform, state.postHint, state.videoHint, isStale]);

  /** Preflight: tombol menyala hanya bila halaman memang bisa dipanen. */
  const canScrape = plausibleScrapeTarget(browserUrl, platform);

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

  return (
    <div className="p-4 lg:p-5 space-y-3 max-w-[1400px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Ambil Nama Komentar</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ambil nama komentator langsung dari browser bawaan aplikasi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pilih platform">
        {(Object.keys(PLATFORM_LABEL_FULL) as Platform[]).map((p) => (
          <Button
            key={p}
            variant={p === platform ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPlatform(p)}
            aria-pressed={p === platform}
          >
            {PLATFORM_LABEL_FULL[p]}
          </Button>
        ))}
        </div>
      </div>

      <Card className="p-4 space-y-2">
        {/* Toolbar: navigasi browser + alamat. Pintasan platform dihapus —
            pemilih platform di atas sudah satu-satunya tempat berganti platform. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => void browserBack(platform)}
            disabled={!navState.canBack}
            aria-label="Kembali"
            title="Kembali"
          >
            ←
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => void browserForward(platform)}
            disabled={!navState.canForward}
            aria-label="Maju"
            title="Maju"
          >
            →
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => void browserReload(platform)}
            aria-label="Muat ulang"
            title="Muat ulang"
          >
            ⟳
          </Button>
          <Input
            value={browserUrl}
            onChange={(e) => setBrowserUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void openUrl(browserUrl);
            }}
            placeholder="https://... buka postingan FB/IG/TikTok"
            aria-label="Alamat postingan"
            className="h-9 flex-1 min-w-[220px] text-[11px]"
          />
          <Button size="sm" onClick={() => void openUrl(browserUrl)}>
            Buka
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => void saveHome()}
            disabled={!isAllowedScrapeUrl(browserUrl, platform)}
            aria-label="Jadikan halaman awal"
            title="Jadikan halaman ini sebagai halaman awal saat membuka platform"
          >
            <Bookmark size={14} />
          </Button>
        </div>
        {/* Satu baris aksi, diletakkan SEBELUM browser agar selalu terlihat
            tanpa scroll. Slot Hentikan tetap ada walau tidak aktif — checkbox
            di kanan tidak ikut bergeser saat run mulai. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <Button
            onClick={() => void start()}
            disabled={running || !canScrape}
            title={canScrape ? undefined : `Buka postingan ${PLATFORM_LABEL_FULL[platform]} dulu di browser bawah.`}
          >
            {running ? 'Berjalan…' : 'Ambil dari halaman ini'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void stop()}
            disabled={!running}
            aria-hidden={!running}
            className={running ? '' : 'invisible'}
          >
            Hentikan
          </Button>
          <label className="ml-auto flex items-center gap-2 text-[11px] text-slate-600 font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeReplies}
              onChange={(e) =>
                void applyScrapeEvent(platform, {
                  type: 'SET_OPTIONS',
                  includeReplies: e.target.checked,
                })
              }
              className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-900"
            />
            Sertakan balasan
          </label>
        </div>

        {/* Satu blok status dengan tinggi tetap: target & ringkasan handoff
            memakai slot kosong, jadi browser di bawahnya tidak pernah bergeser. */}
        <div
          role="status"
          aria-live="polite"
          className={`min-h-[68px] rounded-xl border px-3 py-1.5 text-[11px] leading-snug ${CALLOUT_TONE[tone]}`}
        >
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${DOT_TONE[tone]}`} aria-hidden />
            {running ? (
              <span className="flex items-center gap-2 font-medium">
                <Loader2 size={13} className="animate-spin" aria-hidden />
                Mengumpulkan… {state.count} {wordFor(platform)}
              </span>
            ) : (
              <span className="font-medium break-words">{shownMessage}</span>
            )}
          </div>
          <div className="mt-0.5 min-h-[14px] break-words pl-4 text-slate-500">
            {targetLabel ? `Target: ${targetLabel}` : ''}
          </div>
          <div className="mt-0.5 flex min-h-[22px] items-center pl-4">
            {lastHandoff && (
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-emerald-800">
                  Masuk rekap {lastHandoff.date} · {lastHandoff.matched} terpetakan · {lastHandoff.unmatched} belum
                </span>
                <button
                  type="button"
                  onClick={() => onOpenCalendar?.()}
                  className="shrink-0 font-bold text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
                >
                  Lihat rekap
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Browser besar di kiri, daftar hasil di kanan — semua terlihat tanpa scroll. */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3 items-start">
          <div className="min-w-0 space-y-2">
            <div
              ref={browserRef}
              className="relative h-[clamp(520px,calc(100dvh-330px),900px)] w-full rounded-xl border border-slate-200 bg-slate-50 overflow-hidden"
              role="region"
              aria-label={`Browser ${PLATFORM_LABEL_FULL[platform]}`}
            >
              {browserLoading && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60">
                  <Loader2 size={22} className="animate-spin text-slate-500" aria-hidden />
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Buka postingan/video → buka daftar komentar → klik <b>Scrap</b> di kanan atas halaman.
              Tombol <b>Ambil dari halaman ini</b> hanya cadangan.
            </p>
          </div>

          <Card className="flex h-full min-h-[300px] flex-col p-4 xl:h-[clamp(520px,calc(100dvh-330px),900px)]">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <h2 className="text-sm font-bold text-slate-900">
                Terakhir diambil
                {isStale && <span className="ml-1 text-[11px] font-semibold text-slate-500">(sesi lalu)</span>}
              </h2>
              <Badge variant="outline" className="shrink-0 text-[11px] font-bold">
                {state.count} {wordFor(platform)}
              </Badge>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {state.count === 0 ? (
                <p className="py-8 text-center text-[11px] text-slate-500">Belum ada hasil.</p>
              ) : (
                <ol className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {state.names.map((name, i) => (
                    <li key={`${name}-${i}`} className="flex gap-3 px-3 py-2 text-[11px] text-slate-700">
                      <span className="w-8 shrink-0 text-right tabular-nums text-slate-300">{i + 1}</span>
                      <span className="break-words">{name}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );
}
