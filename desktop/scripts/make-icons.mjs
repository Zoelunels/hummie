// Renders assets/icon.svg into every PNG/ICO the project needs.
// Usage (from desktop/): node scripts/make-icons.mjs
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const svg = readFileSync(join(root, 'assets/icon.svg'), 'utf8')

const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
const out = (rel, data) => {
  const file = join(root, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log('wrote', rel, `(${data.length} bytes)`)
}

// Browser extension icons.
for (const s of [16, 32, 48, 128]) out(`extension/icons/${s}.png`, png(s))

// Master PNGs. 512 doubles as the Discord Rich Presence art asset (key: ytmusic).
out('assets/icon-512.png', png(512))
out('assets/icon-1024.png', png(1024)) // Discord app icon (portal asks for 1024x1024)
out('desktop/build/icon.png', png(512))

// Windows .ico with PNG-compressed entries.
const sizes = [16, 32, 48, 64, 128, 256]
const images = sizes.map(png)
const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(s === 256 ? 0 : s, 0)
  e.writeUInt8(s === 256 ? 0 : s, 1)
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(images[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += images[i].length
  return e
})
out('desktop/build/icon.ico', Buffer.concat([header, ...entries, ...images]))
