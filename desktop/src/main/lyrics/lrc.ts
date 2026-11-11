export interface LrcLine {
  /** Start time in seconds. */
  time: number
  text: string
}

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

/** Parse LRC text ("[mm:ss.xx] line"). Metadata tags such as [ar:...] are ignored. */
export function parseLrc(src: string): LrcLine[] {
  const lines: LrcLine[] = []
  for (const raw of src.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(STAMP)]
    if (stamps.length === 0) continue
    const text = raw.replace(STAMP, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0
      lines.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** The line being sung at `pos` seconds, or null before the first line / during blank lines. */
export function lineAt(lines: LrcLine[], pos: number): string | null {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= pos) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (found < 0) return null
  return lines[found].text || null
}
