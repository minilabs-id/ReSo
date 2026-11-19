import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  RefreshCw,
  KeyRound,
  Download,
  Upload,
  Database,
  Trash2,
  Eye,
  EyeOff,
  Link as LinkIcon,
  ChevronRight,
  Sparkles,
  RotateCcw,
  Copy,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { toast } from 'sonner';
import { useAuth } from '../LocalProvider';
import { APP_VERSION } from '../../lib/version';
import { useAppLogo } from '../../hooks/useAppLogo';
import { getDoc, setDoc, serverTimestamp, dinasDoc } from '../../lib/local-db';
import {
  dbStats,
  exportAll,
  getSettings,
  updateSettings,
  resetSettings,
  type LocalDbStats,
  type ResoSettings,
  type LocalEmployee,
  type LocalDaily,
} from '../../lib/reso-bridge';

interface SettingsTabProps {
  recalculateConfig: { mode: 'last_day' | 'last_week' };
  setRecalculateConfig: (config: { mode: 'last_day' | 'last_week' }) => void;
  handleRecalculateAll: () => void;
  isLoading: boolean;
  containerVariants: import('motion/react').Variants;
  metaToken: string;
  setMetaToken: (v: string) => void;
  /** Kompatibel dengan pemanggil lama. Token kini ditulis lokal oleh komponen ini. */
  handleSaveMetaToken?: () => void | Promise<void>;
  handleClearMetaToken?: () => void | Promise<void>;
  isSavingToken: boolean;
  recalcResult: string | null;
  /** Opsional: membuka tab "Ambil Nama". Di-wire induk bila sudah tersedia. */
  onOpenScraper?: () => void;
}

/** Mirror default dari electron/store/settings-schema.ts (renderer tidak mengimpor kode main). */
const DEFAULT_SCRAPER_SETTINGS: ResoSettings = {
  tiktokTemplateUrl: '',
  instagramTemplateUrl: '',
  maxScrollRounds: 15,
  scrollDelayMs: 1200,
  captureTimeoutMs: 120_000,
  launchAtLogin: false,
  minimizeToTray: true,
  autoSendToReso: true,
};

/** Batas wajar untuk input numerik (sama dengan sanitasi di main process). */
const NUMERIC_LIMITS = {
  maxScrollRounds: { min: 0, max: 200, label: 'Putaran scroll' },
  scrollDelayMs: { min: 0, max: 10_000, label: 'Jeda scroll (ms)' },
  captureTimeoutMs: { min: 0, max: 900_000, label: 'Batas waktu (ms)' },
} as const;

export const SettingsTab: React.FC<SettingsTabProps> = ({
  recalculateConfig,
  setRecalculateConfig,
  handleRecalculateAll,
  isLoading,
  containerVariants,
  metaToken,
  setMetaToken,
  isSavingToken,
  recalcResult,
  onOpenScraper,
}) => {
  const { user, db, hasDatabase } = useAuth();
  const [showToken, setShowToken] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [savingTokenLocal, setSavingTokenLocal] = useState(false);
  const [clearTokenConfirm, setClearTokenConfirm] = useState(false);
  const [recalcConfirm, setRecalcConfirm] = useState(false);
  const appLogo = useAppLogo();

  const [stats, setStats] = useState<LocalDbStats | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    employees: LocalEmployee[];
    daily: LocalDaily[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [socialLinks, setSocialLinks] = useState({ ig: '', fb: '', tiktok: '' });
  const [isSavingSocial, setIsSavingSocial] = useState(false);
  const [showSocial, setShowSocial] = useState(false);

  const [scraperSettings, setScraperSettings] = useState<ResoSettings>(
    DEFAULT_SCRAPER_SETTINGS
  );
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [resetSettingsConfirm, setResetSettingsConfirm] = useState(false);

  // --- Statistik database lokal (dipakai di "Data lokal" & "Tentang") ---
  const refreshStats = async () => {
    try {
      setStats(await dbStats());
    } catch {
      setStats(null);
    }
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  // --- Status "Tersimpan" token: baca dari penyimpanan lokal ---
  const loadTokenSaved = async () => {
    if (!user || !db) return;
    try {
      const snap = await getDoc(dinasDoc(db, user.uid, 'settings', 'meta_api'));
      setTokenSaved(!!String(snap.data()?.value ?? '').trim());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadTokenSaved();
    // `metaToken` ikut dipantau agar chip tetap sinkron dengan state induk.
  }, [user, db, metaToken]);

  // --- Preferensi scraper ---
  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s) => {
      if (!cancelled && s) setScraperSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Sosial media ---
  useEffect(() => {
    if (!user || !db) return;
    let cancelled = false;
    const load = async () => {
      try {
        const docRef = dinasDoc(db, user.uid, 'settings', 'social_links');
        const snap = await getDoc(docRef);
        if (snap.exists() && !cancelled) {
          const data = snap.data() as { ig?: string; fb?: string; tiktok?: string };
          setSocialLinks({
            ig: data.ig || '',
            fb: data.fb || '',
            tiktok: data.tiktok || '',
          });
        }
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, db]);

  const handleSaveSocialLinks = async () => {
    if (!user || !db) return;
    setIsSavingSocial(true);
    try {
      await setDoc(dinasDoc(db, user.uid, 'settings', 'social_links'), {
        ...socialLinks,
        updatedAt: serverTimestamp(),
      });
      toast.success('Link sosial media disimpan secara lokal');
      setShowSocial(false);
    } catch {
      toast.error('Gagal menyimpan link');
    } finally {
      setIsSavingSocial(false);
    }
  };

  // --- Token Meta API ---
  const handleSaveToken = async () => {
    const trimmed = metaToken.trim();
    if (!trimmed || !user || !db) return;
    setSavingTokenLocal(true);
    try {
      await setDoc(dinasDoc(db, user.uid, 'settings', 'meta_api'), {
        value: trimmed,
        updatedAt: serverTimestamp(),
      });
      setMetaToken(trimmed);
      await loadTokenSaved();
      toast.success('Token tersimpan secara lokal');
    } catch {
      toast.error('Gagal menyimpan token secara lokal');
    } finally {
      setSavingTokenLocal(false);
    }
  };

  const handleConfirmClearToken = async () => {
    setClearTokenConfirm(false);
    if (!user || !db) return;
    setSavingTokenLocal(true);
    try {
      await setDoc(dinasDoc(db, user.uid, 'settings', 'meta_api'), {
        value: '',
        updatedAt: serverTimestamp(),
      });
      setMetaToken('');
      await loadTokenSaved();
      toast.success('Token dihapus dari penyimpanan lokal');
    } catch {
      toast.error('Gagal menghapus token');
    } finally {
      setSavingTokenLocal(false);
    }
  };

  // --- Cadangkan / pulihkan data lokal ---
  const handleExport = async () => {
    try {
      const payload = await exportAll();
      if (!payload) {
        toast.error('Ekspor gagal — database lokal tidak tersedia.');
        return;
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `reso-cadangan-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Cadangan data berhasil diunduh');
    } catch {
      toast.error('Gagal membuat cadangan data');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        employees?: unknown;
        daily?: unknown;
      };
      if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.daily)) {
        toast.error('Format tidak valid — berkas harus berisi "employees" dan "daily".');
        return;
      }
      setPendingImport({
        employees: parsed.employees as LocalEmployee[],
        daily: parsed.daily as LocalDaily[],
      });
      setImportConfirm(true);
    } catch {
      toast.error('Gagal membaca berkas JSON');
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    if (!window.reso) {
      toast.error('Database lokal tidak tersedia.');
      setImportConfirm(false);
      setPendingImport(null);
      return;
    }
    setImportBusy(true);
    try {
      const res = await window.reso.data.importAll(pendingImport);
      if (!res?.ok) {
        toast.error(`Gagal memulihkan data: ${res?.reason ?? 'kesalahan tidak diketahui'}`);
      } else {
        toast.success('Data berhasil dipulihkan');
        await refreshStats();
      }
    } catch {
      toast.error('Gagal memulihkan data');
    } finally {
      setImportBusy(false);
      setImportConfirm(false);
      setPendingImport(null);
    }
  };

  // --- Preferensi scraper ---
  const handleSaveScraperSettings = async () => {
    const invalid = (
      Object.keys(NUMERIC_LIMITS) as Array<keyof typeof NUMERIC_LIMITS>
    ).find((key) => {
      const { min, max } = NUMERIC_LIMITS[key];
      const value = scraperSettings[key];
      return !Number.isFinite(value) || value < min || value > max;
    });
    if (invalid) {
      const { min, max, label } = NUMERIC_LIMITS[invalid];
      toast.error(`${label} harus antara ${min}–${max}.`);
      return;
    }
    setSettingsBusy(true);
    try {
      const saved = await updateSettings(scraperSettings);
      if (!saved) {
        toast.error('Gagal menyimpan preferensi — database lokal tidak tersedia.');
        return;
      }
      setScraperSettings(saved);
      toast.success('Preferensi scraper tersimpan secara lokal');
    } catch {
      toast.error('Gagal menyimpan preferensi scraper');
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleResetSettings = async () => {
    setResetSettingsConfirm(false);
    setSettingsBusy(true);
    try {
      const fresh = await resetSettings();
      setScraperSettings(fresh ?? DEFAULT_SCRAPER_SETTINGS);
      toast.success(
        fresh
          ? 'Preferensi dikembalikan ke nilai default'
          : 'Preferensi di-reset (mode pratinjau)'
      );
    } catch {
      toast.error('Gagal mengembalikan preferensi');
    } finally {
      setSettingsBusy(false);
    }
  };

  // --- Tentang ---
  const electronVersion =
    typeof navigator !== 'undefined'
      ? navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? null
      : null;

  const handleCopyPath = async () => {
    if (!stats?.path) {
      toast.error('Path database tidak tersedia');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(stats.path);
      } else {
        const el = document.createElement('textarea');
        el.value = stats.path;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        el.remove();
      }
      toast.success('Path database disalin');
    } catch {
      toast.error('Gagal menyalin path database');
    }
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <div className="flex items-center gap-2 py-2">
      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
        {title}
      </span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );

  const SettingItem = ({
    icon,
    iconBg,
    title,
    desc,
    children,
  }: {
    icon: React.ReactNode;
    iconBg: string;
    title: string;
    desc: string;
    children: React.ReactNode;
  }) => (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <p className="text-xs text-slate-500 leading-tight">{desc}</p>
        </div>
      </div>
      <div className="w-full lg:w-auto lg:max-w-[360px] shrink-0 mt-2 lg:mt-0">{children}</div>
    </div>
  );

  const NumberField = ({
    label,
    field,
    title,
  }: {
    label: string;
    field: keyof typeof NUMERIC_LIMITS;
    title: string;
  }) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] font-semibold text-slate-600">{label}</span>
      <input
        type="number"
        min={NUMERIC_LIMITS[field].min}
        max={NUMERIC_LIMITS[field].max}
        value={scraperSettings[field]}
        onChange={(e) =>
          setScraperSettings((prev) => ({ ...prev, [field]: Number(e.target.value) }))
        }
        aria-label={label}
        title={title}
        className="h-8 w-full px-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
      />
    </label>
  );

  const BooleanField = ({
    label,
    field,
  }: {
    label: string;
    field: 'launchAtLogin' | 'minimizeToTray' | 'autoSendToReso';
  }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={scraperSettings[field]}
        onChange={(e) =>
          setScraperSettings((prev) => ({ ...prev, [field]: e.target.checked }))
        }
        aria-label={label}
        title={label}
        className="h-4 w-4 rounded border-slate-300 accent-slate-900"
      />
      <span className="text-[11px] font-medium text-slate-700">{label}</span>
    </label>
  );

  return (
    <motion.div
      key="settings"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-6 space-y-4">
          {/* Koneksi */}
          <div>
            <SectionHeader title="Koneksi" />
            <SettingItem
              icon={<Database size={16} />}
              iconBg={hasDatabase ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}
              title="Database lokal"
              desc="Penyimpanan data di perangkat ini"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={hasDatabase ? 'success' : 'destructive'}>
                  {hasDatabase ? 'Tersedia' : 'Tidak tersedia'}
                </Badge>
                {stats?.path && (
                  <span
                    className="text-xs text-slate-500 font-mono truncate max-w-[220px]"
                    title={stats.path}
                  >
                    {stats.path}
                  </span>
                )}
              </div>
            </SettingItem>
            <SettingItem
              icon={<KeyRound size={16} />}
              iconBg="bg-rose-50 text-rose-600"
              title="Token Meta API"
              desc="Disimpan secara lokal untuk tarik komentar & link post"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="Tempel token…"
                  type={showToken ? 'text' : 'password'}
                  autoComplete="off"
                  aria-label="Token Meta API"
                  className="flex-1 min-w-[140px] h-8 px-2 rounded-xl border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900 border-slate-200 bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                  title={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                {tokenSaved && (
                  <Badge variant="success" title="Token tersimpan secara lokal">
                    Tersimpan
                  </Badge>
                )}
                <Button
                  onClick={handleSaveToken}
                  disabled={savingTokenLocal || isSavingToken || !metaToken.trim()}
                  title={!metaToken.trim() ? 'Masukkan token terlebih dahulu' : 'Simpan token'}
                  size="sm"
                  className="rounded-xl bg-slate-900 text-white font-bold"
                >
                  {savingTokenLocal || isSavingToken ? '…' : 'Simpan'}
                </Button>
                {(tokenSaved || !!metaToken.trim()) && (
                  <Button
                    onClick={() => setClearTokenConfirm(true)}
                    variant="outline"
                    size="icon-sm"
                    aria-label="Hapus token"
                    title="Hapus token"
                    className="rounded-xl border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </SettingItem>
          </div>

          {/* Scraper bawaan (menggantikan bagian Ekstensi) */}
          <div>
            <SectionHeader title="Scraper" />
            <SettingItem
              icon={<Sparkles size={16} />}
              iconBg="bg-sky-50 text-sky-600"
              title="Scraper bawaan sudah terpasang"
              desc="Tidak perlu memasang ekstensi atau membuka tautan eksternal."
            >
              <Button
                onClick={() => onOpenScraper?.()}
                size="sm"
                variant="outline"
                title="Buka tab Ambil Nama"
                className="rounded-xl"
              >
                <Sparkles size={14} /> Buka Ambil Nama
              </Button>
            </SettingItem>
          </div>

          {/* Data lokal */}
          <div>
            <SectionHeader title="Data lokal" />
            <SettingItem
              icon={<Database size={16} />}
              iconBg="bg-indigo-50 text-indigo-600"
              title="Data lokal"
              desc={`${stats?.employees ?? 0} pegawai · ${stats?.days ?? 0} hari rekap tersimpan di perangkat ini.`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={handleExport}
                  size="sm"
                  variant="outline"
                  title="Unduh cadangan data (JSON)"
                  className="rounded-xl"
                >
                  <Download size={14} /> Cadangkan data
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  variant="outline"
                  title="Pulihkan data dari berkas cadangan"
                  className="rounded-xl"
                >
                  <Upload size={14} /> Pulihkan data
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFileChange}
                  aria-label="Pilih berkas cadangan JSON"
                  title="Pilih berkas cadangan JSON"
                  className="hidden"
                />
              </div>
              {stats?.path && (
                <p
                  className="text-[11px] text-slate-400 font-mono truncate"
                  title={stats.path}
                >
                  {stats.path}
                </p>
              )}
            </SettingItem>

            <SettingItem
              icon={<RefreshCw size={16} />}
              iconBg="bg-orange-50 text-orange-600"
              title="Kalkulasi Ulang"
              desc="Hitung ulang pencocokan rekap ke master pegawai."
            >
              <div className="flex flex-col gap-2 w-full">
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Menghitung ulang pencocokan untuk <b>1 hari terakhir</b> atau{' '}
                  <b>1 minggu terakhir</b>. Proses ini akan{' '}
                  <b className="text-rose-600">menimpa rekap</b> yang sudah ada pada rentang
                  tanggal tersebut.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div
                    className="flex bg-white border border-slate-200 rounded-xl p-0.5"
                    role="group"
                    aria-label="Rentang kalkulasi ulang"
                  >
                    {(['last_day', 'last_week'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setRecalculateConfig({ mode })}
                        aria-pressed={recalculateConfig.mode === mode}
                        title={mode === 'last_day' ? '1 hari terakhir' : '1 minggu terakhir'}
                        className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                          recalculateConfig.mode === mode
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {mode === 'last_day' ? '1 hari' : '1 minggu'}
                      </button>
                    ))}
                  </div>
                  <Button
                    onClick={() => {
                      if (!recalcConfirm) {
                        setRecalcConfirm(true);
                        setTimeout(() => setRecalcConfirm(false), 3000);
                        return;
                      }
                      setRecalcConfirm(false);
                      handleRecalculateAll();
                    }}
                    disabled={isLoading}
                    size="sm"
                    title="Timpa rekap dengan hasil kalkulasi ulang"
                    className={`rounded-xl font-bold ${
                      recalcConfirm ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-slate-900 text-white'
                    }`}
                  >
                    {isLoading
                      ? '…'
                      : recalcConfirm
                        ? 'Yakin timpa rekap?'
                        : 'Jalankan'}
                  </Button>
                </div>
                {recalcResult && (
                  <div
                    role="status"
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800 whitespace-pre-wrap break-words"
                  >
                    {recalcResult}
                  </div>
                )}
              </div>
            </SettingItem>
          </div>

          {/* Preferensi scraper */}
          <div>
            <SectionHeader title="Preferensi scraper" />
            <div className="py-3 border-b border-slate-100 space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 min-w-0">
                  <span className="text-[11px] font-semibold text-slate-600">
                    URL template TikTok
                  </span>
                  <input
                    type="url"
                    value={scraperSettings.tiktokTemplateUrl}
                    onChange={(e) =>
                      setScraperSettings((prev) => ({ ...prev, tiktokTemplateUrl: e.target.value }))
                    }
                    placeholder="https://www.tiktok.com/@..."
                    aria-label="URL template TikTok"
                    title="URL template TikTok"
                    className="h-8 w-full px-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </label>
                <label className="flex flex-col gap-1 min-w-0">
                  <span className="text-[11px] font-semibold text-slate-600">
                    URL template Instagram
                  </span>
                  <input
                    type="url"
                    value={scraperSettings.instagramTemplateUrl}
                    onChange={(e) =>
                      setScraperSettings((prev) => ({
                        ...prev,
                        instagramTemplateUrl: e.target.value,
                      }))
                    }
                    placeholder="https://www.instagram.com/p/..."
                    aria-label="URL template Instagram"
                    title="URL template Instagram"
                    className="h-8 w-full px-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <NumberField label="Putaran scroll maks." field="maxScrollRounds" title="1–200" />
                <NumberField label="Jeda scroll (ms)" field="scrollDelayMs" title="0–10000" />
                <NumberField label="Batas waktu (ms)" field="captureTimeoutMs" title="0–900000" />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <BooleanField label="Jalankan saat login" field="launchAtLogin" />
                <BooleanField label="Minimalkan ke tray" field="minimizeToTray" />
                <BooleanField label="Kirim otomatis ke ReSo" field="autoSendToReso" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={handleSaveScraperSettings}
                  disabled={settingsBusy}
                  size="sm"
                  title="Simpan preferensi scraper"
                  className="rounded-xl bg-slate-900 text-white font-bold"
                >
                  {settingsBusy ? 'Menyimpan…' : 'Simpan preferensi'}
                </Button>
                <Button
                  onClick={() => setResetSettingsConfirm(true)}
                  disabled={settingsBusy}
                  size="sm"
                  variant="outline"
                  title="Kembalikan semua preferensi ke nilai default"
                  className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  <RotateCcw size={14} /> Pulihkan default
                </Button>
              </div>
            </div>
          </div>

          {/* Sosial Media */}
          <div>
            <SectionHeader title="Sosial Media" />
            <SettingItem
              icon={<LinkIcon size={16} />}
              iconBg="bg-indigo-50 text-indigo-600"
              title="Sosial Media Instansi"
              desc="URL profil sosial media (opsional, disimpan lokal)"
            >
              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={() => setShowSocial(!showSocial)}
                  aria-expanded={showSocial}
                  title={showSocial ? 'Tutup link sosial media' : 'Edit link sosial media'}
                  className="flex items-center justify-between w-full h-8 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>
                    {socialLinks.ig || socialLinks.fb || socialLinks.tiktok
                      ? 'Edit Link'
                      : 'Tambah Link'}
                  </span>
                  <ChevronRight
                    size={14}
                    className={`transition-transform ${showSocial ? 'rotate-90' : ''}`}
                  />
                </button>
                {showSocial && (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 pt-1">
                      {(
                        [
                          ['ig', 'IG', 'https://instagram.com/...', 'Link Instagram'],
                          ['fb', 'FB', 'https://facebook.com/...', 'Link Facebook'],
                          ['tiktok', 'TT', 'https://tiktok.com/@...', 'Link TikTok'],
                        ] as const
                      ).map(([key, short, placeholder, aria]) => (
                        <div key={key} className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold text-slate-400 w-6 shrink-0">
                            {short}
                          </span>
                          <input
                            value={socialLinks[key] || ''}
                            onChange={(e) =>
                              setSocialLinks((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                            placeholder={placeholder}
                            aria-label={aria}
                            title={aria}
                            className="flex-1 min-w-0 h-8 px-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </div>
                      ))}
                    </div>
                    <Button
                      onClick={handleSaveSocialLinks}
                      disabled={isSavingSocial}
                      size="sm"
                      title="Simpan link sosial media"
                      className="w-full rounded-xl bg-slate-900 text-white font-bold"
                    >
                      {isSavingSocial ? 'Menyimpan…' : 'Simpan Link'}
                    </Button>
                  </>
                )}
              </div>
            </SettingItem>
          </div>

          {/* Tentang */}
          <div>
            <SectionHeader title="Tentang" />
            <div className="flex items-start gap-3 pt-1">
              <img src={appLogo} alt="Logo ReSo" className="w-9 h-9 object-contain shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="font-bold text-sm text-slate-900">ReSo</h3>
                <p className="text-xs text-slate-500">
                  Versi {APP_VERSION}
                  {electronVersion ? ` · Electron ${electronVersion}` : ''}
                </p>
                <p className="text-xs text-slate-500">
                  Skema database v{stats?.schemaVersion ?? '—'}
                </p>
                {stats?.path && (
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-xs text-slate-500 font-mono truncate"
                      title={stats.path}
                    >
                      {stats.path}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyPath}
                      aria-label="Salin path database"
                      title="Salin path database"
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Konfirmasi aksi */}
      <ConfirmDialog
        open={clearTokenConfirm}
        title="Hapus token Meta?"
        description="Token akan dihapus dari penyimpanan lokal di perangkat ini. Anda dapat memasukkannya lagi kapan saja."
        confirmLabel="Ya, hapus"
        onConfirm={handleConfirmClearToken}
        onCancel={() => setClearTokenConfirm(false)}
      />
      <ConfirmDialog
        open={importConfirm}
        title="Pulihkan data?"
        description="Seluruh data saat ini (pegawai & rekap) akan ditimpa oleh isi berkas cadangan. Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Ya, timpa data"
        busy={importBusy}
        onConfirm={handleConfirmImport}
        onCancel={() => {
          setImportConfirm(false);
          setPendingImport(null);
        }}
      />
      <ConfirmDialog
        open={resetSettingsConfirm}
        title="Pulihkan preferensi default?"
        description="Semua preferensi scraper akan dikembalikan ke nilai bawaan."
        confirmLabel="Ya, pulihkan"
        onConfirm={handleResetSettings}
        onCancel={() => setResetSettingsConfirm(false)}
      />
    </motion.div>
  );
};
