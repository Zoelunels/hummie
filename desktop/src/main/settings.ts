import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, Settings } from '../shared/app'

/** Read settings from disk; anything missing or invalid falls back to defaults. */
export function loadSettings(file: string): Settings {
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const merged = { ...DEFAULT_SETTINGS }
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (typeof raw[key] === typeof DEFAULT_SETTINGS[key]) (merged as Record<string, unknown>)[key] = raw[key]
    }
    return Settings.parse(merged)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(file: string, s: Settings): void {
  writeFileSync(file, JSON.stringify(s, null, 2))
}
