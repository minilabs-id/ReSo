/**
 * LocalProvider — pengganti FirebaseProvider untuk aplikasi offline (#10).
 *
 * KENAPA bentuk `useAuth()` dipertahankan: 4 komponen besar memakai
 * `const { user, db, loading } = useAuth()`. Dengan mempertahankan nama hook &
 * bentuk nilai yang sama, perubahannya cukup baris import — tidak ada logika
 * UI yang perlu ditulis ulang atau berisiko regresi.
 *
 * `user` di sini BUKAN akun: offline tidak ada login. Nilai `user` adalah
 * identitas operator mesin ini (konstan), supaya kode lama yang memeriksa
 * `if (!user) return` tetap berjalan dan tidak pernah "menunggu login".
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { hasLocalDb } from '../lib/local-db'

/** Identitas tetap operator — tidak ada autentikasi di aplikasi offline. */
export const LOCAL_OPERATOR = {
  uid: 'local',
  email: null as string | null,
  displayName: 'Operator',
  emailVerified: true,
} as const

/**
 * Penanda "database" pengganti Firestore instance.
 *
 * Kenapa objek truthy dan bukan `null`: kode lama (SettingsTab, dll.) memakai
 * guard `if (!user || !db) return`. Dengan `null`, guard itu akan SELALU
 * return dan fitur diam-diam mati. Shim `local-db` mengabaikan argumen ini,
 * jadi nilai apa pun yang truthy aman.
 */
export const LOCAL_DB = { kind: 'local-db' } as const

interface LocalAuthContextType {
  /** Selalu terisi setelah `loading` selesai — tidak ada keadaan "belum login". */
  user: typeof LOCAL_OPERATOR | null
  /** Penanda database lokal (dulu Firestore instance) — selalu truthy. */
  db: typeof LOCAL_DB
  loading: boolean
  error: string | null
  /** Apakah database lokal tersedia (Electron). False = build web/pratinjau. */
  hasDatabase: boolean
}

const LocalContext = createContext<LocalAuthContextType>({
  user: null,
  db: LOCAL_DB,
  loading: true,
  error: null,
  hasDatabase: false,
})

export const LocalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasDatabase = useMemo(() => hasLocalDb(), [])

  useEffect(() => {
    // Tidak ada jaringan yang perlu ditunggu: cukup satu tick agar transisi
    // layar loading tidak berkedip saat mount.
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      setLoading(false)
      if (!hasDatabase) {
        // Jelas & jujur: tanpa Electron tidak ada tempat menyimpan data.
        setError(
          'Database lokal tidak tersedia. Jalankan aplikasi ReSo versi desktop (Electron).'
        )
      }
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [hasDatabase])

  const value = useMemo<LocalAuthContextType>(
    () => ({
      user: loading ? null : LOCAL_OPERATOR,
      db: LOCAL_DB,
      loading,
      error,
      hasDatabase,
    }),
    [loading, error, hasDatabase]
  )

  return <LocalContext.Provider value={value}>{children}</LocalContext.Provider>
}

/** Nama sama seperti versi Firebase supaya komponen tidak perlu diubah. */
export const useAuth = () => useContext(LocalContext)
