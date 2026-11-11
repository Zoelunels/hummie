import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Presence, toActivity, type Activity, type RpcClient } from '../src/main/presence'
import type { PlaybackMessage } from '../src/shared/protocol'

const playing = (o: Partial<PlaybackMessage> = {}): PlaybackMessage => ({
  type: 'playback', state: 'playing', title: 'Song', artist: 'Artist', durationSec: 200, positionSec: 10, ...o
})

describe('toActivity', () => {
  it('maps playing to a listening activity with start/end timestamps', () => {
    const a = toActivity(playing(), 1_000_000)!
    expect(a).toMatchObject({ type: 2, details: 'Song', state: 'Artist', largeImageKey: 'ytmusic' })
    expect(a.startTimestamp).toBe(990_000)
    expect(a.endTimestamp).toBe(1_190_000)
  })
  it('uses artwork when present', () => {
    expect(toActivity(playing({ artworkUrl: 'https://x/a.jpg' }), 0)!.largeImageKey).toBe('https://x/a.jpg')
  })
  it('paused has no timestamps and says Paused', () => {
    const a = toActivity(playing({ state: 'paused' }), 0)!
    expect(a.state).toBe('Paused · Artist')
    expect(a.startTimestamp).toBeUndefined()
    expect(a.endTimestamp).toBeUndefined()
  })
  it('stopped or untitled clears', () => {
    expect(toActivity({ type: 'playback', state: 'stopped' }, 0)).toBeNull()
    expect(toActivity({ type: 'playback', state: 'playing' }, 0)).toBeNull()
  })
  it('pads short and truncates long text to Discord limits', () => {
    expect(toActivity(playing({ title: 'a' }), 0)!.details).toHaveLength(2)
    expect(toActivity(playing({ title: 'x'.repeat(200) }), 0)!.details).toHaveLength(128)
  })
})

class Fake implements RpcClient {
  calls: (Activity | 'clear')[] = []
  failConnect = false
  dc?: () => void
  async connect() { if (this.failConnect) throw new Error('no discord') }
  async setActivity(a: Activity) { this.calls.push(a) }
  async clearActivity() { this.calls.push('clear') }
  async destroy() {}
  onDisconnected(cb: () => void) { this.dc = cb }
}

describe('Presence', () => {
  let clients: Fake[]
  let p: Presence
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    clients = []
    p = new Presence(() => { const c = new Fake(); clients.push(c); return c })
  })
  afterEach(async () => { await p.stop(); vi.useRealTimers() })

  it('sends once, and heartbeats with drifting positions do not re-send (no timestamp reset)', async () => {
    p.start()
    await vi.advanceTimersByTimeAsync(10)
    p.update(playing({ positionSec: 10 }))
    await vi.advanceTimersByTimeAsync(2100)
    // 5s later the extension reports position 15 (consistent with real time): no new call.
    await vi.advanceTimersByTimeAsync(5000)
    p.update(playing({ positionSec: 15 }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(clients[0].calls).toHaveLength(1)
  })

  it('re-sends on a seek, track change, and pause', async () => {
    p.start()
    await vi.advanceTimersByTimeAsync(10)
    p.update(playing()); await vi.advanceTimersByTimeAsync(2100)
    p.update(playing({ positionSec: 150 })); await vi.advanceTimersByTimeAsync(2100) // seek
    p.update(playing({ title: 'Next' })); await vi.advanceTimersByTimeAsync(2100)
    p.update(playing({ title: 'Next', state: 'paused' })); await vi.advanceTimersByTimeAsync(2100)
    expect(clients[0].calls).toHaveLength(4)
  })

  it('clears on stop', async () => {
    p.start()
    await vi.advanceTimersByTimeAsync(10)
    p.update(playing()); await vi.advanceTimersByTimeAsync(2100)
    p.update({ type: 'playback', state: 'stopped' }); await vi.advanceTimersByTimeAsync(2100)
    expect(clients[0].calls.at(-1)).toBe('clear')
  })

  it('coalesces bursts to the latest state', async () => {
    p.start()
    await vi.advanceTimersByTimeAsync(10)
    p.update(playing({ title: 'One' })); await vi.advanceTimersByTimeAsync(2100)
    p.update(playing({ title: 'Two' })); p.update(playing({ title: 'Three' }))
    await vi.advanceTimersByTimeAsync(2100)
    expect((clients[0].calls.at(-1) as Activity).details).toBe('Three')
    expect(clients[0].calls).toHaveLength(2)
  })

  it('retries while Discord is closed, then publishes the current song', async () => {
    const orig = (p as any).makeClient
    let first = true
    ;(p as any).makeClient = () => { const c = orig(); if (first) { c.failConnect = true; first = false } return c }
    p.start()
    await vi.advanceTimersByTimeAsync(10)
    p.update(playing())
    await vi.advanceTimersByTimeAsync(5100) // retry fires, connects
    await vi.advanceTimersByTimeAsync(2100)
    expect(p.isConnected).toBe(true)
    expect((clients[1].calls[0] as Activity).details).toBe('Song')
  })

  it('reconnects after Discord restarts and re-sends', async () => {
    p.start()
    await vi.advanceTimersByTimeAsync(10)
    p.update(playing()); await vi.advanceTimersByTimeAsync(2100)
    clients[0].dc!()
    expect(p.isConnected).toBe(false)
    await vi.advanceTimersByTimeAsync(5100)
    await vi.advanceTimersByTimeAsync(2100)
    expect(clients[1].calls).toHaveLength(1)
  })
})

describe('toActivity settings', () => {
  const on = { showArt: true, showProgress: true, hideDetails: false, showLyrics: false, lyricsLeadSec: 1 }
  it('hides title and artist when hideDetails', () => {
    const a = toActivity(playing({ artworkUrl: 'https://x/a.jpg', album: 'Alb' }), 0, { ...on, hideDetails: true })!
    expect(a.details).toBe('Listening to music')
    expect(a.state).toBeUndefined()
    expect(a.largeImageKey).toBe('ytmusic')
    expect(a.largeImageText).toBeUndefined()
  })
  it('drops artwork and timestamps when disabled', () => {
    const a = toActivity(playing({ artworkUrl: 'https://x/a.jpg' }), 0, { ...on, showArt: false, showProgress: false })!
    expect(a.largeImageKey).toBe('ytmusic')
    expect(a.startTimestamp).toBeUndefined()
    expect(a.endTimestamp).toBeUndefined()
  })
})

describe('Presence settings', () => {
  const S = { shareToDiscord: true, showArt: true, showProgress: true, clearWhenPaused: true, hideDetails: false, showLyrics: false, lyricsLeadSec: 1 }
  let clients: Fake[]
  let p: Presence
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    clients = []
    p = new Presence(() => { const c = new Fake(); clients.push(c); return c }, () => {}, Date.now, S)
  })
  afterEach(async () => { await p.stop(); vi.useRealTimers() })

  it('shareToDiscord off clears, and back on re-publishes', async () => {
    p.start(); await vi.advanceTimersByTimeAsync(10)
    p.update(playing()); await vi.advanceTimersByTimeAsync(2100)
    p.setSettings({ ...S, shareToDiscord: false }); await vi.advanceTimersByTimeAsync(2100)
    expect(clients[0].calls.at(-1)).toBe('clear')
    p.setSettings(S); await vi.advanceTimersByTimeAsync(2100)
    expect((clients[0].calls.at(-1) as Activity).details).toBe('Song')
  })

  it('clears after 5 minutes paused, and resumes on play', async () => {
    p.start(); await vi.advanceTimersByTimeAsync(10)
    p.update(playing({ state: 'paused' })); await vi.advanceTimersByTimeAsync(2100)
    expect(clients[0].calls.at(-1)).not.toBe('clear')
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(clients[0].calls.at(-1)).toBe('clear')
    p.update(playing()); await vi.advanceTimersByTimeAsync(2100)
    expect((clients[0].calls.at(-1) as Activity).state).toBe('Artist')
  })

  it('keeps paused presence when clearWhenPaused is off', async () => {
    p.setSettings({ ...S, clearWhenPaused: false })
    p.start(); await vi.advanceTimersByTimeAsync(10)
    p.update(playing({ state: 'paused' })); await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(clients[0].calls.at(-1)).not.toBe('clear')
  })

  it('reports connection status', async () => {
    const seen: string[] = []
    p.onStatus((s) => seen.push(s))
    p.start(); await vi.advanceTimersByTimeAsync(10)
    expect(seen).toEqual(['connecting', 'connected'])
  })
})

describe('lyric line', () => {
  const on = { showArt: true, showProgress: true, hideDetails: false }
  it('replaces the artist while playing, but not when paused or hidden', () => {
    expect(toActivity(playing(), 0, { ...on, lyric: 'a line' })!.state).toBe('a line')
    expect(toActivity(playing({ state: 'paused' }), 0, { ...on, lyric: 'a line' })!.state).toBe('Paused · Artist')
    expect(toActivity(playing(), 0, { ...on, hideDetails: true, lyric: 'a line' })!.state).toBeUndefined()
  })
})

describe('Presence lyric updates', () => {
  const S = { shareToDiscord: true, showArt: true, showProgress: true, clearWhenPaused: true, hideDetails: false, showLyrics: true, lyricsLeadSec: 1 }
  let clients: Fake[]
  let p: Presence
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    clients = []
    p = new Presence(() => { const c = new Fake(); clients.push(c); return c }, () => {}, Date.now, S)
  })
  afterEach(async () => { await p.stop(); vi.useRealTimers() })

  it('shows lyric lines, keeps the progress timestamps fixed, and rate-limits to one per 4s', async () => {
    p.start(); await vi.advanceTimersByTimeAsync(10)
    p.update(playing({ positionSec: 10 })); await vi.advanceTimersByTimeAsync(2100)
    p.setLyricLine('line A'); await vi.advanceTimersByTimeAsync(4100)
    p.setLyricLine('line B'); p.setLyricLine('line C') // burst: latest wins
    await vi.advanceTimersByTimeAsync(4100)
    const states = clients[0].calls.map((c) => (c === 'clear' ? 'clear' : c.state))
    expect(states).toEqual(['Artist', 'line A', 'line C'])
    const starts = clients[0].calls.map((c) => (c === 'clear' ? 0 : c.startTimestamp))
    expect(new Set(starts).size).toBe(1) // timestamps unchanged across lyric refreshes
  })

  it('does not restart the pause countdown when the lyric changes while paused', async () => {
    p.start(); await vi.advanceTimersByTimeAsync(10)
    p.update(playing({ state: 'paused' })); await vi.advanceTimersByTimeAsync(2100)
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    p.setLyricLine('x'); p.setLyricLine(null) // would have restarted the 5 min timer if buggy
    await vi.advanceTimersByTimeAsync(70 * 1000)
    expect(clients[0].calls.at(-1)).toBe('clear')
  })
})

describe('song button', () => {
  const on = { showArt: true, showProgress: true, hideDetails: false }
  const withUrl = (url: string, o = {}) => playing({ url, ...o })
  it('links to a clean watch URL, dropping playlist and time parameters', () => {
    const a = toActivity(withUrl('https://music.youtube.com/watch?v=abc123XYZ_-&list=RDAMVM&t=55'), 0, on)!
    expect(a.buttons).toEqual([
      { label: 'Listen on YouTube Music', url: 'https://music.youtube.com/watch?v=abc123XYZ_-' }
    ])
  })
  it('also shows while paused', () => {
    const a = toActivity(withUrl('https://music.youtube.com/watch?v=abc123XYZ', { state: 'paused' }), 0, on)!
    expect(a.buttons).toHaveLength(1)
  })
  it('is omitted for non-song pages, other hosts, bad ids, and hidden details', () => {
    for (const u of [
      'https://music.youtube.com/',
      'https://evil.example/watch?v=abc123XYZ',
      'http://music.youtube.com/watch?v=abc123XYZ',
      'https://music.youtube.com/watch?v=a b',
      'nonsense'
    ])
      expect(toActivity(withUrl(u), 0, on)!.buttons).toBeUndefined()
    expect(toActivity(playing(), 0, on)!.buttons).toBeUndefined()
    const hidden = toActivity(withUrl('https://music.youtube.com/watch?v=abc123XYZ'), 0, { ...on, hideDetails: true })!
    expect(hidden.buttons).toBeUndefined()
  })
})
