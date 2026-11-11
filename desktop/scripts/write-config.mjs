// Writes build/config.json for the installer from DISCORD_CLIENT_ID (env var or desktop/.env).
// The Application ID is public (it is visible on every Rich Presence activity), so bundling it is fine.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

let id = process.env.DISCORD_CLIENT_ID
if (!id && existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*DISCORD_CLIENT_ID\s*=\s*(.*?)\s*$/)
    if (m) id = m[1]
  }
}
if (!id || !/^\d{15,25}$/.test(id)) {
  console.error('DISCORD_CLIENT_ID is missing or invalid. Set it in desktop/.env or the environment first.')
  process.exit(1)
}
mkdirSync('build', { recursive: true })
writeFileSync('build/config.json', JSON.stringify({ discordClientId: id }, null, 2) + '\n')
console.log('wrote build/config.json')
