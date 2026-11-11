import { describe, expect, it, vi } from 'vitest'
import { Lrclib, USER_AGENT } from '../src/main/lyrics/lrclib'

const track = { title: 'T', artist: 'A', album: 'Al', durationSec: 200 }
const synced = '[00:01.00] one\n[00:05.00] two'
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

function client(handler: (url: string) => Response | Promise<Response>, now = () => 1_000_000) {
  const f = vi.fn(async (u: string | URL | Request) => handler(String(u)))
  return { lr: new Lrclib(f as unknown as typeof fetch, now), f }
}

describe('Lrclib', () => {
  it('returns synced lines and identifies the client', async () => {
    const { lr, f } = client(() => json({ instrumental: false, syncedLyrics: synced, duration: 200 }))
    const r = await lr.lookup(track)
    expect(r.kind).toBe('synced')
    if (r.kind === 'synced') expect(r.lines.map((l) => l.text)).toEqual(['one', 'two'])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/get?')
    expect(url).toContain('duration=200')
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT)
  })

  it('reports instrumental', async () => {
    const { lr } = client(() => json({ instrumental: true, syncedLyrics: null }))
    expect((await lr.lookup(track)).kind).toBe('instrumental')
  })

  it('treats records without synced lyrics as none', async () => {
    const { lr } = client(() => json({ instrumental: false, syncedLyrics: null, plainLyrics: 'x' }))
    expect((await lr.lookup(track)).kind).toBe('none')
  })

  it('caches results per track (one request only)', async () => {
    const { lr, f } = client(() => json({ syncedLyrics: synced }))
    await lr.lookup(track)
    await lr.lookup({ ...track })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('on 404 falls back to search and picks the closest synced match by length', async () => {
    const { lr, f } = client((u) =>
      u.includes('/api/get?')
        ? json({ statusCode: 404, name: 'TrackNotFound' }, 404)
        : json([
            { duration: 230, syncedLyrics: '[00:01.00] far' },
            { duration: 201.5, syncedLyrics: '[00:01.00] near' },
            { duration: 199, syncedLyrics: null }
          ])
    )
    const r = await lr.lookup(track)
    expect(f).toHaveBeenCalledTimes(2)
    expect(r.kind === 'synced' && r.lines[0].text).toBe('near')
  })

  it('search fallback with nothing close yields none (and is cached)', async () => {
    const { lr, f } = client((u) =>
      u.includes('/api/get?') ? json({}, 404) : json([{ duration: 400, syncedLyrics: '[00:01.00] x' }])
    )
    expect((await lr.lookup(track)).kind).toBe('none')
    await lr.lookup(track)
    expect(f).toHaveBeenCalledTimes(3) // get + structured search + free-text search, then cached
  })

  it('does not trust an instrumental flag when a synced candidate of the same length exists', async () => {
    const { lr } = client((u) =>
      u.includes('/api/get?')
        ? json({ instrumental: true, syncedLyrics: null, duration: 200 })
        : u.includes('q=')
          ? json([{ duration: 201, syncedLyrics: '[00:01.00] real' }])
          : json([{ duration: 200, instrumental: true, syncedLyrics: null }])
    )
    const r = await lr.lookup(track)
    expect(r.kind === 'synced' && r.lines[0].text).toBe('real')
  })

  it('keeps instrumental when no synced candidate exists', async () => {
    const { lr } = client((u) =>
      u.includes('/api/get?') ? json({ instrumental: true, syncedLyrics: null }) : json([])
    )
    expect((await lr.lookup(track)).kind).toBe('instrumental')
  })

  it('backs off after 429 and does not cache the failure', async () => {
    let t = 1_000_000
    let limited = true
    const { lr, f } = client(
      () => (limited ? json({}, 429, { 'retry-after': '10' }) : json({ syncedLyrics: synced })),
      () => t
    )
    expect((await lr.lookup(track)).kind).toBe('error')
    expect((await lr.lookup(track)).kind).toBe('error') // blocked: no request
    expect(f).toHaveBeenCalledTimes(1)
    limited = false
    t += 20_000 // past Retry-After plus up to 30% jitter
    expect((await lr.lookup(track)).kind).toBe('synced')
  })

  it('network errors resolve to error without throwing', async () => {
    const { lr } = client(() => {
      throw new Error('offline')
    })
    expect((await lr.lookup(track)).kind).toBe('error')
  })

  it('omits an out-of-range duration', async () => {
    const { lr, f } = client(() => json({ syncedLyrics: synced }))
    await lr.lookup({ ...track, durationSec: 99999 })
    expect(String(f.mock.calls[0][0])).not.toContain('duration=')
  })
})
