/**
 * Shared engagement matching — satu sumber kebenaran untuk pencocokan nama.
 * Matches raw paste text (names/usernames) to employees per platform.
 */

export type EngagementPlatform = 'ig' | 'fb' | 'tiktok';

export interface MatchableEmployee {
  id: string;
  name: string;
  igUsername?: string;
  igUsername2?: string;
  fbName?: string;
  fbName2?: string;
  tiktokName?: string;
  tiktokName2?: string;
  /** Nama panggilan/varian hasil pemetaan admin (antrian belum terpetakan). */
  aliases?: string[];
}

/** Normalize for comparison: lowercase, collapse whitespace. */
export function normalizeMatchText(str: unknown): string {
  const s = typeof str === 'string' ? str : str == null ? '' : String(str);
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripAt(handle: string): string {
  return handle.replace(/^@+/, '');
}

/** Normalisasi satu field identitas: strip @ dulu, lalu lowercase + collapse whitespace. */
function normalizeField(value: string | undefined): string {
  return normalizeMatchText(stripAt(value || ''));
}

/** Escape karakter regex supaya needle diperlakukan literal. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Karakter yang dianggap bagian dari token: huruf Unicode, angka, dan `_`.
 * `_` sengaja ikut token supaya handle seperti `budi_s` tidak kecocokan dengan
 * `budi` (dan sebaliknya). Selain itu (`@`, `.`, spasi, tanda baca, dll.)
 * adalah boundary — `@` sengaja boundary agar handle yang sudah di-strip @
 * tetap cocok dengan baris "@budi_s".
 */
const TOKEN_CHAR = '\\p{L}\\p{N}_';

/**
 * Match needle ke haystack dengan boundary di kedua ujung.
 * - exact equality selalu match
 * - token pendek (< 3 char): whole-token saja (perilaku lama dipertahankan)
 * - token panjang: harus berdiri sebagai token utuh, tapi boleh berada di
 *   dalam baris yang lebih panjang (mis. "Budi Santoso liked this").
 *   Tidak boleh "andi" ⊂ "sandi" atau "bam" ⊂ "bambang".
 */
function textMatches(needle: string, haystack: string): boolean {
  if (!needle || !haystack) return false;
  if (haystack === needle) return true;
  if (needle.length < 3) {
    return haystack.split(/[\s,;|/@]+/).filter(Boolean).includes(needle);
  }
  const re = new RegExp(
    `(^|[^${TOKEN_CHAR}])${escapeRegExp(needle)}(?=$|[^${TOKEN_CHAR}])`,
    'u'
  );
  return re.test(haystack);
}

interface MatchIndex {
  /** Satu regex alternasi untuk semua identitas — jutaan RegExp per run dihindari. */
  reGlobal: RegExp
  reOnce: RegExp
  idsByNeedle: Map<string, string[]>
}

/**
 * Indeks identitas pegawai → id. Alternasi diurutkan terpanjang dulu supaya
 * "budi santoso" tidak dikalahkan "budi" oleh regex engine.
 */
function buildMatchIndex(employees: MatchableEmployee[], platform: EngagementPlatform): MatchIndex {
  const idsByNeedle = new Map<string, string[]>()
  for (const emp of employees) {
    for (const needle of new Set(platformFields(emp, platform))) {
      if (!needle) continue
      const ids = idsByNeedle.get(needle)
      if (ids) ids.push(emp.id)
      else idsByNeedle.set(needle, [emp.id])
    }
  }
  const needles = [...idsByNeedle.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  const pattern = `(^|[^${TOKEN_CHAR}])(${needles.join('|')})(?=$|[^${TOKEN_CHAR}])`
  return {
    reGlobal: new RegExp(pattern, 'gu'),
    reOnce: new RegExp(pattern, 'u'),
    idsByNeedle,
  }
}

function collectMatches(index: MatchIndex, haystack: string, out: Set<string>): void {
  if (!haystack) return
  index.reGlobal.lastIndex = 0
  for (const m of haystack.matchAll(index.reGlobal)) {
    const ids = index.idsByNeedle.get(m[2])
    if (ids) for (const id of ids) out.add(id)
  }
}

/**
 * Match raw engagement text against employee master data for one platform.
 * Returns unique employee IDs that appear to have engaged.
 */
export function matchEmployeesToEngagement(
  input: string,
  employees: MatchableEmployee[],
  platform: EngagementPlatform
): string[] {
  if (!input?.trim() || !employees?.length) return []

  const index = buildMatchIndex(employees, platform)
  const matched = new Set<string>()
  // Cek teks penuh (mendukung identitas multi-kata yang terpisah baris)…
  collectMatches(index, normalizeMatchText(input), matched)
  // …lalu tiap baris, seperti perilaku lama.
  for (const line of input.toLowerCase().split(/[\n,;]+/)) {
    const norm = normalizeMatchText(line)
    if (norm) collectMatches(index, norm, matched)
  }
  return Array.from(matched)
}

/**
 * Bidang pegawai yang dicocokkan ke satu baris: nama (berlaku lintas
 * platform), handle/username khusus platform (pola sama dengan loop per-baris
 * di matchEmployeesToEngagement), plus alias hasil pemetaan admin.
 * Dikembalikan ternormalisasi (lowercase, whitespace dikolaps).
 */
function platformFields(emp: MatchableEmployee, platform: EngagementPlatform): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s) out.push(s);
  };
  push(normalizeField(emp.name));
  if (platform === 'ig') {
    push(normalizeField(emp.igUsername));
    push(normalizeField(emp.igUsername2));
  } else if (platform === 'fb') {
    push(normalizeField(emp.fbName));
    push(normalizeField(emp.fbName2));
  } else if (platform === 'tiktok') {
    push(normalizeField(emp.tiktokName));
    push(normalizeField(emp.tiktokName2));
  }
  // Alias juga di-strip @ supaya "@budi" dan "budi" diperlakukan sama.
  for (const a of emp.aliases || []) push(normalizeField(a));
  return out;
}

/**
 * Matching detail per baris: daftar id pegawai yang cocok + baris yang tidak
 * cocok dengan pegawai mana pun (sumber antrian "nama belum terpetakan").
 * Baris dikembalikan dalam bentuk aslinya (trim, tanpa lowercase) supaya
 * tetap terbaca manusia di UI review.
 */
export function matchEngagementDetail(
  input: string,
  employees: MatchableEmployee[],
  platform: EngagementPlatform
): { matchedIds: string[]; unmatched: string[] } {
  if (!input?.trim() || !employees?.length) return { matchedIds: [], unmatched: [] };

  const lines = input
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const index = buildMatchIndex(employees, platform);
  const matchedIds = new Set<string>();
  const unmatched: string[] = [];

  for (const line of lines) {
    const norm = normalizeMatchText(line);
    if (!norm || !index.reOnce.test(norm)) {
      unmatched.push(line);
      continue;
    }
    collectMatches(index, norm, matchedIds);
  }

  return { matchedIds: Array.from(matchedIds), unmatched };
}

/** Stable compare for engaged ID arrays (order-independent). */
export function engagedIdsEqual(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}

/** Merge raw lines without duplicates (case-insensitive). */
export function mergeUniqueLines(existing: string, additions: string[]): string {
  const lines = existing
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set(lines.map((l) => l.toLowerCase()));
  for (const add of additions) {
    const t = add.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(t);
    }
  }
  return lines.join('\n');
}
