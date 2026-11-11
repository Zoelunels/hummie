import { parseLrc, type LrcLine } from './lrc'

// LRCLIB asks clients to identify themselves with a name, version and homepage.
export const USER_AGENT = 'Hummie/0.1.0 (https://github.com/Zoelunels/hummie)'

export interface Track {
  title: string
  artist: string
  album?: string
  durationSec?: number
}

export type LyricsResult =
  | { kind: 'synced'; lines: LrcLine[] }
  | { kind: 'instrumental' }
  | { kind: 'none' }
  | { kind: 'error' } // lookup could not complete (network, rate limit, server); not cached

const NONE: LyricsResult = { kind: 'none' }
const ERROR: LyricsResult = { kind: 'error' }
const CACHE_MAX = 200
const TIMEOUT_MS = 8000
const SEARCH_TOLERANCE_SEC = 3

interface Record_ {
  duration?: unknown
  instrumental?: unknown
  syncedLyrics?: unknown
}

export class Lrclib {
  private cache = new Map<string, LyricsResult>()
  private blockedUntil = 0

  constructor(
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
    private base = 'https://lrclib.net',
    private log: (msg: string) => void = () => {}
  ) {}

  /** Never throws: failures resolve to `none` (and are not cached, so a later track retries). */
  async lookup(t: Track): Promise<LyricsResult> {
    const key = [t.title, t.artist, t.album ?? '', Math.round(t.durationSec ?? 0)].join('|').toLowerCase()
    const hit = this.cache.get(key)
    if (hit) return hit
    if (this.now() < this.blockedUntil) return ERROR

    try {
      let rec: Record_ | null | 'notfound' | 'failed' = await this.get(t)
      // LRCLIB sometimes has a wrong 'instrumental' entry for a title while another entry of the same
      // song has lyrics, so look for a synced candidate before trusting 'instrumental' or a miss.
      const flaggedInstrumental = typeof rec === 'object' && rec !== null && rec.instrumental === true
      if (rec === 'notfound' || flaggedInstrumental) {
        const found = await this.search(t)
        if (found && found !== 'failed') rec = found
        else if (rec === 'notfound') rec = found
      }
      if (rec === 'failed') return ERROR
      const result = rec ? toResult(rec) : NONE
      this.remember(key, result)
      return result
    } catch (e) {
      this.log(`lrclib lookup error: ${(e as Error).message}`)
      return ERROR
    }
  }

  private remember(key: string, r: LyricsResult): void {
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(key, r)
  }

  /** Exact match endpoint. */
  private async get(t: Track): Promise<Record_ | 'notfound' | 'failed'> {
    const p = new URLSearchParams({ track_name: t.title, artist_name: t.artist })
    if (t.album) p.set('album_name', t.album)
    const d = Math.round(t.durationSec ?? 0)
    if (d >= 1 && d <= 3600) p.set('duration', String(d))
    const res = await this.request(`/api/get?${p}`)
    if (!res) return 'failed'
    if (res.status === 404) return 'notfound'
    if (!res.ok) {
      this.log(`lrclib get returned HTTP ${res.status}`)
      return 'failed'
    }
    return (await res.json()) as Record_
  }

  /**
   * Fallback when the exact lookup misses (or says instrumental): search, then pick the closest synced
   * result by length. Tries a structured search first, then a free-text one, since the structured one
   * is capped at 20 results and can be filled with duplicates of a bad entry.
   */
  private async search(t: Track): Promise<Record_ | null | 'failed'> {
    if (!t.durationSec) return null
    const attempts = [
      new URLSearchParams({ track_name: t.title, artist_name: t.artist }),
      new URLSearchParams({ q: `${t.title} ${t.artist}` })
    ]
    let failed = false
    for (const p of attempts) {
      const res = await this.request(`/api/search?${p}`)
      if (!res || !res.ok) {
        if (res) this.log(`lrclib search returned HTTP ${res.status}`)
        failed = true
        continue
      }
      const list = (await res.json()) as Record_[]
      if (!Array.isArray(list)) continue
      let best: Record_ | null = null
      let bestDiff = Infinity
      for (const r of list) {
        if (typeof r.syncedLyrics !== 'string' || typeof r.duration !== 'number') continue
        const diff = Math.abs(r.duration - t.durationSec)
        if (diff <= SEARCH_TOLERANCE_SEC && diff < bestDiff) {
          best = r
          bestDiff = diff
        }
      }
      if (best) return best
    }
    return failed ? 'failed' : null
  }

  private async request(path: string): Promise<Response | null> {
    try {
      // Call through a local binding so a native global fetch never sees the Lrclib instance as `this`.
      const doFetch = this.fetchFn
      const res = await doFetch(this.base + path, {
        headers: { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (res.status === 429 || res.status === 503) {
        // Honor Retry-After plus jitter, as the API requires.
        const secs = Number(res.headers.get('retry-after')) || 30
        this.log(`lrclib rate limited (HTTP ${res.status}), backing off ${secs}s`)
        this.blockedUntil = this.now() + secs * 1000 * (1 + Math.random() * 0.3)
        return null
      }
      return res
    } catch (e) {
      this.log(`lrclib request failed: ${(e as Error).message}`)
      return null
    }
  }
}

function toResult(r: Record_): LyricsResult {
  if (r.instrumental === true) return { kind: 'instrumental' }
  if (typeof r.syncedLyrics === 'string') {
    const lines = parseLrc(r.syncedLyrics)
    if (lines.length > 0) return { kind: 'synced', lines }
  }
  return NONE
}
