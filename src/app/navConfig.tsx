import type { ReactNode } from 'react';
import {
  CalendarDays,
  Database,
  FileText,
  LayoutDashboard,
  Settings,
} from 'lucide-react';

/** Satu-satunya definisi navigasi utama — dipakai sidebar & tidak duplikat. */
export type MainTabId =
  | 'dashboard'
  | 'rekap'
  | 'laporan'
  | 'data'
  | 'pengaturan';

export interface NavItemDef {
  id: MainTabId;
  label: string;
  icon: ReactNode;
}

export const MAIN_NAV: NavItemDef[] = [
  { id: 'dashboard', label: 'Beranda', icon: <LayoutDashboard size={20} /> },
  { id: 'rekap', label: 'Rekap Harian', icon: <CalendarDays size={20} /> },
  { id: 'laporan', label: 'Laporan', icon: <FileText size={20} /> },
  { id: 'data', label: 'Data', icon: <Database size={20} /> },
  { id: 'pengaturan', label: 'Pengaturan', icon: <Settings size={20} /> },
];

export type ReportViewId = 'daily' | 'weekly' | 'monthly';
export const REPORT_SUBTABS: { id: ReportViewId; label: string }[] = [
  { id: 'daily', label: 'Harian' },
  { id: 'weekly', label: 'Mingguan' },
  { id: 'monthly', label: 'Bulanan' },
];

export type RekapViewId = 'kalender' | 'scraper';
export const REKAP_SUBTABS: { id: RekapViewId; label: string }[] = [
  { id: 'kalender', label: 'Kalender' },
  { id: 'scraper', label: 'Ambil Nama' },
];

export const isMainTab = (value: string): value is MainTabId =>
  MAIN_NAV.some((item) => item.id === value);
