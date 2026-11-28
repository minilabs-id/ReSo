/**
 * Otomatisasi alur operator: hasil scraping LANGSUNG masuk ke rekap harian
 * dan langsung dipetakan ke master pegawai (nama + akun sosial).
 *
 * Tidak ada langkah salin/paste. Input manual di modal Rekap tetap tersedia.
 */
import { BrowserWindow } from 'electron'
import * as db from '../db/database'
import { IPC } from '../ipc/contracts'
import { getLocalISODate } from '../../src/lib/date'
import {
  matchEmployeesToEngagement,
  matchEngagementDetail,
  mergeUniqueLines,
  mergeUnmatchedByPlatform,
} from '../../src/lib/matching'
import type { Platform, UnmatchedName } from '../../src/shared/types'

type EngagementPlatform = UnmatchedName['platform']

const RAW_FIELD: Record<Platform, 'igRawText' | 'fbRawText' | 'tiktokRawText'> = {
  facebook: 'fbRawText',
  instagram: 'igRawText',
  tiktok: 'tiktokRawText',
}
const IDS_FIELD: Record<
  Platform,
  'fbEngagedEmployeeIds' | 'igEngagedEmployeeIds' | 'tiktokEngagedEmployeeIds'
> = {
  facebook: 'fbEngagedEmployeeIds',
  instagram: 'igEngagedEmployeeIds',
  tiktok: 'tiktokEngagedEmployeeIds',
}
const MATCH_PLATFORM: Record<Platform, EngagementPlatform> = {
  facebook: 'fb',
  instagram: 'ig',
  tiktok: 'tiktok',
}

export interface HandoffResult {
  date: string
  platform: Platform
  total: number
  added: number
  matched: number
  unmatched: number
}

/**
 * Tulis nama hasil scrape ke dokumen harian + hitung engaged IDs & unmatched.
 * Dipanggil sekali per run yang selesai (DONE) oleh RunController.
 */
export function handoffScrapeToRekap(
  platform: Platform,
  names: string[],
  date: string = getLocalISODate(new Date())
): HandoffResult | null {
  if (!names.length) return null

  const existing = db.getDaily(date)
  const field = RAW_FIELD[platform]
  const previousRaw = String(existing?.[field] ?? '')
  const mergedRaw = mergeUniqueLines(previousRaw, names)
  const total = mergedRaw.split(/\r?\n/).filter(Boolean).length
  const previousCount = previousRaw.split(/\r?\n/).filter(Boolean).length

  const employees = db.listEmployees()
  const matchPlatform = MATCH_PLATFORM[platform]
  const engagedIds = matchEmployeesToEngagement(mergedRaw, employees, matchPlatform)
  const detail = matchEngagementDetail(mergedRaw, employees, matchPlatform)
  // Jangan timpa antrean review platform lain — gabungkan & dedupe.
  const previousUnmatched = Array.isArray(existing?.unmatchedNames)
    ? (existing!.unmatchedNames as Array<{ name?: unknown; platform?: unknown }>).filter(
        (u) => u && typeof u.name === 'string' && u.platform !== matchPlatform
      ) as UnmatchedName[]
    : []
  const unmatchedNames = mergeUnmatchedByPlatform(
    previousUnmatched,
    detail.unmatched.map((name) => ({ name, platform: matchPlatform }))
  )

  db.upsertDaily(date, {
    [field]: mergedRaw,
    [IDS_FIELD[platform]]: engagedIds,
    unmatchedNames,
  })

  // Renderer perlu snapshot segar (onSnapshot) — siarkan perubahan DB.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.dbChanged)
  }

  return {
    date,
    platform,
    total,
    added: Math.max(0, total - previousCount),
    matched: engagedIds.length,
    unmatched: unmatchedNames.length,
  }
}
