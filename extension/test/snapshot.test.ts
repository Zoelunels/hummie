import { describe, expect, it } from 'vitest'
import { buildSnapshot, isDrifted, parseTimeInfo, signature, splitArtist, type Inputs } from '../src/snapshot'

const base: Inputs = {
  meta: { title: 'Song', artist: 'Artist', album: 'Album', artwork: [{ src: 'https://x/small' }, { src: 'https://x/big' }] },
  domTitle: null,
  domArtist: null,
  video: { paused: false, ended: false, currentTime: 12.5, duration: 200 },
  url: 'https://music.youtube.com/watch?v=abc'
}

describe('buildSnapshot', () => {
  it('reports playing with metadata and largest artwork', () => {
    expect(buildSnapshot(base)).toMatchObject({
      state: 'playing', title: 'Song', artist: 'Artist', album: 'Album',
      artworkUrl: 'https://x/big', durationSec: 200, positionSec: 12.5
    })
  })
  it('reports paused', () => {
    expect(buildSnapshot({ ...base, video: { ...base.video!, paused: true } }).state).toBe('paused')
  })
  it('stopped when no video, ended, or no title', () => {
    expect(buildSnapshot({ ...base, video: null })).toEqual({ type: 'playback', state: 'stopped' })
    expect(buildSnapshot({ ...base, video: { ...base.video!, ended: true } }).state).toBe('stopped')
    expect(buildSnapshot({ ...base, meta: null }).state).toBe('stopped')
  })
  it('falls back to DOM text', () => {
    const m = buildSnapshot({ ...base, meta: null, domTitle: ' Dom Song ', domArtist: 'Dom Artist' })
    expect(m).toMatchObject({ state: 'playing', title: 'Dom Song', artist: 'Dom Artist' })
  })
  it('drops non-finite duration (live streams) and non-https artwork', () => {
    const m = buildSnapshot({
      ...base,
      meta: { ...base.meta!, artwork: [{ src: 'http://x/a' }] },
      video: { ...base.video!, duration: Infinity }
    })
    expect(m.durationSec).toBeUndefined()
    expect(m.artworkUrl).toBeUndefined()
  })
})

describe('signature', () => {
  it('ignores position, changes with state or track', () => {
    const a = buildSnapshot(base)
    const b = buildSnapshot({ ...base, video: { ...base.video!, currentTime: 99 } })
    expect(signature(a)).toBe(signature(b))
    expect(signature(a)).not.toBe(signature(buildSnapshot({ ...base, video: { ...base.video!, paused: true } })))
  })
})

describe('isDrifted', () => {
  it('is false when position keeps pace with real time', () => {
    expect(isDrifted(10, 1000, 15, 6000)).toBe(false)
  })
  it('is true after a loop or seek', () => {
    expect(isDrifted(268, 1000, 3, 6000)).toBe(true) // restarted track
    expect(isDrifted(10, 1000, 120, 6000)).toBe(true) // jumped ahead
  })
  it('ignores unknown positions', () => {
    expect(isDrifted(10, 1000, undefined, 6000)).toBe(false)
  })
})

describe('parseTimeInfo', () => {
  it('parses m:ss / m:ss with surrounding whitespace', () => {
    expect(parseTimeInfo(' 0:39 / 6:08 ')).toEqual({ position: 39, duration: 368 })
    expect(parseTimeInfo('1:02:03 / 1:30:00')).toEqual({ position: 3723, duration: 5400 })
  })
  it('returns null for junk', () => {
    expect(parseTimeInfo(null)).toBeNull()
    expect(parseTimeInfo('')).toBeNull()
    expect(parseTimeInfo('no times here')).toBeNull()
    expect(parseTimeInfo('0:10 / 0:00')).toBeNull()
  })
})

describe('buildSnapshot uses the player UI time when present', () => {
  it('prefers UI position over a video clock that kept counting across tracks', () => {
    const m = buildSnapshot({
      ...base,
      video: { ...base.video!, currentTime: 268.4, duration: 368 }, // stale: previous track's time carried over
      uiTime: { position: 39, duration: 368 }
    })
    expect(m.positionSec).toBe(39)
    expect(m.durationSec).toBe(368)
  })
  it('falls back to the video clock without UI time', () => {
    expect(buildSnapshot(base).positionSec).toBe(12.5)
  })
})

describe('splitArtist', () => {
  it('keeps just the artist from "Artist • Album • Year" and uses the album when none is given', () => {
    expect(splitArtist('Doja Cat • Planet Her • 2021', undefined)).toEqual({ artist: 'Doja Cat', album: 'Planet Her' })
    expect(splitArtist('Doja Cat • Planet Her • 2021', 'Real Album')).toEqual({ artist: 'Doja Cat', album: 'Real Album' })
  })
  it('does not treat a year as an album, and leaves plain artists alone', () => {
    expect(splitArtist('Someone • 2021', undefined)).toEqual({ artist: 'Someone', album: undefined })
    expect(splitArtist('Calvin Harris', 'Funk Wav Bounces Vol.1')).toEqual({
      artist: 'Calvin Harris',
      album: 'Funk Wav Bounces Vol.1'
    })
    expect(splitArtist(undefined, 'X')).toEqual({ artist: undefined, album: 'X' })
  })
  it('flows through buildSnapshot', () => {
    const m = buildSnapshot({ ...base, meta: { ...base.meta!, artist: 'Doja Cat • Planet Her • 2021', album: '' } })
    expect(m.artist).toBe('Doja Cat')
    expect(m.album).toBe('Planet Her')
  })
})
