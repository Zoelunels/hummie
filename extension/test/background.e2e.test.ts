import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Bridge } from '../../desktop/src/main/bridge'
import { DEFAULT_SETTINGS, type AppState } from '../../desktop/src/shared/app'
import type { PlaybackMessage } from '../../desktop/src/shared/protocol'
import type { FromBackground, ToBackground } from '../src/messages'

// Runs the REAL background.ts (with a mocked chrome.* API) against the REAL Bridge, including the
// pairing flow, so the extension and helper protocols are exercised together.
const store: Record<string, unknown> = {}
let onMessage: (m: unknown, sender: unknown) => void
let onRemoved: (id: number) => void
let onConnect: (port: unknown) => void
const noEvent = { addListener: () => {} }

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (k: string) => ({ [k]: store[k] }),
      set: async (o: Record<string, unknown>) => void Object.assign(store, o),
      remove: async (k: string) => void delete store[k]
    },
    onChanged: noEvent
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  alarms: { create: () => {}, onAlarm: noEvent },
  tabs: { onRemoved: { addListener: (f: typeof onRemoved) => (onRemoved = f) } },
  runtime: {
    onMessage: { addListener: (f: typeof onMessage) => (onMessage = f) },
    onConnect: { addListener: (f: typeof onConnect) => (onConnect = f) },
    onStartup: noEvent,
    onInstalled: noEvent
  }
})

function openPopup() {
  const posted: FromBackground[] = []
  const handlers: ((m: ToBackground) => void)[] = []
  onConnect({
    name: 'popup',
    postMessage: (m: FromBackground) => posted.push(m),
    onMessage: { addListener: (f: (m: ToBackground) => void) => handlers.push(f) },
    onDisconnect: { addListener: () => {} }
  })
  return { posted, send: (m: ToBackground) => handlers.forEach((h) => h(m)), last: () => posted.at(-1)! }
}

const got: PlaybackMessage[] = []
let state: AppState
let bridge: Bridge
let allow = true
let token = 'first-token'
const settingsSeen: unknown[] = []

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 150 && !fn(); i++) await new Promise((r) => setTimeout(r, 20))
  expect(fn()).toBe(true)
}
const play = (tab: number, msg: Partial<PlaybackMessage>) =>
  onMessage({ type: 'hummie:playback', msg: { type: 'playback', ...msg } }, { tab: { id: tab } })

beforeAll(async () => {
  state = { playback: null, playbackAt: 0, extension: false, discord: 'connected', lyrics: 'off', settings: DEFAULT_SETTINGS }
  bridge = new Bridge('first-token', 0, {
    getState: () => state,
    requestPairing: async () => allow,
    onSetSettings: (patch) => {
      settingsSeen.push(patch)
      state = { ...state, settings: { ...state.settings, ...patch } }
      bridge.broadcastState(state)
    },
    onRegenerateToken: () => (token = 'second-token')
  })
  bridge.on('playback', (m) => got.push(m))
  const port = await bridge.start()
  ;(globalThis as { __HUMMIE_URL__?: string }).__HUMMIE_URL__ = `ws://127.0.0.1:${port}`
  await import('../src/background')
})
afterAll(() => bridge.stop())

describe('extension <-> helper', () => {
  it('starts unpaired, and a denied pairing stays unpaired', async () => {
    const popup = openPopup()
    await until(() => popup.last().link === 'unpaired')
    expect(store.token).toBeUndefined()

    allow = false
    popup.send({ action: 'pair' })
    await until(() => popup.last().link === 'denied')
    expect(store.token).toBeUndefined()
  })

  it('pairs after the user allows, then shows the helper state', async () => {
    await new Promise((r) => setTimeout(r, 5200)) // the helper blocks pairing for a few seconds after a denial
    allow = true
    const popup = openPopup()
    popup.send({ action: 'pair' })
    await until(() => popup.last().link === 'connected' && popup.last().state !== null)
    expect(store.token).toBe('first-token')
    expect(popup.last().state?.settings).toEqual(DEFAULT_SETTINGS)
  }, 15000)

  it('relays playback, ignores a second tab, and clears when the owning tab closes', async () => {
    await until(() => got.some((m) => m.state === 'stopped')) // resync on connect
    got.length = 0
    play(1, { state: 'playing', title: 'A', artist: 'X' })
    await until(() => got.length === 1)
    expect(got[0]).toMatchObject({ state: 'playing', title: 'A' })
    play(2, { state: 'paused', title: 'B' }) // another tab does not own playback
    play(1, { state: 'paused', title: 'A', artist: 'X' })
    await until(() => got.length === 2)
    expect(got[1].state).toBe('paused')
    onRemoved(1)
    await until(() => got.length === 3)
    expect(got[2].state).toBe('stopped')
  })

  it('popup settings changes reach the helper and come back as new state', async () => {
    const popup = openPopup()
    popup.send({ action: 'set-settings', patch: { showArt: false, lyricsLeadSec: 2 } })
    await until(() => popup.last().state?.settings.showArt === false)
    expect(settingsSeen).toContainEqual({ showArt: false, lyricsLeadSec: 2 })
    expect(popup.last().state?.settings.lyricsLeadSec).toBe(2)
  })

  it('regenerating keeps this browser paired with the new token', async () => {
    const popup = openPopup()
    popup.send({ action: 'regenerate-token' })
    await until(() => store.token === 'second-token')
    expect(popup.last().link).toBe('connected')
  })
})
