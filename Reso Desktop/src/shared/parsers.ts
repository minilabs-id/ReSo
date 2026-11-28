/**
 * Parser payload komentar TikTok (pure).
 *
 * Fungsi murni: memetakan payload JSON → daftar nickname mentah.
 * Normalisasi/dedupe dilakukan pemanggil (src/shared/normalize.ts).
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** TikTok: nickname dari payload comment/list (jalur array + fallback walk). */
export function parseTikTokComments(data: unknown, includeReplies: boolean): string[] {
  const out: string[] = []
  const arrays: unknown[][] = []
  if (isRecord(data) && Array.isArray(data['comments'])) arrays.push(data['comments'] as unknown[])
  const d = isRecord(data) && isRecord(data['data']) ? data['data'] : null
  if (d && Array.isArray(d['comments'])) arrays.push(d['comments'] as unknown[])
  if (isRecord(data) && isRecord(data['comments']) && Array.isArray((data['comments'] as Record<string, unknown>)['list'])) {
    arrays.push((data['comments'] as Record<string, unknown>)['list'] as unknown[])
  }

  const takeUser = (user: unknown): void => {
    if (!isRecord(user)) return
    const nick = user['nickname'] ?? user['nickName']
    if (typeof nick === 'string') out.push(nick)
  }

  if (arrays.length) {
    for (const comments of arrays) {
      for (const c of comments) {
        if (!isRecord(c)) continue
        takeUser(c['user'])
        if (typeof c['nickname'] === 'string') out.push(c['nickname'])
        if (includeReplies) {
          const replies = c['reply_comment'] ?? c['reply_comments'] ?? c['comments']
          if (Array.isArray(replies)) {
            for (const r of replies) takeUser(isRecord(r) ? r['user'] : undefined)
          }
        }
      }
    }
    return out
  }

  // Fallback: hanya node berbentuk komentar (hindari pohon balasan dalam).
  const walk = (v: unknown, depth = 0): void => {
    if (depth > 28 || v == null) return
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
      return
    }
    if (!isRecord(v)) return
    const looksComment =
      v['user'] != null &&
      (v['cid'] != null ||
        v['comment_id'] != null ||
        v['text'] != null ||
        v['create_time'] != null ||
        v['digg_count'] != null)
    if (looksComment) takeUser(v['user'])
    for (const k of Object.keys(v)) {
      if (!includeReplies && (k === 'reply_comment' || k === 'reply_comments' || k === 'comments')) continue
      walk(v[k], depth + 1)
    }
  }
  walk(data, 0)
  return out
}
