import { z } from 'zod'
import type { PlaybackMessage } from './protocol'

export const Settings = z.object({
  shareToDiscord: z.boolean(),
  showArt: z.boolean(),
  showProgress: z.boolean(),
  clearWhenPaused: z.boolean(), // clear Discord activity after PAUSE_CLEAR_MS paused
  hideDetails: z.boolean(), // show "Listening to music" instead of title/artist
  showLyrics: z.boolean(), // look up synced lyrics on LRCLIB (sends title/artist/length off-device)
  lyricsLeadSec: z.number().min(0).max(5), // how early lyric lines are shown, to offset Discord delay
  showButton: z.boolean() // "Listen on YouTube Music" button on the Discord activity
})
export type Settings = z.infer<typeof Settings>
export const SettingsPatch = Settings.partial().strict()

export const DEFAULT_SETTINGS: Settings = {
  shareToDiscord: true,
  showArt: true,
  showProgress: true,
  clearWhenPaused: true,
  hideDetails: false,
  showLyrics: false,
  lyricsLeadSec: 1,
  showButton: true
}

export const PAUSE_CLEAR_MS = 5 * 60 * 1000

export type DiscordStatus = 'disabled' | 'connecting' | 'connected' | 'offline'
export type LyricsStatus = 'off' | 'searching' | 'synced' | 'instrumental' | 'none' | 'error'

export interface AppState {
  playback: PlaybackMessage | null
  /** Date.now() when `playback` was received (lets the UI advance the progress bar). */
  playbackAt: number
  extension: boolean
  discord: DiscordStatus
  lyrics: LyricsStatus
  settings: Settings
}

