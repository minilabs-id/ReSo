/**
 * Tes shim database lokal (`src/lib/local-db.ts`).
 *
 * Strategi: pasang `globalThis.window` tiruan dengan `window.reso.data` yang
 * meniru preload (termasuk validasi & kegagalan), lalu uji perilaku yang
 * DIANDALKAN komponen UI lama: merge set/update, query where+orderBy, batch,
 * transaksi, onSnapshot berulang, dan arrayUnion.
 */
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
  arrayUnion,
  serverTimestamp,
  hasLocalDb,
  type QuerySnapshot,
} from './local-db'

type Row = Record<string, unknown> & { id: string }

let failures = 0
function check(name: string, cond: boolean): void {
  if (!cond) {
    failures++
    console.log(`FAIL: ${name}`)
  } else {
    console.log(`OK: ${name}`)
  }
}

function makeFakeBridge() {
  const employees = new Map<string, Row>()
  const daily = new Map<string, Row>()
  let failNext = false
  let setSettingCalls = 0

  const upsertDaily = (date: string, patch: Row) => {
    const prev = daily.get(date) ?? { id: date, date }
    const next: Row = { ...prev }
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id') continue
      next[k] = v
    }
    daily.set(date, next)
    return next
  }

  const data = {
    listEmployees: async () => [...employees.values()],
    upsertEmployee: async (emp: Row) => {
      if (failNext) {
        failNext = false
        return { ok: false, reason: 'forced' }
      }
      employees.set(emp.id, { ...emp })
      return { ok: true, employee: emp }
    },
    replaceEmployees: async () => ({ ok: true }),
    deleteEmployee: async (id: string) => ({ ok: employees.delete(id) }),
    getDaily: async (d: string) => daily.get(d) ?? null,
    listDailyRange: async () => [...daily.values()],
    upsertDaily: async (d: string, patch: Row) => upsertDaily(d, patch),
    stats: async () => ({ employees: employees.size, days: daily.size, path: 'mem', schemaVersion: 1 }),
    exportAll: async () => ({ employees: [...employees.values()], daily: [...daily.values()] }),
    importAll: async () => ({ ok: true }),
    listSettings: async () => ['preferences'],
    getSetting: async (k: string) => (k === 'preferences' ? { value: 'tok' } : null),
    setSetting: async () => {
      setSettingCalls++
      return { ok: true }
    },
    deleteSetting: async () => ({ ok: true }),
  }

  ;(globalThis as unknown as { window: unknown }).window = { reso: { platform: 'electron', data } }
  return { employees, daily, breakNextSave: () => (failNext = true), setSettingCalls: () => setSettingCalls }
}

async function main(): Promise<void> {
  const fake = makeFakeBridge()

  check('hasLocalDb true saat bridge ada', hasLocalDb())

  // --- setDoc vs setDoc merge ---
  const empRef = doc(collection(null, 'employees'), 'e1' as never) as never
  const empDoc = doc(null, 'dinas', 'uid-1', 'employees', 'e1')
  check('doc path dinas → nama koleksi employees', empDoc.name === 'employees')
  check('doc path dinas → id dari segmen terakhir', empDoc.id === 'e1')

  await setDoc(empDoc, { name: 'Budi', nip: '111' })
  check('setDoc menyimpan baris', fake.employees.get('e1')?.name === 'Budi')

  await setDoc(empDoc, { nip: '222' }, { merge: true })
  check('setDoc merge mempertahankan field lama', fake.employees.get('e1')?.name === 'Budi')
  check('setDoc merge menimpa field yang dikirim', fake.employees.get('e1')?.nip === '222')

  await setDoc(empDoc, { name: 'Budi' })
  check('setDoc tanpa merge mengganti dokumen', fake.employees.get('e1')?.nip === undefined)

  // --- arrayUnion (merge: true — sama seperti pemakaian nyata di UI) ---
  await setDoc(empDoc, { aliases: arrayUnion('a', 'b') }, { merge: true })
  await setDoc(empDoc, { aliases: arrayUnion('b', 'c') }, { merge: true })
  const aliases = fake.employees.get('e1')?.aliases as string[]
  check('arrayUnion menambah tanpa duplikat', JSON.stringify(aliases) === '["a","b","c"]')
  check('arrayUnion pada field kosong → array', Array.isArray(aliases))

  // --- updateDoc gagal bila dokumen tidak ada ---
  let threw = false
  try {
    await updateDoc(doc(null, 'dailyEngagement', '2026-01-01') as never, { verifiedAt: 'x' })
  } catch {
    threw = true
  }
  check('updateDoc menolak dokumen yang belum ada', threw)

  // --- upsertDaily lewat set ---
  const dayRef = doc(null, 'dinas', 'uid-1', 'dailyEngagement', '2026-01-02')
  await setDoc(dayRef, { date: '2026-01-02', igRawText: 'a' })
  await setDoc(dayRef, { fbRawText: 'b' }, { merge: true })
  check('rekap harian merge tidak menghapus kolom lain', fake.daily.get('2026-01-02')?.igRawText === 'a')
  check('rekap harian merge menambah kolom baru', fake.daily.get('2026-01-02')?.fbRawText === 'b')

  // --- getDoc / getDocs + query ---
  const snap = await getDoc(empDoc)
  check('getDoc exists', snap.exists())
  check('getDoc data tanpa id', snap.data()?.name === 'Budi')

  const missing = await getDoc(doc(null, 'employees', 'nope') as never)
  check('getDoc dokumen hilang → exists false', !missing.exists())

  const col = collection(null, 'dailyEngagement')
  for (const d of ['2025-12-01', '2026-01-05', '2026-01-01']) {
    await setDoc(doc(null, 'dailyEngagement', d) as never, { date: d })
  }
  const q = query(col, where('date', '>=', '2026-01-01'), orderBy('date', 'desc'))
  const qs = (await getDocs(q)) as QuerySnapshot
  // Baris '2026-01-02' (dibuat di atas) ikut terhitung → total 3.
  check('query where >= menyaring', qs.size === 3)
  check('query orderBy desc urut', qs.docs[0]?.id === '2026-01-05')

  const qEq = query(collection(null, 'employees'), where('name', '==', 'Budi'))
  check('query where == cocok', (await getDocs(qEq)).size === 1)

  // --- addDoc ---
  const added = await addDoc(collection(null, 'employees'), { name: 'Sari', nip: '9' })
  check('addDoc membuat id unik', added.id.length > 0 && fake.employees.has(added.id))

  // --- batch ---
  const b = writeBatch(null)
  b.set(doc(null, 'employees', 'b1') as never, { name: 'A' })
  b.set(doc(null, 'employees', 'b2') as never, { name: 'B' })
  b.update(doc(null, 'employees', 'b2') as never, { nip: '3' })
  b.delete(doc(null, 'employees', 'b1') as never)
  await b.commit()
  check('batch menghapus entri yang di-delete', !fake.employees.has('b1'))
  check('batch menulis lalu memperbarui entri', fake.employees.get('b2')?.nip === '3')

  // --- transaksi ---
  const result = await runTransaction(null, async (tx) => {
    tx.set(doc(null, 'employees', 't1') as never, { name: 'Tx' })
    return 'nilai-transaksi'
  })
  check('transaksi mengembalikan nilai callback', result === 'nilai-transaksi')
  check('transaksi menulis ke database', fake.employees.get('t1')?.name === 'Tx')

  // --- kegagalan simpan dilaporkan (bukan didiamkan) ---
  fake.breakNextSave()
  let saveThrew = false
  try {
    await setDoc(doc(null, 'employees', 'bad') as never, { name: 'X' })
  } catch {
    saveThrew = true
  }
  check('kegagalan simpan melempar error', saveThrew)

  // --- onSnapshot: nilai awal + reaktivitas setelah tulis ---
  const seen: string[] = []
  const unsub = onSnapshot(query(collection(null, 'employees'), orderBy('name', 'asc')), (s) => {
    seen.push(`${s.size}`)
  })
  await new Promise((r) => setTimeout(r, 10))
  check('onSnapshot mengirim snapshot awal', seen.length >= 1)

  await setDoc(doc(null, 'employees', 'snap1') as never, { name: 'Aaa' })
  await new Promise((r) => setTimeout(r, 10))
  check('onSnapshot terpanggil lagi setelah tulis', seen.length >= 2)
  check('snapshot terbaru memuat baris baru', seen[seen.length - 1] === String(fake.employees.size))

  unsub()
  const before = seen.length
  await setDoc(doc(null, 'employees', 'snap2') as never, { name: 'Bbb' })
  await new Promise((r) => setTimeout(r, 10))
  check('unsubscribe menghentikan langganan', seen.length === before)

  // --- onSnapshot dokumen tunggal (settings / preferences) ---
  const docSnaps: Array<boolean> = []
  const unsubDoc = onSnapshot(doc(null, 'settings', 'preferences') as never, (s) => {
    docSnaps.push(s.exists())
  })
  await new Promise((r) => setTimeout(r, 10))
  check('onSnapshot dokumen mengirim exists sekali', docSnaps.length === 1)
  unsubDoc()

  check('serverTimestamp menghasilkan ISO valid', !Number.isNaN(Date.parse(serverTimestamp())))

  console.log(failures === 0 ? '\nlocal-db: semua check OK' : `\nlocal-db: ${failures} GAGAL`)
  if (failures > 0) process.exit(1)
}

void main()
