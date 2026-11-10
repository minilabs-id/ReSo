/**
 * Parser payload komentar (pure) — TikTok / Instagram / Facebook GraphQL.
 *
 * PORT 1:1 dari `tmp-shared.js` (BLOCK PARSERS, baris 527–717).
 * Semua fungsi murni: memetakan payload JSON/teks → daftar nama mentah.
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
      if (!includeReplies && (k === 'reply_comment' || k === 'reply_comments')) continue
      walk(v[k], depth + 1)
    }
  }
  walk(data, 0)
  return out
}

/** Instagram: username dari payload comments (top-level). */
export function parseIgComments(data: unknown): string[] {
  const out: string[] = []
  const comments = isRecord(data) && Array.isArray(data['comments']) ? (data['comments'] as unknown[]) : []
  for (const c of comments) {
    if (!isRecord(c)) continue
    const user = isRecord(c['user']) ? c['user'] : null
    const u = user && typeof user['username'] === 'string' ? user['username'] : ''
    if (u) out.push(u)
  }
  return out
}

/**
 * Facebook: nama dari teks GraphQL (pola regex). Balasan ikut hanya saat
 * includeReplies (cermin isReplyComment di walkJson engine lama).
 */
export function extractGraphqlNames(text: unknown, includeReplies: boolean): string[] {
  const out: string[] = []
  if (!text || typeof text !== 'string') return out

  const patterns: RegExp[] = [
    /"__typename"\s*:\s*"Comment"[\s\S]{0,1500}?"author"\s*:\s*\{[\s\S]{0,600}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
    /"author"\s*:\s*\{[\s\S]{0,400}?"__typename"\s*:\s*"User"[\s\S]{0,300}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
    /"author"\s*:\s*\{[\s\S]{0,300}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"[\s\S]{0,300}?"__typename"\s*:\s*"User"/g,
    /"created_time"\s*:\s*\d+[\s\S]{0,500}?"author"\s*:\s*\{[\s\S]{0,400}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
    /"author"\s*:\s*\{[\s\S]{0,400}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"[\s\S]{0,500}?"created_time"\s*:\s*\d+/g,
    /"body"\s*:\s*\{[^}]{0,200}"text"\s*:\s*"[^"]{0,500}"[\s\S]{0,400}?"author"\s*:\s*\{[\s\S]{0,400}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
  ]

  // Batas objek komentar dihitung sekali (string-aware, satu pass) supaya field
  // komentar tetangga / sub-pohon balasan tidak ikut terbaca.
  let commentSpans: { starts: number[]; ends: Map<number, number> } | null = null
  const isReplyAt = (index: number): boolean => {
    if (!commentSpans) {
      const starts: number[] = []
      const ends = new Map<number, number>()
      const stack: number[] = []
      let inStr = false
      let esc = false
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!
        if (inStr) {
          if (esc) esc = false
          else if (ch === '\\') esc = true
          else if (ch === '"') inStr = false
          continue
        }
        if (ch === '"') inStr = true
        else if (ch === '{') {
          stack.push(i)
          if (/^\s*"__typename"\s*:\s*"Comment"/.test(text.slice(i + 1, i + 41))) starts.push(i)
        } else if (ch === '}') {
          const open = stack.pop()
          if (open !== undefined) ends.set(open, i + 1)
        }
      }
      commentSpans = { starts, ends }
    }
    const { starts, ends } = commentSpans

    let lo = 0
    let hi = starts.length - 1
    let pos = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid]! <= index) {
        pos = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    while (pos >= 0) {
      const start = starts[pos]!
      const end = ends.get(start) ?? text.length
      if (end > index) {
        const next = pos + 1 < starts.length ? starts[pos + 1]! : end
        const ctx = text.slice(start, Math.min(next, end))
        if (/"(?:comment_parent|reply_parent_comment|comment_direct_parent)"\s*:\s*\{/.test(ctx)) return true
        const depth = /"depth"\s*:\s*(\d+)/.exec(ctx)
        if (depth && Number(depth[1]) > 0) return true
        if (/"(?:is_reply|isReply)"\s*:\s*true/.test(ctx)) return true
        return false
      }
      pos--
    }
    return false
  }

  const seen = new Set<string>()
  for (const re of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (!includeReplies && isReplyAt(m.index)) continue
      let name: string
      try {
        name = JSON.parse(`"${m[1]}"`) as string
      } catch {
        name = m[1]!
      }
      if (typeof name === 'string' && name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase())
        out.push(name)
      }
    }
  }
  return out
}
