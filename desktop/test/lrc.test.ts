import { describe, expect, it } from 'vitest'
import { lineAt, parseLrc } from '../src/main/lyrics/lrc'

// Synthetic text only (no real lyrics).
const SAMPLE = `[ar: Someone]
[ti: Title]
[00:01.50] first
[00:05.00] second
[00:09.25]
[00:12.00][01:00.5] repeated
`

describe('parseLrc', () => {
  it('parses times and text, ignores metadata, sorts', () => {
    const l = parseLrc(SAMPLE)
    expect(l.map((x) => x.time)).toEqual([1.5, 5, 9.25, 12, 60.5])
    expect(l.map((x) => x.text)).toEqual(['first', 'second', '', 'repeated', 'repeated'])
  })
  it('handles CRLF and returns [] for text without timestamps', () => {
    expect(parseLrc('[00:01.00] a\r\n[00:02.00] b').length).toBe(2)
    expect(parseLrc('just words\nno times')).toEqual([])
  })
})

describe('lineAt', () => {
  const l = parseLrc(SAMPLE)
  it('is null before the first line', () => expect(lineAt(l, 0.5)).toBeNull())
  it('picks the last line at or before the position', () => {
    expect(lineAt(l, 1.5)).toBe('first')
    expect(lineAt(l, 4.99)).toBe('first')
    expect(lineAt(l, 5)).toBe('second')
    expect(lineAt(l, 100)).toBe('repeated')
  })
  it('is null during a blank line', () => expect(lineAt(l, 10)).toBeNull())
  it('handles empty input', () => expect(lineAt([], 5)).toBeNull())
})
