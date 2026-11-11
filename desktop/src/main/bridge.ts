import { EventEmitter } from 'node:events'
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AppState, Settings } from '../shared/app'
import {
  BRIDGE_HOST,
  CLOSE_BAD_MESSAGE,
  CLOSE_UNAUTHORIZED,
  ClientMessage,
  type PlaybackMessage,
  type ServerMessage
} from '../shared/protocol'

export interface BridgeEvents {
  playback: [PlaybackMessage]
  clientCount: [number]
}

/** What the surrounding app provides. All optional so the bridge can be tested alone. */
export interface BridgeHooks {
  /** Ask the user whether this extension may pair. Resolve true to hand out the token. */
  requestPairing?: (origin: string | undefined) => Promise<boolean>
  onSetSettings?: (patch: Partial<Settings>) => void
  /** Create and persist a new token; return it. */
  onRegenerateToken?: () => string
  getState?: () => AppState
}

const HELLO_TIMEOUT_MS = 5000
const PAIR_TIMEOUT_MS = 90_000 // time the user has to answer the consent dialog
const PAIR_COOLDOWN_MS = 5000 // after a denial, ignore pairing requests for a while

export class Bridge extends EventEmitter<BridgeEvents> {
  private wss?: WebSocketServer
  private authed = new Set<WebSocket>()
  private pairing = false
  private pairBlockedUntil = 0

  constructor(
    private token: string,
    private port: number,
    private hooks: BridgeHooks = {},
    private now: () => number = Date.now,
    private timeouts: { hello?: number; pair?: number } = {}
  ) {
    super()
  }

  get clientCount(): number {
    return this.authed.size
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: BRIDGE_HOST,
        port: this.port,
        maxPayload: 16 * 1024,
        // Extensions connect with a non-http(s) origin; reject ordinary web pages
        // trying to reach localhost.
        verifyClient: ({ origin }: { origin: string }) => !origin || !/^https?:/i.test(origin)
      })
      this.wss = wss
      wss.once('error', reject)
      wss.once('listening', () => {
        wss.off('error', reject)
        resolve((wss.address() as { port: number }).port)
      })
      wss.on('connection', (ws, req) => this.onConnection(ws, req))
    })
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const origin = req.headers.origin
    // Must authenticate (or ask to pair) within 5s.
    let timer = setTimeout(
      () => ws.close(CLOSE_UNAUTHORIZED, 'hello timeout'),
      this.timeouts.hello ?? HELLO_TIMEOUT_MS
    )
    ws.on('close', () => {
      clearTimeout(timer)
      if (this.authed.delete(ws)) this.emit('clientCount', this.authed.size)
    })
    ws.on('message', (data) => {
      let msg: ClientMessage
      try {
        msg = ClientMessage.parse(JSON.parse(data.toString()))
      } catch {
        ws.close(CLOSE_BAD_MESSAGE, 'invalid message')
        return
      }

      if (msg.type === 'hello') {
        if (!this.tokenMatches(msg.token)) {
          ws.close(CLOSE_UNAUTHORIZED, 'bad token')
          return
        }
        clearTimeout(timer)
        this.authed.add(ws)
        this.send(ws, { type: 'ready' })
        if (this.hooks.getState) this.send(ws, { type: 'state', state: this.hooks.getState() })
        this.emit('clientCount', this.authed.size)
        return
      }

      if (msg.type === 'pair') {
        clearTimeout(timer)
        timer = setTimeout(
          () => ws.close(CLOSE_UNAUTHORIZED, 'pairing timeout'),
          this.timeouts.pair ?? PAIR_TIMEOUT_MS
        )
        void this.handlePair(ws, origin)
        return
      }

      if (!this.authed.has(ws)) {
        ws.close(CLOSE_UNAUTHORIZED, 'not authenticated')
        return
      }

      switch (msg.type) {
        case 'ping':
          this.send(ws, { type: 'pong' })
          return
        case 'set-settings':
          this.hooks.onSetSettings?.(msg.patch)
          return
        case 'regenerate-token': {
          const next = this.hooks.onRegenerateToken?.()
          if (!next) return
          this.token = next
          this.send(ws, { type: 'token', token: next })
          // Everyone else holds the old token and must pair again.
          for (const c of this.wss?.clients ?? []) if (c !== ws) c.close(CLOSE_UNAUTHORIZED, 'token rotated')
          return
        }
        default:
          this.emit('playback', msg)
      }
    })
  }

  private async handlePair(ws: WebSocket, origin: string | undefined): Promise<void> {
    if (this.pairing || this.now() < this.pairBlockedUntil || !this.hooks.requestPairing) {
      this.send(ws, { type: 'pair-denied' })
      ws.close(1000, 'pairing unavailable')
      return
    }
    this.pairing = true
    let allowed = false
    try {
      allowed = await this.hooks.requestPairing(origin)
    } catch {
      allowed = false
    } finally {
      this.pairing = false
    }
    if (allowed) this.send(ws, { type: 'paired', token: this.token })
    else {
      this.pairBlockedUntil = this.now() + PAIR_COOLDOWN_MS
      this.send(ws, { type: 'pair-denied' })
    }
    ws.close(1000, allowed ? 'paired' : 'denied')
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  /** Push the latest app state to every paired extension. */
  broadcastState(state: AppState): void {
    for (const ws of this.authed) this.send(ws, { type: 'state', state })
  }

  private tokenMatches(candidate: string): boolean {
    const a = Buffer.from(candidate)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const c of this.wss?.clients ?? []) c.terminate()
      if (this.wss) this.wss.close(() => resolve())
      else resolve()
    })
  }
}
