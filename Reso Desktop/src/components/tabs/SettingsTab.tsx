import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Download, Upload, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { toast } from '../../lib/notify';
import { containerVariants } from '../../shared/motion';
import {
  exportAll,
  getSettings,
  updateSettings,
  resetSettings,
  type ResoSettings,
  type LocalEmployee,
  type LocalDaily,
} from '../../lib/reso-bridge';

type ScraperSettingsForm = Pick<
  ResoSettings,
  'tiktokTemplateUrl' | 'maxScrollRounds' | 'scrollDelayMs' | 'captureTimeoutMs'
>;

/** Mirror default dari settings-schema.ts (renderer tidak mengimpor kode main). */
const DEFAULT_SCRAPER_SETTINGS: ScraperSettingsForm = {
  tiktokTemplateUrl: '',
  maxScrollRounds: 15,
  scrollDelayMs: 1200,
  captureTimeoutMs: 120_000,
};

const NUMERIC_LIMITS = {
  maxScrollRounds: { min: 1, max: 200, label: 'Putaran scroll' },
  scrollDelayMs: { min: 200, max: 10_000, label: 'Jeda scroll (ms)' },
  captureTimeoutMs: { min: 5_000, max: 900_000, label: 'Batas waktu (ms)' },
} as const;

const SectionHeader = ({ title }: { title: string }) => (
  <div className="flex items-center gap-2 py-2">
    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</span>
    <div className="flex-1 h-px bg-slate-200" />
  </div>
);

const NumberField = ({
  label,
  field,
  title,
  value,
  onChange,
}: {
  label: string;
  field: keyof typeof NUMERIC_LIMITS;
  title: string;
  value: number;
  onChange: (field: keyof typeof NUMERIC_LIMITS, value: number) => void;
}) => (
  <label className="flex flex-col gap-1 min-w-0">
    <span className="text-[11px] font-semibold text-slate-600">{label}</span>
    <input
      type="number"
      min={NUMERIC_LIMITS[field].min}
      max={NUMERIC_LIMITS[field].max}
      value={value}
      onChange={(e) => onChange(field, Number(e.target.value))}
      aria-label={label}
      title={title}
      className="h-9 w-full px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
    />
  </label>
);

export const SettingsTab: React.FC = () => {
  const [scraperSettings, setScraperSettings] = useState<ScraperSettingsForm>(DEFAULT_SCRAPER_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<ScraperSettingsForm>(DEFAULT_SCRAPER_SETTINGS);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [importConfirm, setImportConfirm] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    employees: LocalEmployee[];
    daily: LocalDaily[];
    settings?: Record<string, unknown>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDirty = JSON.stringify(scraperSettings) !== JSON.stringify(savedSettings);

  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s) => {
      if (!cancelled && s) {
        setScraperSettings(s);
        setSavedSettings(s);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = async () => {
    try {
      const payload = await exportAll();
      if (!payload) {
        toast.error('Ekspor gagal — database lokal tidak tersedia.');
        return;
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
        settings?: unknown;
      };
      if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.daily)) {
        toast.error('Format tidak valid — berkas harus berisi "employees" dan "daily".');
        return;
      }
      setPendingImport({
        employees: parsed.employees as LocalEmployee[],
        daily: parsed.daily as LocalDaily[],
        settings: parsed.settings && typeof parsed.settings === 'object'
          ? (parsed.settings as Record<string, unknown>)
          : undefined,
      });
      setImportConfirm(true);
    } catch {
      toast.error('Gagal membaca berkas JSON');
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport || !window.reso) {
      toast.error('Database lokal tidak tersedia.');
      setImportConfirm(false);
      setPendingImport(null);
      return;
    }
    setImportBusy(true);
    try {
      const res = await window.reso.data.importAll(pendingImport);
      if (!res?.ok) toast.error(`Gagal memulihkan data: ${res?.reason ?? 'kesalahan tidak diketahui'}`);
      else toast.success('Data berhasil dipulihkan');
    } catch {
      toast.error('Gagal memulihkan data');
    } finally {
      setImportBusy(false);
      setImportConfirm(false);
      setPendingImport(null);
    }
  };

  const handleSave = async () => {
    const invalid = (Object.keys(NUMERIC_LIMITS) as Array<keyof typeof NUMERIC_LIMITS>).find((key) => {
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
      setSavedSettings(saved);
      toast.success('Preferensi tersimpan secara lokal');
    } catch {
      toast.error('Gagal menyimpan preferensi');
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleReset = async () => {
    setResetConfirm(false);
    setSettingsBusy(true);
    try {
      const fresh = await resetSettings();
      const next = fresh ?? DEFAULT_SCRAPER_SETTINGS;
      setScraperSettings(next);
      setSavedSettings(next);
      toast.success('Preferensi dikembalikan ke nilai default');
    } catch {
      toast.error('Gagal mengembalikan preferensi');
    } finally {
      setSettingsBusy(false);
    }
  };

  return (
    <motion.div
      key="settings"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Pengaturan</h1>
        <p className="text-xs text-slate-500 mt-0.5">Preferensi aplikasi & cadangan data lokal</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-1 max-w-3xl">
        <SectionHeader title="Data" />
        <div className="flex items-center justify-between gap-4 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Cadangkan & pulihkan</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cadangan JSON berisi pegawai, rekap harian, dan preferensi
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={handleExport} size="sm" variant="outline" className="rounded-xl">
              <Download size={14} /> Cadangkan
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline" className="rounded-xl">
              <Upload size={14} /> Pulihkan
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              aria-label="Pilih berkas cadangan JSON"
              className="sr-only"
            />
          </div>
        </div>

        <SectionHeader title="Preferensi scraper" />
        <div className="py-4 space-y-4">
          <label className="flex flex-col gap-1 max-w-md">
            <span className="text-[11px] font-semibold text-slate-600">Template TikTok (opsional)</span>
            <input
              type="url"
              value={scraperSettings.tiktokTemplateUrl}
              onChange={(e) => setScraperSettings((prev) => ({ ...prev, tiktokTemplateUrl: e.target.value }))}
              placeholder="https://www.tiktok.com/api/comment/list/…"
              aria-label="Template TikTok"
              title="Fallback lanjutan bila panel komentar tidak terbuka"
              className="h-9 w-full px-3 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            <span className="text-[11px] text-slate-500">
              Hanya untuk kasus lanjutan. Alur normal memakai halaman yang dibuka di browser internal.
            </span>
          </label>

          <div className="grid grid-cols-3 gap-3 max-w-2xl">
            <NumberField
              label="Putaran scroll maks."
              field="maxScrollRounds"
              title="1–200"
              value={scraperSettings.maxScrollRounds}
              onChange={(field, value) => setScraperSettings((prev) => ({ ...prev, [field]: value }))}
            />
            <NumberField
              label="Jeda scroll (ms)"
              field="scrollDelayMs"
              title="200–10000"
              value={scraperSettings.scrollDelayMs}
              onChange={(field, value) => setScraperSettings((prev) => ({ ...prev, [field]: value }))}
            />
            <NumberField
              label="Batas waktu (ms)"
              field="captureTimeoutMs"
              title="5000–900000"
              value={scraperSettings.captureTimeoutMs}
              onChange={(field, value) => setScraperSettings((prev) => ({ ...prev, [field]: value }))}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={handleSave}
              disabled={settingsBusy || !isDirty}
              size="sm"
              className="rounded-xl bg-slate-900 text-white font-bold"
            >
              {settingsBusy ? 'Menyimpan…' : 'Simpan preferensi'}
            </Button>
            <Button
              onClick={() => setResetConfirm(true)}
              disabled={settingsBusy}
              size="sm"
              variant="outline"
              className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              <RotateCcw size={14} /> Pulihkan default
            </Button>
            {isDirty && (
              <span className="text-[11px] font-semibold text-amber-700">Ada perubahan belum disimpan</span>
            )}
          </div>
        </div>
      </div>

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
        open={resetConfirm}
        title="Pulihkan preferensi default?"
        description="Preferensi scraper akan dikembalikan ke nilai bawaan."
        confirmLabel="Ya, pulihkan"
        onConfirm={handleReset}
        onCancel={() => setResetConfirm(false)}
      />
    </motion.div>
  );
};
