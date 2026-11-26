import { matchEmployeesToEngagement, matchEngagementDetail } from '../src/lib/matching'

const employees = Array.from({ length: 200 }, (_, i) => ({
  id: `e${i}`,
  name: `Pegawai ${i}`,
  igUsername: `pegawai_${i}`,
  fbName: `Pegawai ${i}`,
  tiktokName: `pegawai_${i}`,
  aliases: [`alias_${i}`],
}))

const miss = Array.from({ length: 5000 }, (_, i) => `user_tidak_ada_${i}`).join('\n')
const hit = Array.from({ length: 200 }, (_, i) => `pegawai_${i}`).join('\n')

function bench(label: string, fn: () => unknown, n = 3) {
  const times: number[] = []
  for (let i = 0; i < n; i++) { const t = performance.now(); fn(); times.push(performance.now() - t) }
  console.log(label, Math.min(...times).toFixed(1), 'ms', `(min of ${n})`)
}

bench('matchEmployeesToEngagement / 5000 miss × 200 emp', () => matchEmployeesToEngagement(miss, employees, 'ig'))
bench('matchEmployeesToEngagement / 200 hit × 200 emp', () => matchEmployeesToEngagement(hit, employees, 'ig'))
bench('matchEngagementDetail / 5000 miss × 200 emp', () => matchEngagementDetail(miss, employees, 'ig'))
