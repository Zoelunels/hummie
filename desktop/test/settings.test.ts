import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsPatch } from '../src/shared/app'
import { loadSettings, saveSettings } from '../src/main/settings'

const file = () => join(mkdtempSync(join(tmpdir(), 'hummie-')), 'settings.json')

describe('settings', () => {
  it('defaults when file is missing', () => {
    expect(loadSettings(file())).toEqual(DEFAULT_SETTINGS)
  })
  it('round-trips', () => {
    const f = file()
    saveSettings(f, { ...DEFAULT_SETTINGS, hideDetails: true })
    expect(loadSettings(f).hideDetails).toBe(true)
  })
  it('ignores corrupt files and wrong types', () => {
    const f = file()
    writeFileSync(f, '{nope')
    expect(loadSettings(f)).toEqual(DEFAULT_SETTINGS)
    writeFileSync(f, JSON.stringify({ showArt: 'yes', hideDetails: true, extra: 1 }))
    expect(loadSettings(f)).toEqual({ ...DEFAULT_SETTINGS, hideDetails: true })
  })
  it('keeps a valid lead, rejects an out-of-range one', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ lyricsLeadSec: 2.5 }))
    expect(loadSettings(f).lyricsLeadSec).toBe(2.5)
    writeFileSync(f, JSON.stringify({ lyricsLeadSec: 99 }))
    expect(loadSettings(f)).toEqual(DEFAULT_SETTINGS)
    expect(SettingsPatch.safeParse({ lyricsLeadSec: 3 }).success).toBe(true)
    expect(SettingsPatch.safeParse({ lyricsLeadSec: -1 }).success).toBe(false)
  })
  it('patch validation rejects unknown keys and non-booleans', () => {
    expect(SettingsPatch.safeParse({ showArt: false }).success).toBe(true)
    expect(SettingsPatch.safeParse({ evil: true }).success).toBe(false)
    expect(SettingsPatch.safeParse({ showArt: 'no' }).success).toBe(false)
  })
})
