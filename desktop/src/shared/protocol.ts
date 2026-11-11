import { z } from 'zod'
import { SettingsPatch, type AppState } from './app'

export const PROTOCOL_VERSION = 1

const text = z.string().max(256)

/** First message a paired extension sends after connecting. */
export const HelloMessage = z.object({
  type: z.literal('hello'),
  token: z.string().max(256),
  version: z.literal(PROTOCOL_VERSION)
})

/** Sent by an unpaired extension. The user must approve a dialog in the helper before it gets a token. */
export const PairMessage = z.object({
  type: z.literal('pair'),
  version: z.literal(PROTOCOL_VERSION)
})

export const PlaybackMessage = z.object({
  type: z.literal('playback'),
  state: z.enum(['playing', 'paused', 'stopped']),
  title: text.optional(),
  artist: text.optional(),
  album: text.optional(),
  artworkUrl: z.string().url().max(2048).optional(),
  durationSec: z.number().nonnegative().finite().optional(),
  positionSec: z.number().nonnegative().finite().optional(),
  url: z.string().url().max(2048).optional()
})

/** Keepalive: keeps the extension's service worker (and so the socket) from idling out. */
export const PingMessage = z.object({ type: z.literal('ping') })

/** The popup changes settings through the extension. Validated again here: never trust the client. */
export const SetSettingsMessage = z.object({ type: z.literal('set-settings'), patch: SettingsPatch })

/** Rotate the pairing token. The requesting extension receives the new one; other clients are dropped. */
export const RegenerateTokenMessage = z.object({ type: z.literal('regenerate-token') })

export const ClientMessage = z.discriminatedUnion('type', [
  HelloMessage,
  PairMessage,
  PlaybackMessage,
  PingMessage,
  SetSettingsMessage,
  RegenerateTokenMessage
])

export type PlaybackMessage = z.infer<typeof PlaybackMessage>
export type ClientMessage = z.infer<typeof ClientMessage>

/** What the helper sends back to the extension. */
export type ServerMessage =
  | { type: 'ready' }
  | { type: 'pong' }
  | { type: 'state'; state: AppState }
  | { type: 'paired'; token: string }
  | { type: 'pair-denied' }
  | { type: 'token'; token: string }

export const BRIDGE_HOST = '127.0.0.1'
export const BRIDGE_PORT = 17654
export const CLOSE_UNAUTHORIZED = 4401
export const CLOSE_BAD_MESSAGE = 4400
