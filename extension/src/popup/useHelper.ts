import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, Settings } from '../../../desktop/src/shared/app'
import type { Command, FromBackground, Link, ToBackground } from '../messages'

export interface Helper {
  link: Link
  state: AppState | null
  pair(): void
  setSettings(patch: Partial<Settings>): void
  regenerateToken(): void
  control(command: Command): void
}

/** Talks to the extension's background worker, which owns the connection to the Hummie helper. */
export function useHelper(): Helper {
  const [view, setView] = useState<{ link: Link; state: AppState | null }>({ link: 'connecting', state: null })
  const portRef = useRef<chrome.runtime.Port | null>(null)

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const open = () => {
      const port = chrome.runtime.connect({ name: 'popup' })
      portRef.current = port
      port.onMessage.addListener((m: FromBackground) => {
        if (m.type === 'view') setView({ link: m.link, state: m.state })
      })
      // The worker can be restarted by the browser while the popup is open: reconnect.
      port.onDisconnect.addListener(() => {
        portRef.current = null
        if (!closed) retry = setTimeout(open, 400)
      })
      port.postMessage({ action: 'sync' } satisfies ToBackground)
    }
    open()
    return () => {
      closed = true
      clearTimeout(retry)
      portRef.current?.disconnect()
    }
  }, [])

  const post = useCallback((m: ToBackground) => portRef.current?.postMessage(m), [])
  return {
    link: view.link,
    state: view.state,
    pair: () => post({ action: 'pair' }),
    setSettings: (patch) => post({ action: 'set-settings', patch }),
    regenerateToken: () => post({ action: 'regenerate-token' }),
    control: (command) => post({ action: 'control', command })
  }
}
