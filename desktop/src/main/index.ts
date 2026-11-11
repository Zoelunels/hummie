import { app, dialog, Menu, nativeImage, Tray } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bridge } from './bridge'
import { createDiscordClient } from './discord'
import { LyricsController } from './lyrics/controller'
import { Lrclib } from './lyrics/lrclib'
import { Presence } from './presence'
import { loadSettings, saveSettings } from './settings'
import type { AppState } from '../shared/app'
import { BRIDGE_PORT } from '../shared/protocol'

// Hummie's helper has no window. It lives in the system tray, talks to Discord, and takes its
// orders (and shows its UI) through the browser extension.

const log = (m: string) => console.log(`[hummie] ${m}`)

// One instance only: a second launch would fail to bind the bridge port.
if (!app.requestSingleInstanceLock()) app.quit()

const tokenFile = () => join(app.getPath('userData'), 'pairing-token')
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

function writeToken(token: string): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(tokenFile(), token, { mode: 0o600 })
}
const newToken = () => randomBytes(24).toString('hex')
function loadToken(): string {
  if (existsSync(tokenFile())) return readFileSync(tokenFile(), 'utf8').trim()
  const t = newToken()
  writeToken(t)
  return t
}

/** Minimal .env reader (KEY=VALUE lines), looked up in the working directory. */
function envValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  const file = join(process.cwd(), '.env')
  if (!existsSync(file)) return undefined
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && m[1] === key) return m[2]
  }
  return undefined
}

let tray: Tray | null = null

app.whenReady().then(async () => {
  let token = loadToken()

  const state: AppState = {
    playback: null,
    playbackAt: Date.now(),
    extension: false,
    discord: 'disabled',
    lyrics: 'off',
    settings: loadSettings(settingsFile())
  }

  const clientId = envValue('DISCORD_CLIENT_ID')
  const presence =
    clientId && /^\d{15,25}$/.test(clientId)
      ? new Presence(() => createDiscordClient(clientId), log, Date.now, state.settings)
      : undefined

  // Lyrics are looked up only when they would actually be shown on Discord, so nothing about the
  // song is sent to LRCLIB otherwise.
  const lyricsWanted = () =>
    !!presence && state.settings.showLyrics && state.settings.shareToDiscord && !state.settings.hideDetails
  const lrclib = new Lrclib(undefined, undefined, undefined, log)
  const lyrics = new LyricsController({
    lookup: (t) => lrclib.lookup(t),
    lead: () => state.settings.lyricsLeadSec,
    onLine: (line) => presence?.setLyricLine(line),
    onStatus: (s) => {
      log(`lyrics: ${s}`)
      state.lyrics = s
      publish()
    }
  })

  const bridge: Bridge = new Bridge(token, BRIDGE_PORT, {
    getState: () => state,
    onSetSettings: (patch) => {
      state.settings = { ...state.settings, ...patch }
      saveSettings(settingsFile(), state.settings)
      presence?.setSettings(state.settings)
      lyrics.setEnabled(lyricsWanted())
      publish()
    },
    onRegenerateToken: () => {
      token = newToken()
      writeToken(token)
      log('pairing token regenerated')
      return token
    },
    requestPairing: async (origin) => {
      // The user is the gatekeeper: nothing gets the token without an explicit "Allow".
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'Hummie',
        message: 'Allow this browser extension to connect to Hummie?',
        detail:
          "It will be able to send what you play to Discord and change Hummie's settings.\n\n" +
          `Requested by: ${origin ?? 'unknown'}\n\nOnly allow this if you just clicked Pair in the Hummie extension.`,
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      log(response === 0 ? 'pairing allowed' : 'pairing denied')
      return response === 0
    }
  })

  /** Push the new state to every paired extension and refresh the tray. */
  function publish(): void {
    state.extension = bridge.clientCount > 0
    bridge.broadcastState(state)
    updateTray()
  }

  if (presence) {
    presence.onStatus((s) => {
      state.discord = s
      publish()
    })
    presence.start()
  } else log('DISCORD_CLIENT_ID missing or invalid in desktop/.env - Discord presence disabled')
  lyrics.setEnabled(lyricsWanted())

  bridge.on('clientCount', (n) => {
    log(`extension clients: ${n}`)
    if (n === 0) {
      // Browser gone: never leave a stale song on the profile.
      state.playback = null
      presence?.update({ type: 'playback', state: 'stopped' })
      lyrics.update(null)
    }
    publish()
  })
  bridge.on('playback', (m) => {
    log(`playback ${m.state} ${m.title ?? ''} - ${m.artist ?? ''}`)
    state.playback = m.state === 'stopped' ? null : m
    state.playbackAt = Date.now()
    presence?.update(m)
    lyrics.update(m)
    publish()
  })

  const port = await bridge.start()
  log(`bridge listening on 127.0.0.1:${port}`)

  // ---- tray -------------------------------------------------------------------------------
  tray = new Tray(nativeImage.createFromPath(join(__dirname, '../../build/icon.png')).resize({ width: 16, height: 16 }))
  tray.setToolTip('Hummie')

  function updateTray(): void {
    if (!tray) return
    const discordLabel = {
      connected: 'connected',
      connecting: 'connecting…',
      offline: 'not reachable',
      disabled: 'no client ID set'
    }[state.discord]
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Hummie', enabled: false },
        { label: `Browser extension: ${state.extension ? 'connected' : 'not connected'}`, enabled: false },
        { label: `Discord: ${discordLabel}`, enabled: false },
        { type: 'separator' },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
        },
        { type: 'separator' },
        { label: 'Quit Hummie', click: () => app.quit() }
      ])
    )
  }
  updateTray()

  app.on('before-quit', () => {
    lyrics.stop()
    void presence?.stop()
  })
})

// No windows exist; keep running in the tray until the user quits.
app.on('window-all-closed', () => {})
