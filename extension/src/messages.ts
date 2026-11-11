import type { AppState, Settings } from '../../desktop/src/shared/app'

/** State of the extension's link to the Hummie helper (the tray app). */
export type Link =
  | 'no-helper' // helper isn't running / not reachable
  | 'unpaired' // no token yet
  | 'pairing' // waiting for the user to allow it in the helper's dialog
  | 'denied' // the user said no
  | 'connecting'
  | 'connected'

/** Popup -> background (over a long-lived port). */
export type ToBackground =
  | { action: 'sync' }
  | { action: 'pair' }
  | { action: 'set-settings'; patch: Partial<Settings> }
  | { action: 'regenerate-token' }

/** Background -> popup. `state` is the helper's latest app state (null until it arrives). */
export type FromBackground = { type: 'view'; link: Link; state: AppState | null }
