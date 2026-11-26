/**
 * Logo ReSo sebagai data URL SVG statis.
 *
 * Kenapa data URL: aplikasi desktop memuat renderer dari `file://`, sehingga
 * path absolut `/logo.svg` di-resolve ke akar drive (`file:///D:/logo.svg`)
 * dan gambar rusak. Data URL bekerja di web, di Electron, dan juga saat logo
 * di-fetch untuk header PDF.
 */
import logoSvg from '../assets/logo.svg?raw';

const LOGO_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg)}`;

export function useAppLogo(): string {
  return LOGO_DATA_URL;
}
