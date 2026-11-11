import type { PlaybackMessage } from '../../../desktop/src/shared/protocol'

/** Current position in seconds, advancing from the last report while playing. */
export function currentPosition(m: PlaybackMessage | null, receivedAt: number, now: number): number {
  if (!m) return 0
  const base = m.positionSec ?? 0
  const live = m.state === 'playing' ? Math.max(0, now - receivedAt) / 1000 : 0
  const pos = base + live
  return m.durationSec ? Math.min(pos, m.durationSec) : pos
}

export function fraction(pos: number, duration?: number): number {
  return duration && duration > 0 ? Math.min(1, Math.max(0, pos / duration)) : 0
}

export function formatTime(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return '--:--'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
