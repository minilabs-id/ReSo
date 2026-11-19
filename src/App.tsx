/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import EngagementDashboard from './components/EngagementDashboard';
import { useAuth } from './components/LocalProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppLogo } from './hooks/useAppLogo';
import { Toaster } from './components/ui/sonner';
import { Button } from './components/ui/button';
import { APP_VERSION } from './lib/version';

function LoadingScreen() {
  const logoUrl = useAppLogo();

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-slate-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-white p-8 rounded-xl border border-slate-200 flex flex-col items-center w-full max-w-sm shadow-sm"
      >
        <img src={logoUrl} alt="ReSo" className="w-16 h-16 object-contain mb-6" />
        <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-1">
          Re<span className="text-slate-900">So</span>
        </h2>
        <p className="text-xs font-medium text-slate-500 mb-6">Rekap Engagement Sosmed</p>
        <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
        <p className="mt-4 text-[11px] font-medium text-slate-400">Memuat…</p>
      </motion.div>
    </div>
  );
}

/**
 * Layar galat konfigurasi — HANYA muncul bila aplikasi dijalankan tanpa
 * database lokal (mis. dibuka sebagai web biasa). Offline (#10) berarti tidak
 * ada login: tidak ada layar masuk, tidak ada tombol "coba lagi" ke server.
 */
function DatabaseUnavailableScreen({ message }: { message: string }) {
  const logoUrl = useAppLogo();
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-xl border border-slate-200 flex flex-col items-center w-full max-w-md shadow-sm text-center">
        <img src={logoUrl} alt="ReSo" className="w-16 h-16 object-contain mb-6" />
        <h2 className="text-lg font-bold text-slate-900 mb-2">Database lokal tidak tersedia</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
        <p className="mt-3 text-[11px] font-semibold text-slate-400">ReSo v{APP_VERSION} · desktop</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Coba lagi
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.close()}>
            Tutup aplikasi
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading, error, hasDatabase } = useAuth();
  const [showLoading, setShowLoading] = useState(true);

  useEffect(() => {
    if (loading) {
      setShowLoading(true);
      return;
    }
    // Jeda singkat agar transisi keluar layar loading tidak berkedip.
    const timer = setTimeout(() => setShowLoading(false), 200);
    return () => clearTimeout(timer);
  }, [loading]);

  if (showLoading || loading) {
    return (
      <>
        <Toaster position="top-center" duration={2500} offset={16} />
        <LoadingScreen />
      </>
    );
  }

  // Tanpa database lokal tidak ada yang bisa dikerjakan — tampilkan sebabnya,
  // bukan layar login (login sudah tidak ada di aplikasi offline).
  if (!hasDatabase || !user) {
    return (
      <>
        <Toaster position="top-center" duration={2500} offset={16} />
        <DatabaseUnavailableScreen
          message={error ?? 'Jalankan aplikasi ReSo versi desktop (Electron) untuk membuka data.'}
        />
      </>
    );
  }

  return (
    <>
      <Toaster position="top-center" duration={2500} offset={16} />
      <div className="font-sans antialiased text-slate-900 min-h-[100dvh] bg-slate-50 selection:bg-slate-900/10">
        <ErrorBoundary>
          <EngagementDashboard />
        </ErrorBoundary>
      </div>
    </>
  );
}
