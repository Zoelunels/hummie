import { DEFAULT_SETTINGS, PAUSE_CLEAR_MS, type DiscordStatus, type Settings } from '../shared/app'
import type { PlaybackMessage } from '../shared/protocol'

/** The slice of the Discord RPC client that Presence depends on (lets tests inject a fake). */
export interface RpcClient {
  connect(): Promise<void>
  setActivity(a: Activity): Promise<unknown>
  clearActivity(): Promise<unknown>
  destroy(): Promise<void>
  onDisconnected(cb: () => void): void
}

export interface Activity {
  type: 2 // Listening
  details: string
  state?: string
  startTimestamp?: number
  endTimestamp?: number
  largeImageKey: string
  largeImageText?: string
  instance: false
}

type ActivityOptions = Pick<Settings, 'showArt' | 'showProgress' | 'hideDetails'> & {
  /** Current lyric line; replaces the artist line while playing. Ignored when details are hidden. */
  lyric?: string | null
}

const LISTENING = 2
const FALLBACK_ART = 'ytmusic'
const SEEK_TOLERANCE_MS = 2500
const MIN_UPDATE_MS = 2000
// Lyric lines change often; keep Discord updates sparser while lyrics are active (rate limits).
const LYRIC_MIN_UPDATE_MS = 4000
const RECONNECT_MS = 5000

/** Discord requires details/state to be 2..128 chars. */
const fit = (s: string) => {
  const t = s.length > 128 ? s.slice(0, 127) + '…' : s
  return t.length < 2 ? t.padEnd(2, ' ') : t
}

/** Pure mapping. Returns null when presence should be cleared. */
export function toActivity(
  m: PlaybackMessage,
  now: number,
  opts: ActivityOptions = DEFAULT_SETTINGS
): Activity | null {
  if (m.state === 'stopped' || !m.title) return null
  const paused = m.state === 'paused'
  const hide = opts.hideDetails
  const base = {
    type: LISTENING,
    details: hide ? 'Listening to music' : fit(m.title),
    largeImageKey: !hide && opts.showArt && m.artworkUrl ? m.artworkUrl : FALLBACK_ART,
    largeImageText: !hide && m.album ? fit(m.album) : undefined,
    instance: false
  } as const
  const artist = hide ? undefined : (m.artist ?? 'Unknown artist')
  if (paused) {
    // Discord has no pause state: omit timestamps so the progress bar disappears.
    return { ...base, state: hide ? 'Paused' : fit(`Paused · ${artist}`) }
  }
  const state = opts.lyric && !hide ? fit(opts.lyric) : artist ? fit(artist) : undefined
  if (!opts.showProgress) return { ...base, state }
  const startTimestamp = Math.round(now - (m.positionSec ?? 0) * 1000)
  const endTimestamp = m.durationSec ? Math.round(startTimestamp + m.durationSec * 1000) : undefined
  return { ...base, state, startTimestamp, endTimestamp }
}

/** True if b is meaningfully different from a (ignores sub-tolerance timestamp jitter). */
function differs(a: Activity | null, b: Activity | null): boolean {
  if (!a || !b) return a !== b
  if (a.details !== b.details || a.state !== b.state || a.largeImageKey !== b.largeImageKey) return true
  if (a.largeImageText !== b.largeImageText) return true
  const off = (x?: number, y?: number) =>
    x === undefined || y === undefined ? x !== y : Math.abs(x - y) > SEEK_TOLERANCE_MS
  return off(a.startTimestamp, b.startTimestamp) || off(a.endTimestamp, b.endTimestamp)
}

export class Presence {
  private desired: Activity | null = null
  private sent: Activity | null = null
  private connected = false
  private connecting = false
  private stopped = false
  private lastSendAt = 0
  private flushTimer?: ReturnType<typeof setTimeout>
  private retryTimer?: ReturnType<typeof setTimeout>
  private pauseTimer?: ReturnType<typeof setTimeout>
  private client?: RpcClient
  private last: PlaybackMessage = { type: 'playback', state: 'stopped' }
  private lastAt = 0 // when `last` was received: keeps timestamps stable across non-playback refreshes
  private lyric: string | null = null
  private pausedExpired = false
  private statusListener: (s: DiscordStatus) => void = () => {}

  constructor(
    private makeClient: () => RpcClient,
    private log: (msg: string) => void = () => {},
    private now: () => number = Date.now,
    private settings: Settings = DEFAULT_SETTINGS
  ) {}

  get isConnected() {
    return this.connected
  }

  onStatus(cb: (s: DiscordStatus) => void): void {
    this.statusListener = cb
  }

  start(): void {
    this.statusListener('connecting')
    void this.connect()
  }

  update(m: PlaybackMessage): void {
    // Only a fresh pause starts the clear-after-pause countdown.
    if (m.state !== 'paused' || this.last.state !== 'paused') this.pausedExpired = false
    this.last = m
    this.lastAt = this.now()
    this.recompute()
  }

  /** Set (or clear with null) the lyric line shown in place of the artist. */
  setLyricLine(line: string | null): void {
    if (line === this.lyric) return
    this.lyric = line
    this.refresh()
  }

  setSettings(s: Settings): void {
    this.settings = s
    this.recompute()
  }

  private recompute(): void {
    clearTimeout(this.pauseTimer)
    this.pauseTimer = undefined
    if (this.last.state === 'paused' && this.settings.clearWhenPaused && !this.pausedExpired) {
      this.pauseTimer = setTimeout(() => {
        this.pausedExpired = true
        this.recompute()
      }, PAUSE_CLEAR_MS)
    }
    this.refresh()
  }

  private refresh(): void {
    const hidden = !this.settings.shareToDiscord || (this.last.state === 'paused' && this.pausedExpired)
    this.desired = hidden ? null : toActivity(this.last, this.lastAt, { ...this.settings, lyric: this.lyric })
    this.schedule()
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.flushTimer)
    clearTimeout(this.retryTimer)
    clearTimeout(this.pauseTimer)
    if (this.client && this.connected) {
      await this.client.clearActivity().catch(() => {})
      await this.client.destroy().catch(() => {})
    }
    this.connected = false
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.connected) return
    this.connecting = true
    const client = this.makeClient()
    client.onDisconnected(() => {
      if (this.client !== client) return
      this.log('discord disconnected')
      this.connected = false
      this.sent = null // new session must be re-sent
      this.statusListener('offline')
      this.retry()
    })
    try {
      await client.connect()
      this.client = client
      this.connected = true
      this.sent = null
      this.log('discord connected')
      this.statusListener('connected')
      this.schedule()
    } catch (e) {
      this.log(`discord unavailable: ${(e as Error).message}`)
      this.statusListener('offline')
      await client.destroy().catch(() => {})
      this.retry()
    } finally {
      this.connecting = false
    }
  }

  private retry(): void {
    if (this.stopped) return
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.connect(), RECONNECT_MS)
  }

  /** Coalesce bursts: latest state wins, at most one send per MIN_UPDATE_MS. */
  private schedule(): void {
    if (!this.connected || this.flushTimer) return
    const gap = this.lyric ? LYRIC_MIN_UPDATE_MS : MIN_UPDATE_MS
    const wait = Math.max(0, this.lastSendAt + gap - this.now())
    this.flushTimer = setTimeout(() => void this.flush(), wait)
  }

  private async flush(): Promise<void> {
    this.flushTimer = undefined
    if (!this.connected || !this.client || !differs(this.sent, this.desired)) return
    const target = this.desired
    this.lastSendAt = this.now()
    try {
      if (target) await this.client.setActivity(target)
      else await this.client.clearActivity()
      this.sent = target
    } catch (e) {
      this.log(`discord update failed: ${(e as Error).message}`)
      this.sent = null
      this.schedule() // retry; if the pipe died, onDisconnected handles reconnect
    }
    if (differs(this.sent, this.desired)) this.schedule()
  }
}
