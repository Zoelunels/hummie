import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { Bridge } from '../src/main/bridge'

let bridge: Bridge
let port: number

beforeEach(async () => {
  bridge = new Bridge('secret-token', 0)
  port = await bridge.start()
})
afterEach(() => bridge.stop())

function connect(headers?: Record<string, string>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers })
  const messages: unknown[] = []
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)))
  const opened = new Promise<void>((r, j) => {
    ws.on('open', () => r())
    ws.on('error', j)
  })
  return { ws, messages, closed, opened }
}
const tick = () => new Promise((r) => setTimeout(r, 50))
const hello = (token: string) => JSON.stringify({ type: 'hello', token, version: 1 })

describe('Bridge', () => {
  it('accepts a valid hello and forwards playback', async () => {
    const got: unknown[] = []
    bridge.on('playback', (m) => got.push(m))
    const c = connect()
    await c.opened
    c.ws.send(hello('secret-token'))
    await tick()
    expect(c.messages).toEqual([{ type: 'ready' }])
    c.ws.send(JSON.stringify({ type: 'playback', state: 'playing', title: 'Song', artist: 'Artist' }))
    await tick()
    expect(got).toEqual([{ type: 'playback', state: 'playing', title: 'Song', artist: 'Artist' }])
    c.ws.close()
  })

  it('answers ping with pong once authenticated', async () => {
    const c = connect()
    await c.opened
    c.ws.send(hello('secret-token'))
    await tick()
    c.ws.send(JSON.stringify({ type: 'ping' }))
    await tick()
    expect(c.messages).toEqual([{ type: 'ready' }, { type: 'pong' }])
    c.ws.close()
  })

  it('rejects ping before hello with 4401', async () => {
    const c = connect()
    await c.opened
    c.ws.send(JSON.stringify({ type: 'ping' }))
    expect(await c.closed).toBe(4401)
  })

  it('rejects a wrong token with 4401', async () => {
    const c = connect()
    await c.opened
    c.ws.send(hello('nope'))
    expect(await c.closed).toBe(4401)
  })

  it('rejects playback before hello and does not emit', async () => {
    const got: unknown[] = []
    bridge.on('playback', (m) => got.push(m))
    const c = connect()
    await c.opened
    c.ws.send(JSON.stringify({ type: 'playback', state: 'playing', title: 'x' }))
    expect(await c.closed).toBe(4401)
    expect(got).toEqual([])
  })

  it('rejects malformed messages with 4400', async () => {
    const c = connect()
    await c.opened
    c.ws.send('not json')
    expect(await c.closed).toBe(4400)
  })

  it('rejects connections from web page origins', async () => {
    const c = connect({ Origin: 'https://evil.example' })
    await expect(c.opened).rejects.toBeDefined()
  })

  it('reports client count', async () => {
    const counts: number[] = []
    bridge.on('clientCount', (n) => counts.push(n))
    const c = connect()
    await c.opened
    c.ws.send(hello('secret-token'))
    await tick()
    c.ws.close()
    await c.closed
    await tick()
    expect(counts).toEqual([1, 0])
  })
})
