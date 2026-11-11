import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LyricsController } from '../src/main/lyrics/controller'
import type { LyricsResult } from '../src/main/lyrics/lrclib'
import type { LyricsStatus } from '../src/shared/app'
import type { PlaybackMessage } from '../src/shared/protocol'

const synced: LyricsResult = {
  kind: 'synced',
  lines: [
    { time: 2, text: 'one' },
    { time: 6, text: 'two' },
    { time: 10, text: '' }
  ]
}
const msg = (o: Partial<PlaybackMessage> = {}): PlaybackMessage => ({
  type: 'playback', state: 'playing', title: 'T', artist: 'A', durationSec: 200, positionSec: 0, ...o
})

describe('LyricsController', () => {
  let lines: (string | null)[]
  let statuses: LyricsStatus[]
  let lookup: ReturnType<typeof vi.fn>
  let c: LyricsController

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    lines = []
    statuses = []
    lookup = vi.fn(async () => synced)
    c = new LyricsController({
      lookup: lookup as never,
      onLine: (l) => lines.push(l),
      onStatus: (s) => statuses.push(s)
    })
  })
  afterEach(() => { c.stop(); vi.useRealTimers() })

  it('does nothing while disabled (no lookup, no status change)', async () => {
    c.update(msg())
    await vi.advanceTimersByTimeAsync(3000)
    expect(lookup).not.toHaveBeenCalled()
    expect(lines).toEqual([])
  })

  it('looks up once per track and follows the position', async () => {
    c.setEnabled(true)
    c.update(msg())
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses).toEqual(['none', 'searching', 'synced'])
    await vi.advanceTimersByTimeAsync(2000) // 2.1s in (+0.5 lead): line one
    expect(lines.at(-1)).toBe('one')
    await vi.advanceTimersByTimeAsync(4000) // ~6.1s: line two
    expect(lines.at(-1)).toBe('two')
    await vi.advanceTimersByTimeAsync(4000) // blank line clears
    expect(lines.at(-1)).toBeNull()
    c.update(msg({ positionSec: 7 })) // same track: no second lookup
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('clears the line on pause and resumes on play', async () => {
    c.setEnabled(true)
    c.update(msg({ positionSec: 3 }))
    await vi.advanceTimersByTimeAsync(700)
    expect(lines.at(-1)).toBe('one')
    c.update(msg({ state: 'paused', positionSec: 3 }))
    expect(lines.at(-1)).toBeNull()
    c.update(msg({ positionSec: 7 }))
    await vi.advanceTimersByTimeAsync(10)
    expect(lines.at(-1)).toBe('two')
  })

  it('ignores a stale lookup when the track changes', async () => {
    let resolveFirst!: (r: LyricsResult) => void
    lookup.mockImplementationOnce(() => new Promise<LyricsResult>((r) => (resolveFirst = r)))
    c.setEnabled(true)
    c.update(msg({ title: 'First' }))
    c.update(msg({ title: 'Second' })) // second lookup returns synced immediately
    await vi.advanceTimersByTimeAsync(10)
    resolveFirst({ kind: 'instrumental' }) // late answer for the first track
    await vi.advanceTimersByTimeAsync(10)
    expect(statuses.at(-1)).toBe('synced')
  })

  it('reports instrumental and none without emitting lines', async () => {
    lookup.mockResolvedValueOnce({ kind: 'instrumental' })
    c.setEnabled(true)
    c.update(msg())
    await vi.advanceTimersByTimeAsync(2000)
    expect(statuses.at(-1)).toBe('instrumental')
    expect(lines.filter((l) => l !== null)).toEqual([])
  })

  it('turning off clears the line and status; no artist means no lookup', async () => {
    c.setEnabled(true)
    c.update(msg({ positionSec: 3 }))
    await vi.advanceTimersByTimeAsync(700)
    c.setEnabled(false)
    expect(lines.at(-1)).toBeNull()
    expect(statuses.at(-1)).toBe('off')
    c.setEnabled(true) // re-enabling looks the current track up again (the client caches)
    const before = lookup.mock.calls.length
    c.update(msg({ artist: undefined, title: 'Other' }))
    expect(statuses.at(-1)).toBe('none')
    expect(lookup.mock.calls.length).toBe(before) // no artist: nothing to look up
  })

  it('a larger lead shows the next line earlier', async () => {
    const early = new LyricsController({
      lookup: lookup as never,
      lead: () => 3,
      onLine: (l) => lines.push(l),
      onStatus: () => {}
    })
    early.setEnabled(true)
    early.update(msg({ positionSec: 3.2 })) // 3.2 + 3 lead = 6.2s: already line two
    await vi.advanceTimersByTimeAsync(10)
    expect(lines.at(-1)).toBe('two')
    early.stop()
  })

  it('stopping playback clears the line', async () => {
    c.setEnabled(true)
    c.update(msg({ positionSec: 3 }))
    await vi.advanceTimersByTimeAsync(700)
    c.update(null)
    expect(lines.at(-1)).toBeNull()
  })
})
