import '@fontsource/anton/latin-400.css'
import '@fontsource/space-mono/latin-400.css'
import '@fontsource/space-mono/latin-700.css'
import '@fontsource/permanent-marker/latin-400.css'
import './style.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

if (new URLSearchParams(location.search).has('window')) document.documentElement.classList.add('windowed')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
