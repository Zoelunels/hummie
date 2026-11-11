import type { AppState } from '../../desktop/src/shared/app'
import type { PlaybackMessage, ServerMessage } from '../../desktop/src/shared/protocol'
import type { FromBackground, Link, ToBackground } from './messages'

// Overridable only so the integration test can use a free port.
const URL: string = (globalThis as { __HUMMIE_URL__?: string }).__HUMMIE_URL__ ?? 'ws://127.0.0.1:17654'
const PROTOCOL_VERSION = 1 // keep in sync with desktop/src/shared/protocol.ts
const CLOSE_UNAUTHORIZED = 4401

let ws: WebSocket | null = null
let ready = false
let retryMs = 1000
let retryTimer: ReturnType<typeof setTimeout> | undefined
let link: Link = 'connecting'
let appState: AppState | null = null
let lastMsg: PlaybackMessage = { type: 'playback', state: 'stopped' }
let activeTab: number | undefined
let lastTab: number | undefined // most recent YouTube Music tab we heard from, for player controls
const ports = new Set<chrome.runtime.Port>()

function view(): FromBackground {
  return { type: 'view', link, state: appState }
}

function setLink(next: Link, state: AppState | null = appState): void {
  link = next
  appState = state
  const ok = next === 'connected'
  void chrome.action.setBadgeText({ text: ok ? '' : '!' })
  void chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#c62828' })
  for (const p of ports) p.postMessage(view())
}

const parse = (data: unknown): ServerMessage | null => {
  try {
    const m = JSON.parse(String(data))
    return m && typeof m.type === 'string' ? (m as ServerMessage) : null
  } catch {
    return null
  }
}

async function connect(): Promise<void> {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  if (link === 'pairing') return
  const { token } = await chrome.storage.local.get('token')
  if (!token) return setLink('unpaired', null)
  setLink('connecting', null)

  const sock = new WebSocket(URL)
  ws = sock
  ready = false
  sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', token, version: PROTOCOL_VERSION }))
  sock.onmessage = (e) => {
    const m = parse(e.data)
    if (!m) return
    if (m.type === 'ready') {
      ready = true
      retryMs = 1000
      sock.send(JSON.stringify(lastMsg)) // resync after (re)connect
    } else if (m.type === 'state') {
      setLink('connected', m.state)
    } else if (m.type === 'token') {
      void chrome.storage.local.set({ token: m.token }) // after "regenerate", this client stays paired
    }
  }
  sock.onclose = (e) => {
    if (ws === sock) ws = null
    ready = false
    if (e.code === CLOSE_UNAUTHORIZED) {
      // The helper no longer accepts our token (regenerated elsewhere): pair again, don't hammer.
      void chrome.storage.local.remove('token')
      setLink('unpaired', null)
      return
    }
    setLink('no-helper', null)
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, retryMs)
    retryMs = Math.min(retryMs * 2, 15000)
  }
  sock.onerror = () => {} // onclose follows
}

/** Ask the helper for a token. The user has to click "Allow" in a dialog the helper shows. */
function startPairing(): void {
  if (link === 'pairing') return
  setLink('pairing', null)
  const sock = new WebSocket(URL)
  let answered = false
  sock.onopen = () => sock.send(JSON.stringify({ type: 'pair', version: PROTOCOL_VERSION }))
  sock.onmessage = (e) => {
    const m = parse(e.data)
    if (m?.type === 'paired') {
      answered = true
      void chrome.storage.local.set({ token: m.token }).then(() => {
        sock.close()
        link = 'connecting'
        void connect()
      })
    } else if (m?.type === 'pair-denied') {
      answered = true
      setLink('denied', null)
    }
  }
  sock.onclose = () => {
    if (!answered) setLink('no-helper', null)
  }
  sock.onerror = () => {}
}

function sendToHelper(msg: unknown): void {
  if (ws && ready) ws.send(JSON.stringify(msg))
}

// Traffic every 20s keeps the MV3 service worker alive; an idle worker is killed after ~30s,
// which would drop the socket and make the helper think the browser went away.
setInterval(() => sendToHelper({ type: 'ping' }), 20_000)

function sendPlayback(msg: PlaybackMessage): void {
  lastMsg = msg
  sendToHelper(msg)
}

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.type !== 'hummie:playback') return
  const msg = m.msg as PlaybackMessage
  const tabId = sender.tab?.id
  if (tabId !== undefined) lastTab = tabId
  if (msg.state === 'playing') activeTab = tabId
  else if (tabId !== activeTab && activeTab !== undefined) return // another tab owns playback
  sendPlayback(msg)
  void connect() // wakes/reconnects if the worker was suspended
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return
  ports.add(port)
  port.onDisconnect.addListener(() => ports.delete(port))
  port.onMessage.addListener((m: ToBackground) => {
    switch (m.action) {
      case 'sync':
        void connect()
        break
      case 'pair':
        startPairing()
        break
      case 'set-settings':
        sendToHelper({ type: 'set-settings', patch: m.patch })
        break
      case 'regenerate-token':
        sendToHelper({ type: 'regenerate-token' })
        break
      case 'control': {
        // Only known commands, only to a tab that has told us it is YouTube Music.
        const tab = activeTab ?? lastTab
        if (tab !== undefined && ['toggle', 'next', 'previous'].includes(m.command))
          chrome.tabs.sendMessage(tab, { type: 'hummie:control', command: m.command }).catch(() => {})
        break
      }
    }
  })
  port.postMessage(view())
  void connect()
})

chrome.tabs.onRemoved.addListener((id) => {
  if (id === activeTab) {
    activeTab = undefined
    sendPlayback({ type: 'playback', state: 'stopped' })
  }
})

// Keeps the service worker connecting even when no YouTube Music tab is sending events.
chrome.alarms.create('hummie-keepalive', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(() => void connect())
chrome.runtime.onStartup.addListener(() => void connect())
chrome.runtime.onInstalled.addListener(() => void connect())
void connect()
