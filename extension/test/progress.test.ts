import { describe, expect, it } from 'vitest'
import { currentPosition, formatTime, fraction } from '../src/popup/progress'

const m = (o = {}) => ({ type: 'playback' as const, state: 'playing' as const, positionSec: 10, durationSec: 200, ...o })

describe('progress', () => {
  it('advances while playing, freezes while paused', () => {
    expect(currentPosition(m(), 1000, 6000)).toBe(15)
    expect(currentPosition(m({ state: 'paused' }), 1000, 6000)).toBe(10)
  })
  it('clamps to duration and handles null', () => {
    expect(currentPosition(m(), 0, 1_000_000)).toBe(200)
    expect(currentPosition(null, 0, 5)).toBe(0)
  })
  it('fraction is bounded and safe without duration', () => {
    expect(fraction(50, 200)).toBe(0.25)
    expect(fraction(500, 200)).toBe(1)
    expect(fraction(5, undefined)).toBe(0)
  })
  it('formats mm:ss', () => {
    expect(formatTime(108.9)).toBe('01:48')
    expect(formatTime(undefined)).toBe('--:--')
  })
})
