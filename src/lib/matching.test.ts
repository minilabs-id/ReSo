/**
 * Lightweight matching regression checks (run: npx tsx src/lib/matching.test.ts)
 */
import {
  matchEmployeesToEngagement,
  matchEngagementDetail,
  engagedIdsEqual,
  mergeUniqueLines,
} from './matching';

const employees = [
  {
    id: 'e1',
    name: 'Budi Santoso',
    igUsername: '@budi_s',
    igUsername2: 'budi.alt',
    fbName: 'Budi Santoso FB',
    tiktokName: '@buditk',
  },
  {
    id: 'e2',
    name: 'Siti Aminah',
    igUsername: 'siti_aminah',
    fbName: 'Siti Aminah',
    tiktokName: 'siti.tt',
  },
  {
    id: 'e3',
    name: 'Andi Wijaya',
    igUsername: 'andiw',
  },
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

// IG username match
assert(
  matchEmployeesToEngagement('budi_s\nsomeone_else', employees, 'ig').includes('e1'),
  'IG primary username'
);
assert(
  matchEmployeesToEngagement('budi.alt', employees, 'ig').includes('e1'),
  'IG secondary username'
);
assert(
  matchEmployeesToEngagement('@siti_aminah', employees, 'ig').includes('e2'),
  'IG with @ strip on master'
);

// Full name in paste
assert(
  matchEmployeesToEngagement('Budi Santoso liked this', employees, 'ig').includes('e1'),
  'Full name in blob'
);

// FB
assert(
  matchEmployeesToEngagement('Budi Santoso FB', employees, 'fb').includes('e1'),
  'FB display name'
);

// TikTok
assert(
  matchEmployeesToEngagement('buditk\nsiti.tt', employees, 'tiktok').includes('e1') &&
    matchEmployeesToEngagement('buditk\nsiti.tt', employees, 'tiktok').includes('e2'),
  'TikTok multi-line'
);

// No false match empty
assert(matchEmployeesToEngagement('', employees, 'ig').length === 0, 'Empty input');
assert(matchEmployeesToEngagement('random_xyz_99', employees, 'ig').length === 0, 'No false positive random');

// engagedIdsEqual order-independent
assert(engagedIdsEqual(['a', 'b'], ['b', 'a']), 'IDs equal unordered');
assert(!engagedIdsEqual(['a'], ['a', 'b']), 'IDs unequal length');

// FB secondary + name-only TikTok path
assert(
  matchEmployeesToEngagement('Siti Aminah', employees, 'fb').includes('e2'),
  'FB match by name field'
);
assert(
  !matchEmployeesToEngagement('andiw', employees, 'fb').includes('e3'),
  'IG handle not matched on FB platform'
);
assert(
  matchEmployeesToEngagement('ANDI WIJAYA', employees, 'tiktok').includes('e3'),
  'Name match case-insensitive on TikTok'
);
assert(
  matchEmployeesToEngagement('  @budi_s  \n', employees, 'ig').includes('e1'),
  'Whitespace around username'
);

// Short-token false positive guard
const shortEmp = [{ id: 's1', name: 'Li', igUsername: 'li' }];
assert(
  !matchEmployeesToEngagement('malicious', shortEmp, 'ig').includes('s1'),
  'Short token not false-positive inside longer word'
);
assert(
  matchEmployeesToEngagement('li', shortEmp, 'ig').includes('s1'),
  'Short token exact still matches'
);

// Aliases (hasil pemetaan admin antrian belum terpetakan) — lintas platform
const empWithAlias = [{ id: 'e1', name: 'Budi Santoso', aliases: ['Budi S'] }];
assert(
  matchEmployeesToEngagement('budi s', empWithAlias, 'fb').includes('e1'),
  'alias dicocokkan di FB'
);
assert(
  matchEmployeesToEngagement('budi s', empWithAlias, 'ig').includes('e1'),
  'alias dicocokkan di IG'
);
assert(
  matchEmployeesToEngagement('Budi S', empWithAlias, 'tiktok').includes('e1'),
  'alias case-insensitive di TikTok'
);

// === Regression P0: boundary-aware (anti false positive) ===

// "Sandi Wijaya" tidak boleh mengaktifkan "Andi Wijaya"
assert(
  !matchEmployeesToEngagement('Sandi Wijaya', employees, 'fb').includes('e3'),
  'boundary: "Sandi Wijaya" tidak match "Andi Wijaya"'
);
assert(
  matchEmployeesToEngagement('Andi Wijaya', employees, 'fb').includes('e3'),
  'boundary: "Andi Wijaya" tetap match'
);
{
  const andi = [{ id: 'andi', name: 'Andi Wijaya', fbName: 'Andi Wijaya' }];
  assert(
    !matchEmployeesToEngagement('sandi wijaya liked this', andi, 'fb').includes('andi'),
    'boundary: "sandi wijaya" di dalam baris tidak match Andi'
  );
  assert(
    matchEmployeesToEngagement('Andi Wijaya liked this', andi, 'fb').includes('andi'),
    'boundary: "Andi Wijaya" di dalam baris tetap match'
  );
}

// "Bambang" tidak boleh mengaktifkan "Bam"
const bamEmp = [{ id: 'bam', name: 'Bam', igUsername: 'bam' }];
assert(
  !matchEmployeesToEngagement('Bambang', bamEmp, 'ig').includes('bam'),
  'boundary: "Bambang" tidak match "Bam"'
);
assert(
  matchEmployeesToEngagement('Bam', bamEmp, 'ig').includes('bam'),
  'boundary: "Bam" exact tetap match'
);
assert(
  !matchEmployeesToEngagement('Bambang liked this', bamEmp, 'ig').includes('bam'),
  'boundary: "Bam" tidak match di dalam "Bambang liked this"'
);
const bambangEmp = [{ id: 'bb', name: 'Bambang' }];
assert(
  matchEmployeesToEngagement('Bambang', bambangEmp, 'ig').includes('bb'),
  'boundary: "Bambang" dengan pegawai Bambang tetap match'
);

// Nama / handle di dalam baris yang lebih panjang tetap cocok
assert(
  matchEmployeesToEngagement('Budi Santoso liked this', employees, 'ig').includes('e1'),
  'boundary: nama di dalam baris panjang tetap match'
);
{
  const r = matchEngagementDetail('Budi Santoso liked this', employees, 'fb');
  assert(
    r.matchedIds.includes('e1') && r.unmatched.length === 0,
    'detail: "Budi Santoso liked this" match e1 tanpa unmatched'
  );
}

// Handle dengan @ di input + akun kedua (dual identity fields)
assert(
  matchEmployeesToEngagement('@budi_s', employees, 'ig').includes('e1'),
  'boundary: handle dengan @ di input cocok'
);
assert(
  matchEmployeesToEngagement('@budi.alt', employees, 'ig').includes('e1'),
  'boundary: handle ke-2 dengan @ di input cocok'
);
assert(
  matchEmployeesToEngagement('budi_s liked this', employees, 'ig').includes('e1'),
  'boundary: handle underscore di dalam baris panjang cocok'
);

// Alias dengan @ — strip @ konsisten di semua field identitas
const aliasAt = [{ id: 'a1', name: 'Seseorang Lain', aliases: ['@budi'] }];
assert(
  matchEmployeesToEngagement('budi', aliasAt, 'fb').includes('a1'),
  'alias "@budi" dicocokkan dengan baris "budi"'
);
assert(
  matchEmployeesToEngagement('@budi', aliasAt, 'fb').includes('a1'),
  'alias "@budi" dicocokkan dengan baris "@budi"'
);
{
  const r = matchEngagementDetail('@budi\nOrang Lain', aliasAt, 'fb');
  assert(
    r.matchedIds.includes('a1') && r.unmatched.length === 1 && r.unmatched[0] === 'Orang Lain',
    'detail: alias @budi menghapus baris dari antrian'
  );
}

// Nama dengan titik / underscore
const dottedEmp = [{ id: 'd1', name: 'Budi S.', igUsername: 'budi_s' }];
assert(
  matchEmployeesToEngagement('Budi S.', dottedEmp, 'fb').includes('d1'),
  'nama dengan titik tetap match'
);
assert(
  matchEmployeesToEngagement('budi_s', dottedEmp, 'ig').includes('d1'),
  'handle dengan underscore tetap match'
);
assert(
  !matchEmployeesToEngagement('budi_x', dottedEmp, 'ig').includes('d1'),
  'underscore bukan boundary: "budi_x" tidak match "budi_s"'
);
const budiOnly = [{ id: 'b', name: 'Budi' }];
assert(
  !matchEmployeesToEngagement('budi_s', budiOnly, 'ig').includes('b'),
  'underscore bukan boundary: "Budi" tidak match "budi_s"'
);

// Perilaku token pendek (< 3 char) tetap dipertahankan
assert(
  !matchEmployeesToEngagement('malicious', shortEmp, 'fb').includes('s1'),
  'short token tidak false-positive di fb'
);
assert(
  matchEmployeesToEngagement('li, budi', shortEmp, 'ig').includes('s1'),
  'short token dipisah koma tetap match'
);

// Detail: "Bambang" masuk antrian, bukan match "Bam"
{
  const r = matchEngagementDetail('Bambang', bamEmp, 'ig');
  assert(!r.matchedIds.includes('bam') && r.unmatched.length === 1, 'detail: Bambang tidak match Bam');
}

// matchEngagementDetail — matched ids + daftar baris yang tidak cocok
{
  const r = matchEngagementDetail('Budi Santoso\nOrang Lain\nandiw', employees, 'ig');
  assert(r.matchedIds.includes('e1'), 'detail: Budi Santoso match e1');
  assert(r.matchedIds.includes('e3'), 'detail: andiw (ig username) match e3');
  assert(
    JSON.stringify(r.unmatched) === JSON.stringify(['Orang Lain']),
    `detail: hanya 'Orang Lain' yang belum terpetakan, dapat ${JSON.stringify(r.unmatched)}`
  );
}
{
  const r = matchEngagementDetail('@budi_s\nbudi_s', employees, 'ig');
  assert(r.matchedIds.length === 1 && r.matchedIds[0] === 'e1', 'detail: duplikat baris → 1 id');
  assert(r.unmatched.length === 0, 'detail: semua baris cocok');
}
{
  const r = matchEngagementDetail('Budi Santoso\n', employees, 'fb');
  assert(r.unmatched.length === 0, 'detail: input kosong/tidak ada baris tidak dihitung');
}
{
  // Alias yang sudah dipetakan → baris tidak lagi masuk antrian
  // (dengan boundary-aware, 'Pak Bud' tidak lagi ⊂ 'Pak Budi'; gunakan
  // varian yang benar-benar beda untuk menguji antrian)
  const withAlias = [{ id: 'e1', name: 'Budi Santoso', aliases: ['Pak Bud'] }];
  const r = matchEngagementDetail('Pak Bud\nMas Budi', withAlias, 'fb');
  assert(r.unmatched.length === 1 && r.unmatched[0] === 'Mas Budi', 'detail: alias menghapus baris dari antrian');
}

// mergeUniqueLines
assert(
  mergeUniqueLines('a\nb', ['B', 'c']) === 'a\nb\nc',
  'mergeUniqueLines case-insensitive dedupe'
);

console.log('\nAll matching tests passed.');
