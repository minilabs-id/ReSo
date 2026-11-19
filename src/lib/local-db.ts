/**
 * Shim kompatibel-subset Firestore di atas database lokal (SQLite via IPC).
 *
 * KENAPA shim, bukan tulis ulang: komponen UI (EngagementDashboard,
 * EmployeeManager, InputModal, SettingsTab ≈ 3.900 baris) memakai API Firestore
 * di ~160 titik. Menulis ulang semuanya sekaligus berisiko besar & tanpa nilai
 * tambah — perilakunya sudah teruji di lapangan. Shim ini menyediakan bentuk
 * API yang SAMA (`collection/doc/query/where/orderBy/onSnapshot/getDoc/...`)
 * sehingga satu-satunya perubahan di komponen adalah baris import.
 *
 * BATASAN (disengaja, bukan bug):
 * - `where` hanya mendukung operator `==` dan `>=`/`<=`/`>`/`<` pada field
 *   top-level, digabung AND — itu saja yang dipakai aplikasi.
 * - Dokumen selalu { id, ...fields } pada `d.data()`; tidak ada subcollection
 *   bertingkat (struktur `dinas/{uid}/{name}` lama diabaikan, uid tidak dipakai).
 * - Query dijalankan ulang di memori tiap kali; ukuran data rekap (ribuan baris)
 *   jauh di bawah ambang yang perlu index.
 * - `onSnapshot` = langganan berbasis event lokal + siaran dari main process,
 *   bukan realtime lintas perangkat (memang tidak ada server di #10).
 */

// ===================== Tipe minimal pengganti tipe Firestore =====================

/** Nama koleksi yang dikenal aplikasi (pengganti path Firestore). */
export type CollectionName = 'employees' | 'dailyEngagement' | 'settings'

export interface QueryConstraint {
  kind: 'where' | 'orderBy' | 'limit'
  field?: string
  op?: '==' | '>=' | '<=' | '>' | '<'
  value?: unknown
  direction?: 'asc' | 'desc'
  count?: number
}

/** Sentinel timestamp — SQLite menyimpan ISO string, jadi cukup teks. */
export const serverTimestamp = (): string => new Date().toISOString()

export const arrayUnion = (...values: unknown[]): { __arrayUnion: unknown[] } => ({
  __arrayUnion: values,
})

type Fields = Record<string, unknown>

export interface QueryDocumentSnapshot {
  id: string
  data: () => Fields
  exists: () => true
}

export interface QuerySnapshot {
  docs: QueryDocumentSnapshot[]
  size: number
  empty: boolean
  forEach: (cb: (d: QueryDocumentSnapshot) => void) => void
}

export interface DocumentSnapshot {
  id: string
  exists: () => boolean
  data: () => Fields | undefined
}

export interface CollectionReference {
  kind: 'collection'
  name: CollectionName
}

export interface DocumentReference {
  kind: 'doc'
  name: CollectionName
  id: string
}

export interface Query {
  kind: 'query'
  name: CollectionName
  constraints: QueryConstraint[]
}

/** Nilai `db` tidak lagi bermakna (dulu Firestore instance) — dipakai apa adanya. */
export const localDb = (): null => null
export type Firestore = null

// ===================== Akses database (IPC) =====================

interface DataRow {
  id: string
  [key: string]: unknown
}

function bridge() {
  return typeof window !== 'undefined' ? window.reso?.data : undefined
}

/** Semua baris satu koleksi. Array kosong bila bukan Electron. */
async function loadRows(name: CollectionName): Promise<DataRow[]> {
  const b = bridge()
  if (!b) return []
  try {
    if (name === 'employees') {
      return ((await b.listEmployees()) ?? []) as unknown as DataRow[]
    }
    if (name === 'settings') {
      // settings/{id} → tabel key-value; nilai JSON disebar jadi field.
      const keys = (await b.listSettings?.()) ?? []
      const rows: DataRow[] = []
      for (const key of keys) {
        const value = await b.getSetting?.(key)
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          rows.push({ ...(value as Record<string, unknown>), id: key })
        } else {
          rows.push({ id: key, value })
        }
      }
      return rows
    }
    // Rekap harian: rentang lebar (1970..2999) = seluruh isi tabel.
    return ((await b.listDailyRange('1970-01-01', '2999-12-31')) ?? []) as unknown as DataRow[]
  } catch (err) {
    console.warn(`loadRows(${name}) gagal:`, err)
    return []
  }
}

async function saveRow(name: CollectionName, id: string, fields: Fields): Promise<void> {
  const b = bridge()
  if (!b) throw new Error('Database lokal tidak tersedia (jalankan aplikasi desktop).')
  if (name === 'employees') {
    const res = await b.upsertEmployee({ ...fields, id } as never)
    if (!res?.ok) throw new Error(`Gagal menyimpan pegawai (${res?.reason ?? 'unknown'})`)
    return
  }
  if (name === 'settings') {
    // Nilai disimpan apa adanya sebagai JSON (dipakai social_links/meta_api).
    // Cek hasilnya: main process bisa menolak payload (key/value tidak valid) —
    // jangan sampai UI mengira tulis berhasil.
    if (!b.setSetting) throw new Error('Database lokal tidak mendukung pengaturan.')
    const res = await b.setSetting(id, fields)
    if (res && res.ok === false) {
      throw new Error(`Gagal menyimpan pengaturan (${res.reason ?? 'unknown'})`)
    }
    return
  }
  const res = await b.upsertDaily(id, fields as never)
  if (!res) throw new Error('Gagal menyimpan rekap harian')
}

async function removeRow(name: CollectionName, id: string): Promise<void> {
  const b = bridge()
  if (!b) throw new Error('Database lokal tidak tersedia (jalankan aplikasi desktop).')
  if (name === 'employees') {
    const res = await b.deleteEmployee(id)
    if (!res) throw new Error('Gagal menghapus pegawai')
    return
  }
  if (name === 'settings') {
    await b.deleteSetting?.(id)
    return
  }
  // Rekap harian tidak punya tombol hapus di UI; dikosongkan bila diminta.
  await b.upsertDaily(id, {} as never)
}

// ===================== Pembuat referensi =====================

function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}${rand}`
}

/**
 * `collection(db, name)` — `db` diabaikan (argumen pertama dipertahankan
 * supaya pemanggil lama tidak perlu diubah).
 */
export function collection(_db: unknown, name: string): CollectionReference {
  return { kind: 'collection', name: name as CollectionName }
}

/**
 * Pengganti `dinasCollection(db, uid, name)` versi Firestore.
 * `uid` sengaja diabaikan: offline tidak ada multi-tenant (#10/#11 specify.md),
 * seluruh data milik satu operator di satu mesin.
 */
export function dinasCollection(
  _db: unknown,
  _uid: string | undefined,
  name: string
): CollectionReference {
  return { kind: 'collection', name: name as CollectionName }
}

/** Pengganti `dinasDoc(db, uid, name, id)` versi Firestore. */
export function dinasDoc(
  _db: unknown,
  _uid: string | undefined,
  name: string,
  id: string
): DocumentReference {
  return { kind: 'doc', name: name as CollectionName, id }
}

/** Tidak ada login di aplikasi offline — disediakan agar import lama kompatibel. */
export async function logout(): Promise<void> {
  // Sengaja kosong: tidak ada sesi untuk diakhiri.
}

/**
 * `doc(collection)` → dokumen dengan id baru.
 * `doc(db, name, id)` / `doc(db, 'dinas', uid, name, id)` → id eksplisit
 * (segmen terakhir), karena path dinas/{uid} sudah tidak berlaku.
 */
export function doc(
  first: unknown,
  ...rest: unknown[]
): DocumentReference {
  if (first && typeof first === 'object' && (first as CollectionReference).kind === 'collection') {
    const name = (first as CollectionReference).name
    return { kind: 'doc', name, id: newId('') }
  }
  const parts = rest.filter((p): p is string => typeof p === 'string')
  const id = parts[parts.length - 1] ?? newId('')
  // Nama koleksi = segmen sebelum id (mis. ['dinas', uid, 'employees'] → employees).
  const collectionSeg = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
  return { kind: 'doc', name: collectionSeg as CollectionName, id }
}

export function query(
  target: CollectionReference,
  ...constraints: QueryConstraint[]
): Query {
  return { kind: 'query', name: target.name, constraints }
}

export function where(field: string, op: QueryConstraint['op'], value: unknown): QueryConstraint {
  return { kind: 'where', field, op, value }
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
  return { kind: 'orderBy', field, direction }
}

export function limit(count: number): QueryConstraint {
  return { kind: 'limit', count }
}

// ===================== Evaluasi query di memori =====================

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), 'id')
}

function matches(row: DataRow, c: QueryConstraint): boolean {
  if (c.kind !== 'where') return true
  const left = row[c.field as string]
  switch (c.op) {
    case '==':
      return left === c.value
    case '>=':
      return compare(left, c.value) >= 0
    case '<=':
      return compare(left, c.value) <= 0
    case '>':
      return compare(left, c.value) > 0
    case '<':
      return compare(left, c.value) < 0
    default:
      return true
  }
}

function toSnapshot(row: DataRow): QueryDocumentSnapshot {
  const { id, ...fields } = row
  return { id, data: () => fields, exists: () => true }
}

function runQuery(name: CollectionName, constraints: QueryConstraint[], rows: DataRow[]): QuerySnapshot {
  let out = rows.filter((row) => constraints.every((c) => matches(row, c)))
  for (const c of constraints) {
    if (c.kind === 'orderBy' && c.field) {
      const dir = c.direction === 'desc' ? -1 : 1
      out = [...out].sort((a, b) => dir * compare(a[c.field as string], b[c.field as string]))
    }
  }
  const lim = constraints.find((c) => c.kind === 'limit')
  if (lim?.count !== undefined) out = out.slice(0, lim.count)
  const docs = out.map(toSnapshot)
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach(cb),
  }
}

// ===================== Langganan (pengganti realtime Firestore) =====================

/**
 * Satu kanal siaran global: setiap tulisan memicu re-run semua listener aktif.
 * Cukup untuk satu jendela & data ribuan baris; tidak ada biaya jaringan.
 */
type Listener = () => void
const listeners = new Set<Listener>()
let emitScheduled = false

function emit(): void {
  if (emitScheduled) return
  emitScheduled = true
  queueMicrotask(() => {
    emitScheduled = false
    for (const fn of [...listeners]) {
      try {
        fn()
      } catch (err) {
        console.error('listener lokal gagal:', err)
      }
    }
  })
}

let bridgeSubscribed = false

/** Terima siaran `reso:db:changed` dari main (importAll, scraper, dll.). */
function ensureBridgeSubscription(): void {
  if (bridgeSubscribed) return
  const b = bridge()
  if (b?.onChanged) {
    b.onChanged(() => emit())
    bridgeSubscribed = true
  }
}

function subscribe(fn: Listener): () => void {
  ensureBridgeSubscription()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** `onSnapshot(query|doc, next, error?)` → fungsi unsubscribe. */
export function onSnapshot(
  target: Query | CollectionReference | DocumentReference,
  next: (snap: QuerySnapshot & DocumentSnapshot & { id?: string }) => void,
  error?: (e: unknown) => void
): () => void {
  let active = true
  /** Generasi per listener: hasil baca lama listener ini tidak boleh menimpa yang baru. */
  let generation = 0

  const emitOnce = async (): Promise<void> => {
    const gen = ++generation
    try {
      if (target.kind === 'doc') {
        const rows = await loadRows(target.name)
        const row = rows.find((r) => r.id === target.id)
        if (!active || gen !== generation) return
        if (row) {
          const { id, ...fields } = row
          next({ ...emptyQuerySnapshot(), id, data: () => fields, exists: () => true } as never)
        } else {
          next({ ...emptyQuerySnapshot(), id: target.id, data: () => undefined, exists: () => false } as never)
        }
        return
      }
      const rows = await loadRows(target.name)
      if (!active || gen !== generation) return
      const constraints = target.kind === 'query' ? target.constraints : []
      next(runQuery(target.name, constraints, rows) as never)
    } catch (err) {
      if (active && error) error(err)
      else console.error('onSnapshot lokal gagal:', err)
    }
  }

  void emitOnce()
  const unsub = subscribe(() => void emitOnce())
  return () => {
    active = false
    unsub()
  }
}

function emptyQuerySnapshot(): QuerySnapshot {
  return { docs: [], size: 0, empty: true, forEach: () => {} }
}

// ===================== Operasi tulis =====================

function applyArrayUnion(base: unknown, patch: unknown): unknown {
  if (patch && typeof patch === 'object' && '__arrayUnion' in (patch as object)) {
    const incoming = (patch as { __arrayUnion: unknown[] }).__arrayUnion
    const current = Array.isArray(base) ? base : []
    const merged = [...current]
    for (const v of incoming) if (!merged.includes(v)) merged.push(v)
    return merged
  }
  return patch
}

function mergeFields(existing: Fields | undefined, patch: Fields): Fields {
  const out: Fields = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = applyArrayUnion(out[key], value)
  }
  return out
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const rows = await loadRows(ref.name)
  const row = rows.find((r) => r.id === ref.id)
  if (!row) {
    return { id: ref.id, exists: () => false, data: () => undefined }
  }
  const { id, ...fields } = row
  return { id, exists: () => true, data: () => fields }
}

export async function getDocs(target: Query | CollectionReference): Promise<QuerySnapshot> {
  const rows = await loadRows(target.name)
  const constraints = target.kind === 'query' ? target.constraints : []
  return runQuery(target.name, constraints, rows)
}

/** `setDoc(ref, data, { merge })` — merge = pertahankan field yang tak dikirim. */
export async function setDoc(
  ref: DocumentReference,
  data: Fields,
  options?: { merge?: boolean }
): Promise<void> {
  const existing = options?.merge
    ? (await getDoc(ref)).data()
    : undefined
  await saveRow(ref.name, ref.id, mergeFields(existing, data))
  emit()
}

/** `updateDoc(ref, patch)` — gagal bila dokumen belum ada (seperti Firestore). */
export async function updateDoc(
  ref: DocumentReference,
  data: Fields
): Promise<void> {
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    throw new Error(`Dokumen ${ref.name}/${ref.id} tidak ditemukan`)
  }
  await saveRow(ref.name, ref.id, mergeFields(snap.data(), data))
  emit()
}

/** `addDoc(collection, data)` → dokumen baru dengan id acak. */
export async function addDoc(ref: CollectionReference, data: Fields): Promise<DocumentReference> {
  const created: DocumentReference = { kind: 'doc', name: ref.name, id: newId('') }
  await saveRow(created.name, created.id, data)
  emit()
  return created
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await removeRow(ref.name, ref.id)
  emit()
}

// ===================== Batch & transaksi =====================

interface PendingWrite {
  ref: DocumentReference
  type: 'set' | 'update' | 'delete'
  data?: Fields
  merge?: boolean
}

/**
 * Batch ditampung dulu lalu dijalankan berurutan saat `commit()`.
 * Tidak atomik lintas baris seperti Firestore, tapi setiap baris memakai
 * prepared statement SQLite sendiri — kegagalan dilaporkan, bukan didiamkan.
 */
export class WriteBatch {
  private writes: PendingWrite[] = []

  set(ref: DocumentReference, data: Fields, options?: { merge?: boolean }): this {
    this.writes.push({ ref, type: 'set', data, merge: options?.merge })
    return this
  }

  update(ref: DocumentReference, data: Fields): this {
    this.writes.push({ ref, type: 'update', data })
    return this
  }

  delete(ref: DocumentReference): this {
    this.writes.push({ ref, type: 'delete' })
    return this
  }

  async commit(): Promise<void> {
    const writes = this.writes
    this.writes = []
    if (writes.length === 0) return

    // Semua field final dihitung dulu supaya main bisa menjalankan satu
    // transaksi SQLite — tulis parsial saat salah satu baris gagal dicegah.
    const ops: Array<Record<string, unknown>> = []
    for (const w of writes) {
      const base: Record<string, unknown> = {
        collection: w.ref.name,
        id: w.ref.id,
      }
      if (w.type === 'delete') {
        ops.push({ ...base, delete: true })
        continue
      }
      let data = w.data ?? {}
      if (w.type === 'update' || w.merge) {
        data = mergeFields((await getDoc(w.ref)).data(), data)
      }
      ops.push({ ...base, data })
    }

    const b = bridge()
    if (b?.batchSave) {
      const res = await b.batchSave(ops)
      if (!res?.ok) throw new Error(`Gagal menyimpan batch (${res?.reason ?? 'unknown'})`)
      emit()
      return
    }

    // Fallback web / bridge lama: tetap berurutan seperti Firestore shim lama.
    for (const w of writes) {
      if (w.type === 'delete') await deleteDoc(w.ref)
      else if (w.type === 'update') await updateDoc(w.ref, w.data ?? {})
      else await setDoc(w.ref, w.data ?? {}, { merge: w.merge })
    }
    emit()
  }
}

export function writeBatch(_db: unknown): WriteBatch {
  return new WriteBatch()
}

interface Transaction {
  set: (ref: DocumentReference, data: Fields, options?: { merge?: boolean }) => void
  update: (ref: DocumentReference, data: Fields) => void
  delete: (ref: DocumentReference) => void
  /** Baca dokumen di dalam transaksi — dipakai UI untuk hindari last-write-wins. */
  get: (ref: DocumentReference) => Promise<DocumentSnapshot>
}

/**
 * Transaksi = batch tulis yang di-commit setelah callback selesai.
 * `tx.get` membaca nilai TERKINI dari database lokal, sehingga merge parsial
 * tetap benar. Catatan: penulisan di-commit di akhir, sama seperti versi
 * Firestore web yang dipakai UI ini.
 */
export async function runTransaction<T>(
  _db: unknown,
  cb: (tx: Transaction) => Promise<T> | T
): Promise<T> {
  const batch = new WriteBatch()
  const tx: Transaction = {
    set: (ref, data, options) => void batch.set(ref, data, options),
    update: (ref, data) => void batch.update(ref, data),
    delete: (ref) => void batch.delete(ref),
    get: (ref) => getDoc(ref),
  }
  const result = await cb(tx)
  await batch.commit()
  return result
}

/** Error bertipe sama seperti Firestore, supaya `handleFirestoreError` tetap jalan. */
export class FirestoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirestoreError'
  }
}

/** True bila berjalan di dalam Electron (ada database lokal). */
export function hasLocalDb(): boolean {
  return !!bridge()
}
