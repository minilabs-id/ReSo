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

/**
 * Match raw engagement text against employee master data for one platform.
 * Returns unique employee IDs that appear to have engaged.
 */
export function matchEmployeesToEngagement(
  input: string,
  employees: MatchableEmployee[],
  platform: EngagementPlatform
): string[] {
  if (!input?.trim() || !employees?.length) return [];

  const lowerInput = normalizeMatchText(input);
  const inputLines = input
    .toLowerCase()
    .split(/[\n,;]+/)
    .map((line) => normalizeMatchText(line))
    .filter((line) => line.length > 0);

  const matchedIds = new Set<string>();

  for (const emp of employees) {
    const nameMatch = normalizeField(emp.name);
    const igMatch = normalizeField(emp.igUsername);
    const igMatch2 = normalizeField(emp.igUsername2);
    const fbMatch = normalizeField(emp.fbName);
    const fbMatch2 = normalizeField(emp.fbName2);
    const tiktokMatch = normalizeField(emp.tiktokName);
    const tiktokMatch2 = normalizeField(emp.tiktokName2);

    let isMatch = false;

    if (nameMatch && textMatches(nameMatch, lowerInput)) isMatch = true;

    if (!isMatch && platform === 'ig') {
      if (igMatch && textMatches(igMatch, lowerInput)) isMatch = true;
      if (igMatch2 && textMatches(igMatch2, lowerInput)) isMatch = true;
    } else if (!isMatch && platform === 'fb') {
      if (fbMatch && textMatches(fbMatch, lowerInput)) isMatch = true;
      if (fbMatch2 && textMatches(fbMatch2, lowerInput)) isMatch = true;
    } else if (!isMatch && platform === 'tiktok') {
      if (tiktokMatch && textMatches(tiktokMatch, lowerInput)) isMatch = true;
      if (tiktokMatch2 && textMatches(tiktokMatch2, lowerInput)) isMatch = true;
    }

    // Alias hasil pemetaan admin (antrian belum terpetakan) — lintas platform.
    if (!isMatch && (emp.aliases || []).some((a) => textMatches(normalizeField(a), lowerInput))) {
      isMatch = true;
    }

    if (!isMatch) {
      for (const line of inputLines) {
        if (textMatches(nameMatch, line)) {
          isMatch = true;
          break;
        }
        // Alias juga dicocokkan per-baris (nama yang sudah dipetakan otomatis
        // match pada kiriman berikutnya).
        if (!isMatch && (emp.aliases || []).some((a) => textMatches(normalizeField(a), line))) {
          isMatch = true;
          break;
        }
        if (platform === 'ig') {
          if (igMatch && textMatches(igMatch, line)) {
            isMatch = true;
            break;
          }
          if (igMatch2 && textMatches(igMatch2, line)) {
            isMatch = true;
            break;
          }
        } else if (platform === 'fb') {
          if (fbMatch && textMatches(fbMatch, line)) {
            isMatch = true;
            break;
          }
          if (fbMatch2 && textMatches(fbMatch2, line)) {
            isMatch = true;
            break;
          }
        } else if (platform === 'tiktok') {
          if (tiktokMatch && textMatches(tiktokMatch, line)) {
            isMatch = true;
            break;
          }
          if (tiktokMatch2 && textMatches(tiktokMatch2, line)) {
            isMatch = true;
            break;
          }
        }
      }
    }

    if (isMatch) matchedIds.add(emp.id);
  }

  return Array.from(matchedIds);
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

  const matchedIds = new Set<string>();
  const unmatched: string[] = [];

  for (const line of lines) {
    const norm = normalizeMatchText(line);
    let lineMatched = false;
    for (const emp of employees) {
      if (platformFields(emp, platform).some((f) => textMatches(f, norm))) {
        matchedIds.add(emp.id);
        lineMatched = true;
      }
    }
    if (!lineMatched) unmatched.push(line);
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
