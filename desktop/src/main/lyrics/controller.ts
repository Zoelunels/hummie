import type { LyricsStatus } from '../../shared/app'
import type { PlaybackMessage } from '../../shared/protocol'
import { lineAt, type LrcLine } from './lrc'
import type { LyricsResult, Track } from './lrclib'

const TICK_MS = 500
// Default lead when none is configured.
const LEAD_SEC = 0.5

export interface LyricsDeps {
  /** Seconds to show a line early (Discord shows updates a moment after they are sent). */
  lead?: () => number
  lookup: (t: Track) => Promise<LyricsResult>
  onLine: (line: string | null) => void
  onStatus: (s: LyricsStatus) => void
  now?: () => number
}

/** Follows playback, fetches lyrics once per track, and emits the line for the current position. */
export class LyricsController {
  private enabled = false
  private key = ''
  private seq = 0
  private lines: LrcLine[] | null = null
  private playback: PlaybackMessage | null = null
  private receivedAt = 0
  private timer?: ReturnType<typeof setInterval>
  private emitted: string | null = null
  private status: LyricsStatus = 'off'
  private now: () => number

  constructor(private deps: LyricsDeps) {
    this.now = deps.now ?? Date.now
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    if (!on) {
      this.reset()
      this.setStatus('off')
      return
    }
    this.setStatus('none')
    if (this.playback) this.startLookup(this.playback)
  }

  /** Call on every playback message (null when the extension disconnects). */
  update(m: PlaybackMessage | null): void {
    this.playback = m && m.state !== 'stopped' ? m : null
    this.receivedAt = this.now()
    if (!this.enabled) return
    if (!this.playback) {
      this.reset()
      this.setStatus('none')
      return
    }
    const key = trackKey(this.playback)
    if (key !== this.key) this.startLookup(this.playback)
    this.sync()
  }

  stop(): void {
    this.reset()
  }

  private startLookup(m: PlaybackMessage): void {
    const track = toTrack(m)
    this.key = trackKey(m)
    this.lines = null
    this.emit(null)
    if (!track) {
      this.setStatus('none')
      return
    }
    this.setStatus('searching')
    const mine = ++this.seq
    void this.deps.lookup(track).then((r) => {
      if (mine !== this.seq || !this.enabled) return // stale: track changed or feature turned off
      if (r.kind === 'synced') {
        this.lines = r.lines
        this.setStatus('synced')
        this.sync()
      } else this.setStatus(r.kind) // instrumental | none | error
    })
  }

  /** Start/stop the position timer to match whether a synced line should be showing. */
  private sync(): void {
    const active = this.enabled && !!this.lines && this.playback?.state === 'playing'
    if (active && !this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS)
      this.tick()
    } else if (!active) {
      if (this.timer) clearInterval(this.timer)
      this.timer = undefined
      this.emit(null)
    }
  }

  private tick(): void {
    const m = this.playback
    if (!m || !this.lines) return
    const lead = this.deps.lead ? this.deps.lead() : LEAD_SEC
    const pos = (m.positionSec ?? 0) + (this.now() - this.receivedAt) / 1000 + lead
    this.emit(lineAt(this.lines, pos))
  }

  private reset(): void {
    this.seq++ // invalidate any in-flight lookup
    this.key = ''
    this.lines = null
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.emit(null)
  }

  private emit(line: string | null): void {
    if (line === this.emitted) return
    this.emitted = line
    this.deps.onLine(line)
  }

  private setStatus(s: LyricsStatus): void {
    if (s === this.status) return
    this.status = s
    this.deps.onStatus(s)
  }
}

const trackKey = (m: PlaybackMessage) =>
  [m.title, m.artist, m.album, m.durationSec ? Math.round(m.durationSec) : ''].join('|')

function toTrack(m: PlaybackMessage): Track | null {
  if (!m.title || !m.artist) return null
  return { title: m.title, artist: m.artist, album: m.album, durationSec: m.durationSec }
}
