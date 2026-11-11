import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { Bridge, type BridgeHooks } from '../src/main/bridge'
import { DEFAULT_SETTINGS, type AppState } from '../src/shared/app'

const state: AppState = {
  playback: null,
  playbackAt: 0,
  extension: false,
  discord: 'connected',
  lyrics: 'off',
  settings: DEFAULT_SETTINGS
}

let bridge: Bridge
let port: number
let now = 1_000_000

async function setup(hooks: BridgeHooks, timeouts?: { hello?: number; pair?: number }) {
  bridge = new Bridge('secret', 0, hooks, () => now, timeouts)
  port = await bridge.start()
}
afterEach(() => bridge.stop())

function connect(origin = 'chrome-extension://abc') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: origin } })
  const messages: Record<string, unknown>[] = []
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)))
  const opened = new Promise<void>((r, j) => {
    ws.on('open', () => r())
    ws.on('error', j)
  })
  return { ws, messages, closed, opened }
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms))
const send = (ws: WebSocket, m: unknown) => ws.send(JSON.stringify(m))
const pair = { type: 'pair', version: 1 }
const hello = (token = 'secret') => ({ type: 'hello', token, version: 1 })

describe('pairing', () => {
  it('hands out the token only after the user allows, and tells the dialog who asked', async () => {
    const requestPairing = vi.fn(async () => true)
    await setup({ requestPairing })
    const c = connect('chrome-extension://abc')
    await c.opened
    send(c.ws, pair)
    expect(await c.closed).toBe(1000)
    expect(requestPairing).toHaveBeenCalledWith('chrome-extension://abc')
    expect(c.messages).toEqual([{ type: 'paired', token: 'secret' }])
  })

  it('denies, sends no token, and blocks immediate retries', async () => {
    const requestPairing = vi.fn(async () => false)
    await setup({ requestPairing })
    const a = connect()
    await a.opened
    send(a.ws, pair)
    await a.closed
    expect(a.messages).toEqual([{ type: 'pair-denied' }])

    const b = connect()
    await b.opened
    send(b.ws, pair) // inside the cooldown: not even asked
    await b.closed
    expect(requestPairing).toHaveBeenCalledTimes(1)
    expect(b.messages).toEqual([{ type: 'pair-denied' }])

    now += 6000 // cooldown over
    const c = connect()
    await c.opened
    send(c.ws, pair)
    await c.closed
    expect(requestPairing).toHaveBeenCalledTimes(2)
  })

  it('only one pairing dialog at a time', async () => {
    let release!: (v: boolean) => void
    const requestPairing = vi.fn(() => new Promise<boolean>((r) => (release = r)))
    await setup({ requestPairing })
    const a = connect()
    const b = connect()
    await Promise.all([a.opened, b.opened])
    send(a.ws, pair)
    await tick()
    send(b.ws, pair)
    await b.closed
    expect(b.messages).toEqual([{ type: 'pair-denied' }])
    release(true)
    await a.closed
    expect(a.messages).toEqual([{ type: 'paired', token: 'secret' }])
  })

  it('without a pairing handler, pairing is refused', async () => {
    await setup({})
    const c = connect()
    await c.opened
    send(c.ws, pair)
    await c.closed
    expect(c.messages).toEqual([{ type: 'pair-denied' }])
  })

  it('a pending consent dialog is not cut off by the short hello timeout, but has its own limit', async () => {
    let release!: (v: boolean) => void
    await setup({ requestPairing: () => new Promise<boolean>((r) => (release = r)) }, { hello: 60, pair: 400 })
    const c = connect()
    await c.opened
    send(c.ws, pair)
    await tick(200) // well past the hello timeout
    expect(c.ws.readyState).toBe(WebSocket.OPEN)
    expect(await c.closed).toBe(4401) // the pairing timeout finally ends it
    release(false)
  })
})

describe('state and commands', () => {
  it('sends the current state right after a successful hello', async () => {
    await setup({ getState: () => state })
    const c = connect()
    await c.opened
    send(c.ws, hello())
    await tick()
    expect(c.messages.map((m) => m.type)).toEqual(['ready', 'state'])
  })

  it('broadcasts state to paired clients only', async () => {
    await setup({ getState: () => state })
    const paired = connect()
    const stranger = connect()
    await Promise.all([paired.opened, stranger.opened])
    send(paired.ws, hello())
    await tick()
    bridge.broadcastState({ ...state, discord: 'offline' })
    await tick()
    expect(paired.messages.at(-1)).toMatchObject({ type: 'state', state: { discord: 'offline' } })
    expect(stranger.messages).toEqual([])
  })

  it('applies a valid settings patch and rejects an invalid one', async () => {
    const onSetSettings = vi.fn()
    await setup({ onSetSettings })
    const c = connect()
    await c.opened
    send(c.ws, hello())
    await tick()
    send(c.ws, { type: 'set-settings', patch: { showArt: false, lyricsLeadSec: 2 } })
    await tick()
    expect(onSetSettings).toHaveBeenCalledWith({ showArt: false, lyricsLeadSec: 2 })
    send(c.ws, { type: 'set-settings', patch: { evil: true } })
    expect(await c.closed).toBe(4400)
    expect(onSetSettings).toHaveBeenCalledTimes(1)
  })

  it('ignores commands from unauthenticated clients', async () => {
    const onSetSettings = vi.fn()
    await setup({ onSetSettings })
    const c = connect()
    await c.opened
    send(c.ws, { type: 'set-settings', patch: { showArt: false } })
    expect(await c.closed).toBe(4401)
    expect(onSetSettings).not.toHaveBeenCalled()
  })

  it('regenerating hands the new token to the requester and drops everyone else', async () => {
    await setup({ onRegenerateToken: () => 'fresh' })
    const me = connect()
    const other = connect()
    await Promise.all([me.opened, other.opened])
    send(me.ws, hello())
    send(other.ws, hello())
    await tick()
    send(me.ws, { type: 'regenerate-token' })
    expect(await other.closed).toBe(4401)
    await tick()
    expect(me.messages.at(-1)).toEqual({ type: 'token', token: 'fresh' })
    expect(me.ws.readyState).toBe(WebSocket.OPEN)

    const again = connect() // the old token no longer works
    await again.opened
    send(again.ws, hello('secret'))
    expect(await again.closed).toBe(4401)
    const fine = connect()
    await fine.opened
    send(fine.ws, hello('fresh'))
    await tick()
    expect(fine.messages[0]).toEqual({ type: 'ready' })
  })
})
