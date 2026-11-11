import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  type AppState,
  type DiscordStatus,
  type LyricsStatus,
  type Settings
} from '../../../desktop/src/shared/app'
import type { Command, Link } from '../messages'
import { currentPosition, formatTime, fraction } from './progress'
import { useHelper, type Helper } from './useHelper'

type Mode = 'playing' | 'paused' | 'idle'
type View = 'player' | 'settings'
type BoolSetting = Exclude<keyof Settings, 'lyricsLeadSec'>

/** True when this page was opened as a standalone window (see floatWindow) instead of the toolbar popup. */
export const WINDOWED = new URLSearchParams(location.search).has('window')

function floatWindow(): void {
  void chrome.windows
    .create({ url: chrome.runtime.getURL('popup.html?window=1'), type: 'popup', width: 410, height: 650 })
    .then(() => window.close()) // close the toolbar popup once the window is up
}

const SEGMENTS = 24
const TAGLINE: Record<Mode, string> = {
  playing: 'humming along',
  paused: 'hold up',
  idle: 'no signal'
}
const STICKER: Record<Mode, string> = { playing: 'playing', paused: 'paused', idle: 'stopped' }

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [active])
  return now
}

export function App() {
  const helper = useHelper()
  const [view, setView] = useState<View>('player')
  const { link, state } = helper

  return (
    <div className="app">
      <header className="bar">
        <span className="name">HUMMIE</span>
        <button className={`tab ${view === 'player' ? 'on' : ''}`} aria-pressed={view === 'player'} onClick={() => setView('player')}>
          Player
        </button>
        <button className={`tab ${view === 'settings' ? 'on' : ''}`} aria-pressed={view === 'settings'} onClick={() => setView('settings')}>
          Settings
        </button>
        {!WINDOWED && (
          // A toolbar popup can't be moved or kept open (the browser closes it on any outside click),
          // so offer the same UI in a small window of its own.
          <button className="tab float" aria-label="Open Hummie in its own window" onClick={floatWindow}>
            Float
          </button>
        )}
      </header>
      <main className="page">
        {link === 'connected' && state ? (
          view === 'player' ? (
            <Player state={state} onControl={helper.control} />
          ) : (
            <SettingsView helper={helper} state={state} />
          )
        ) : (
          <ConnectScreen link={link} onPair={helper.pair} />
        )}
      </main>
    </div>
  )
}

function Wordmark({ text, tag, small }: { text: string; tag: string; small?: boolean }) {
  return (
    <div className={`wordmark ${small ? 'small' : ''}`}>
      <h1>{text}</h1>
      <svg className="drips" width="150" height="27" viewBox="0 0 220 40" aria-hidden="true">
        <g fill="#e8ff3a">
          <rect x="10" y="0" width="7" height="30" rx="3.5" />
          <rect x="46" y="0" width="7" height="18" rx="3.5" />
          <rect x="92" y="0" width="7" height="38" rx="3.5" />
          <rect x="140" y="0" width="7" height="22" rx="3.5" />
          <rect x="188" y="0" width="7" height="32" rx="3.5" />
        </g>
      </svg>
      <span className="tag">{tag}</span>
    </div>
  )
}

/** Shown whenever the popup can't show the player: no helper, not paired, waiting, denied. */
function ConnectScreen({ link, onPair }: { link: Link; onPair: () => void }) {
  const copy: Record<Link, { tag: string; title: string; body: string; cta?: string }> = {
    connecting: { tag: 'one sec', title: 'connecting', body: 'Reaching the Hummie helper…' },
    'no-helper': {
      tag: 'no signal',
      title: 'helper not running',
      body: 'Start Hummie from the Start menu. It runs in the system tray and does the Discord part. This popup keeps trying on its own.'
    },
    unpaired: {
      tag: 'hello',
      title: 'not paired',
      body: 'Pair this browser with the Hummie helper. A dialog will ask you to allow it.',
      cta: 'Pair with Hummie'
    },
    pairing: {
      tag: 'your move',
      title: 'waiting for you',
      body: 'Click Allow in the dialog from Hummie. If you do not see it, check behind other windows.'
    },
    denied: {
      tag: 'nope',
      title: 'pairing denied',
      body: 'Nothing was shared. You can try again in a few seconds.',
      cta: 'Try again'
    },
    connected: { tag: 'one sec', title: 'loading', body: 'Getting the latest from Hummie…' }
  }
  const c = copy[link]
  return (
    <>
      <Wordmark text="HUMMIE" tag={c.tag} />
      <div className="hazard" aria-hidden="true" />
      <section className="slab" aria-live="polite">
        <p className="lab">status</p>
        <p className="msg">
          <strong>{c.title}</strong>
          <br />
          {c.body}
        </p>
        {c.cta && (
          <button className="bx cta" onClick={onPair}>
            {c.cta}
          </button>
        )}
      </section>
    </>
  )
}

function Player({ state, onControl }: { state: AppState; onControl: (c: Command) => void }) {
  const m = state.playback
  const mode: Mode = !m ? 'idle' : m.state === 'playing' ? 'playing' : 'paused'
  const now = useNow(mode === 'playing')
  const pos = currentPosition(m, state.playbackAt, now)
  const frac = fraction(pos, m?.durationSec)
  const filled = Math.round(frac * SEGMENTS)
  const title = m?.title ?? 'Nothing playing'
  const artist = m
    ? m.state === 'paused'
      ? `Paused / ${m.artist ?? ''}`
      : (m.artist ?? '')
    : 'Press play on YouTube Music'
  const size = title.length > 26 ? 22 : title.length > 16 ? 30 : 40

  return (
    <>
      <Wordmark text="HUMMIE" tag={TAGLINE[mode]} />
      <div className="hazard" aria-hidden="true" />

      <section className="slab" aria-label="Now playing">
        <span className={`sticker ${mode}`}>● {STICKER[mode]}</span>
        <p className="lab">01 / now playing</p>
        <h2 className="song" style={{ fontSize: size }}>{title}</h2>
        <p className="artist">{artist}</p>
        <div
          className="segs"
          role="progressbar"
          aria-label="Song progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(frac * 100)}
        >
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <i key={i} className={i < filled ? 'f' : ''} />
          ))}
        </div>
        <div className="times">
          <span>{m ? formatTime(pos) : '00:00'}</span>
          <span>{m ? formatTime(m.durationSec) : '--:--'}</span>
        </div>
        <div className="controls" role="group" aria-label="Player controls">
          <button className="bx" aria-label="Previous song" disabled={!m} onClick={() => onControl('previous')}>
            ◀◀
          </button>
          <button
            className="bx play"
            aria-label={mode === 'playing' ? 'Pause' : 'Play'}
            disabled={!m}
            onClick={() => onControl('toggle')}
          >
            {mode === 'playing' ? '❚❚' : '▶'}
          </button>
          <button className="bx" aria-label="Next song" disabled={!m} onClick={() => onControl('next')}>
            ▶▶
          </button>
        </div>
      </section>

      <section className="slab tbl" aria-label="Connections">
        <p className="lab">02 / connections</p>
        <Conn label="Hummie helper" ok text="ok" />
        <Conn label="Discord" ok={state.discord === 'connected'} text={discordText(state.discord)} />
      </section>
    </>
  )
}

function discordText(s: DiscordStatus): string {
  return { connected: 'ok', connecting: 'wait', offline: 'offline', disabled: 'no id' }[s]
}

function Conn({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className="r">
      <span>{label}</span>
      <span className="dots" aria-hidden="true" />
      <span className="st">
        {text}
        <span className={`sqd ${ok ? '' : 'bad'}`} aria-hidden="true" />
      </span>
    </div>
  )
}

function SettingsView({ helper, state }: { helper: Helper; state: AppState }) {
  const settings = state.settings
  const [confirm, setConfirm] = useState(false)
  const set = helper.setSettings
  const step = (d: number) =>
    set({ lyricsLeadSec: Math.min(5, Math.max(0, +(settings.lyricsLeadSec + d).toFixed(1))) })

  const pair = (key: BoolSetting, label: string) => (
    <div className="row">
      <span className="rl">{label}</span>
      <span className="dots" aria-hidden="true" />
      <div className="pair" role="radiogroup" aria-label={label}>
        <button role="radio" aria-checked={settings[key]} className={settings[key] ? 'on' : ''} onClick={() => set({ [key]: true })}>
          On
        </button>
        <button role="radio" aria-checked={!settings[key]} className={!settings[key] ? 'on' : ''} onClick={() => set({ [key]: false })}>
          Off
        </button>
      </div>
    </div>
  )

  return (
    <>
      <Wordmark text="SETTINGS" tag="your rules" small />
      <div className="hazard" aria-hidden="true" />

      <section className="slab" aria-label="Privacy">
        <p className="lab">01 / privacy</p>
        {pair('shareToDiscord', 'Share to Discord')}
        {pair('showArt', 'Album art')}
        {pair('showProgress', 'Progress bar')}
        {pair('clearWhenPaused', 'Clear after 5m pause')}
        {pair('hideDetails', 'Hide title / artist')}
      </section>

      <section className="slab" aria-label="Lyrics">
        <p className="lab">02 / lyrics</p>
        {pair('showLyrics', 'Lyrics on Discord')}
        <p className="hint">{lyricsHint(settings, state.lyrics)}</p>
        <div className="row">
          <span className="rl">Show earlier by</span>
          <span className="dots" aria-hidden="true" />
          <span className="btns">
            <button className="bx" aria-label="Show lyrics later" onClick={() => step(-0.5)}>−</button>
            <span className="val">{settings.lyricsLeadSec.toFixed(1)}s</span>
            <button className="bx" aria-label="Show lyrics earlier" onClick={() => step(0.5)}>+</button>
          </span>
        </div>
        <div className="row">
          <span className="rl">Source</span>
          <span className="dots" aria-hidden="true" />
          <span className="src">LRCLIB</span>
        </div>
      </section>

      <section className="slab" aria-label="Connection">
        <p className="lab">03 / connection</p>
        <div className="row">
          <span className="rl">Pairing key</span>
          <span className="dots" aria-hidden="true" />
          <button className="bx danger" onClick={() => setConfirm(true)}>Reset</button>
        </div>
        {confirm && (
          <div className="confirm" role="alertdialog" aria-label="Reset pairing key">
            <p>Other browsers will have to pair again. This one stays paired.</p>
            <span className="btns">
              <button className="bx" onClick={() => setConfirm(false)}>Cancel</button>
              <button
                className="bx danger"
                onClick={() => {
                  helper.regenerateToken()
                  setConfirm(false)
                }}
              >
                Reset key
              </button>
            </span>
          </div>
        )}
      </section>

      <button className="bx full" onClick={() => set({ ...DEFAULT_SETTINGS })}>Reset settings to default</button>
      <p className="note">
        {settings.showLyrics
          ? 'Title, artist and length go to LRCLIB for lyrics. Activity goes to Discord. Settings save automatically.'
          : 'Nothing leaves your computer except the activity sent to Discord. Settings save automatically.'}
      </p>
    </>
  )
}

function lyricsHint(s: Settings, status: LyricsStatus): string {
  if (!s.showLyrics) return 'Looks up synced lyrics on lrclib.net. Sends title, artist and length.'
  if (!s.shareToDiscord) return 'Paused: sharing to Discord is off.'
  if (s.hideDetails) return 'Paused: title and artist are hidden.'
  return {
    off: 'Needs a Discord connection.',
    searching: 'Searching for lyrics…',
    synced: 'Synced lyrics found.',
    instrumental: 'Instrumental: no lyrics.',
    none: 'No synced lyrics for this song.',
    error: "Couldn't reach LRCLIB. Retries on the next song."
  }[status]
}
