import type { PlaybackMessage } from '../../desktop/src/shared/protocol'

export interface Inputs {
  /** From navigator.mediaSession.metadata, if present. */
  meta: { title: string; artist: string; album: string; artwork: { src: string }[] } | null
  /** Fallback text read from the player bar DOM. */
  domTitle: string | null
  domArtist: string | null
  video: { paused: boolean; ended: boolean; currentTime: number; duration: number } | null
  /**
   * Position/length as the player UI shows them ("0:39 / 6:08"). Preferred over `video.currentTime`,
   * which can keep counting across tracks and so would not reset when a new song starts.
   */
  uiTime?: { position: number; duration: number } | null
  url: string
}

const clip = (s: string | null | undefined, n = 256) => {
  const t = (s ?? '').trim()
  return t ? t.slice(0, n) : undefined
}

const finite = (n: number) => (Number.isFinite(n) && n >= 0 ? n : undefined)

/** Pure: turn raw page observations into the protocol message. */
export function buildSnapshot(i: Inputs): PlaybackMessage {
  const title = clip(i.meta?.title) ?? clip(i.domTitle)
  if (!i.video || i.video.ended || !title) return { type: 'playback', state: 'stopped' }

  const { artist, album } = splitArtist(clip(i.meta?.artist) ?? clip(i.domArtist), clip(i.meta?.album))
  const art = i.meta?.artwork?.at(-1)?.src
  const artworkUrl = art && /^https:\/\//.test(art) && art.length <= 2048 ? art : undefined

  return {
    type: 'playback',
    state: i.video.paused ? 'paused' : 'playing',
    title,
    artist,
    album,
    artworkUrl,
    durationSec: finite(i.uiTime?.duration ?? i.video.duration),
    positionSec: finite(i.uiTime?.position ?? i.video.currentTime),
    url: i.url.length <= 2048 ? i.url : undefined
  }
}

/**
 * YouTube Music often puts "Artist • Album • Year" in the artist field. Keep only the artist, and use
 * the middle part as the album when there isn't a separate one.
 */
export function splitArtist(
  raw: string | undefined,
  album: string | undefined
): { artist?: string; album?: string } {
  if (!raw) return { artist: undefined, album }
  const parts = raw
    .split(/\s+[•·]\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const fromText = parts.length >= 2 && !/^\d{4}$/.test(parts[1]) ? parts[1] : undefined
  return { artist: parts[0]?.slice(0, 256), album: album ?? fromText }
}

/** Identity of what the desktop app cares about; position excluded so ticks don't spam. */
export function signature(m: PlaybackMessage): string {
  return [m.state, m.title, m.artist, m.album, m.durationSec ? Math.round(m.durationSec) : ''].join('|')
}

/**
 * True when the real position no longer matches where the desktop app would have counted to
 * from the last report (loop, replay, seek without an event). Seconds of tolerance.
 */
export function isDrifted(sentPos: number, sentAt: number, pos: number | undefined, now: number, tol = 2): boolean {
  if (pos === undefined) return false
  return Math.abs(sentPos + (now - sentAt) / 1000 - pos) > tol
}

const toSeconds = (t: string): number =>
  t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)

/** Parse the player bar's "1:23 / 4:56" (or "1:02:03 / 1:30:00") text. */
export function parseTimeInfo(text: string | null | undefined): { position: number; duration: number } | null {
  const m = text?.match(/(\d+(?::\d{2}){1,2})\s*\/\s*(\d+(?::\d{2}){1,2})/)
  if (!m) return null
  const position = toSeconds(m[1])
  const duration = toSeconds(m[2])
  return Number.isFinite(position) && Number.isFinite(duration) && duration > 0 ? { position, duration } : null
}
