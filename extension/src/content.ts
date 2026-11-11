import { buildSnapshot, isDrifted, parseTimeInfo, signature } from './snapshot'

// Primary source: navigator.mediaSession (YouTube Music fills it). Fallback: player bar DOM.
// NOTE: player-bar selectors are unverified against the live site; mediaSession is the main path.
function read() {
  const video = document.querySelector('video')
  const md = navigator.mediaSession?.metadata
  return buildSnapshot({
    meta: md
      ? { title: md.title, artist: md.artist, album: md.album, artwork: [...md.artwork] }
      : null,
    domTitle: document.querySelector('ytmusic-player-bar .title')?.textContent ?? null,
    domArtist: document.querySelector('ytmusic-player-bar .byline')?.textContent ?? null,
    uiTime: parseTimeInfo(document.querySelector('ytmusic-player-bar .time-info')?.textContent),
    video: video
      ? { paused: video.paused, ended: video.ended, currentTime: video.currentTime, duration: video.duration }
      : null,
    url: location.href
  })
}

let last = ''
let sentPos = 0
let sentAt = 0
let sentState = ''
function push(force = false) {
  const msg = read()
  const sig = signature(msg)
  const now = Date.now()
  // Position drift (loop, replay, seek with no event) must also trigger a resend while playing.
  const drift =
    msg.state === 'playing' && sentState === 'playing' && isDrifted(sentPos, sentAt, msg.positionSec, now)
  if (!force && !drift && sig === last) return
  last = sig
  sentPos = msg.positionSec ?? 0
  sentAt = now
  sentState = msg.state
  chrome.runtime.sendMessage({ type: 'hummie:playback', msg }).catch(() => {
    // Extension reloaded/updated: this content script is orphaned, stop quietly.
    clearInterval(timer)
  })
}

// Poll for track/metadata changes; media events give instant response for play/pause/seek.
const timer = setInterval(() => push(), 1000)
for (const ev of ['play', 'pause', 'ended', 'seeked', 'loadedmetadata'] as const) {
  // Capture phase on document catches media events from the (re)created <video> element.
  document.addEventListener(ev, () => push(ev === 'seeked'), true)
}
// Heartbeat: re-send current state so a restarted service worker relearns what is playing.
setInterval(() => push(true), 15_000)
window.addEventListener('pagehide', () => {
  chrome.runtime
    .sendMessage({ type: 'hummie:playback', msg: { type: 'playback', state: 'stopped' } })
    .catch(() => {})
})
push(true)
