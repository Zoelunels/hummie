import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

const common = { outdir: 'dist', bundle: true, format: 'esm', target: 'chrome120', logLevel: 'info' }

// Background worker and content script.
await build({ ...common, entryPoints: { background: 'src/background.ts', content: 'src/content.ts' } })

// Popup (React). Bundled fonts are emitted next to it, so nothing is loaded from the network.
await build({
  ...common,
  entryPoints: { popup: 'src/popup/main.tsx' },
  jsx: 'automatic',
  minify: true,
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'assets/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' }
})

cpSync('manifest.json', 'dist/manifest.json')
cpSync('src/popup/index.html', 'dist/popup.html')
cpSync('icons', 'dist/icons', { recursive: true })
