import { defineConfig } from 'electron-vite'

// The helper has no window, so there is no preload script and no renderer.
export default defineConfig({
  main: { build: { rollupOptions: { input: 'src/main/index.ts' } } }
})
