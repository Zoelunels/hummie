# Hummie

Your music, your Discord presence.

Hummie shows what you're playing on **YouTube Music (web)** as a "Listening" activity on your **Discord desktop** profile.

> **Status: early MVP.** The helper, extension and pairing logic are unit- and integration-tested, but the full pipeline has not yet been verified against live YouTube Music, Edge and Discord on a clean machine. Expect rough edges. Windows is the target platform.

Hummie is an unofficial community project. It is not affiliated with or endorsed by Google, YouTube or Discord.

## How it works

```
music.youtube.com -> Edge extension (popup UI) <-WebSocket 127.0.0.1-> Hummie helper (system tray) -> Discord local IPC
```

| Part | Folder | Job |
| --- | --- | --- |
| Extension (MV3) | `extension/` | Reads playback from the YouTube Music tab (`navigator.mediaSession`, with a DOM fallback) and **is the whole UI**: the toolbar popup shows what's playing and holds the settings. |
| Helper | `desktop/` | A small tray-only app with no window. It runs a local WebSocket server and talks to Discord, because a browser extension cannot reach Discord's local connection by itself. |

Why a helper at all? Discord's Rich Presence only works through a local connection (a named pipe, or a WebSocket that needs OAuth), and browser extensions can't open pipes. Projects like PreMiD use the same shape: extension plus a small background app.

### Pairing and security

- The helper binds to `127.0.0.1` only, rejects web-page origins, validates every message with a schema, and caps payload size.
- **Pairing needs your approval.** Click *Pair with Hummie* in the popup and the helper shows a dialog ("Allow this browser extension to connect?"). Only after you click **Allow** does the extension receive its pairing key. Nothing else can get one, and a denied request is blocked for a few seconds.
- Discord is reached through its local IPC pipe; no bot token or Discord login is used.
- The popup can reset the pairing key. This browser stays paired; other browsers must pair again.

## Lyrics on Discord (optional, off by default)

Turn on **Lyrics on Discord** in the popup's Settings tab. While a song plays, the current line of its synced lyrics replaces the artist line in your Discord activity.

- Lyrics come from [LRCLIB](https://lrclib.net), a free community lyrics database. Hummie sends the **song title, artist, album and length** to lrclib.net to find them. This is the only thing Hummie ever sends anywhere besides your Discord activity, and only when this setting is on.
- Lookups happen only when lyrics would actually be shown: the setting is on, sharing to Discord is on, and "Hide title / artist" is off.
- Not every song has synced lyrics, and a different recording of the same song can have different timing, so lines can be a few seconds off or missing. Hummie then shows the normal artist line.
- Lyrics belong to their rights holders. Hummie shows one line at a time on your own profile and does not store lyrics on disk.
- Discord limits how fast activities can update, so lines are sent at most every few seconds.
- LRCLIB's documentation does not state a data license. Check [lrclib.net](https://lrclib.net) for current terms before redistributing anything.

## Requirements

- Windows, Node.js 22+
- Discord **desktop** app (the browser version has no local IPC)
- Edge (or another Chromium browser that can load unpacked extensions)

## Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications) and copy its **Application ID**.
   Optionally upload a small icon under Rich Presence Art Assets with the key `ytmusic` (used when a track has no artwork).
2. Configure and start the helper:
   ```bash
   cd desktop
   npm install
   cp .env.example .env   # then set DISCORD_CLIENT_ID
   npm run dev
   ```
   There is no window: look for the Hummie icon in the system tray.
3. Build and load the extension:
   ```bash
   cd extension
   npm install
   npm run build
   ```
   Open `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`. Pin the Hummie icon to the toolbar.
4. Click the Hummie icon, then **Pair with Hummie**, and click **Allow** in the dialog that appears.
5. Play a song on music.youtube.com.

## Building the Windows installer

```bash
cd desktop
npm run dist    # needs DISCORD_CLIENT_ID in desktop/.env; output: desktop/release/Hummie-Setup-<version>.exe
```

The installer bundles your Application ID (it is public, so that is fine) and installs per user, no admin rights needed. On first launch the installed helper adds itself to Windows startup; you can turn that off from the tray menu. The installer is **not code-signed**, so Windows SmartScreen will warn about an unknown publisher until it is signed or builds up reputation. To use your own Discord application with an installed copy, put a `.env` with `DISCORD_CLIENT_ID=...` in `%APPDATA%\Hummie`.

## Development

```bash
cd desktop   && npm test && npm run typecheck
cd extension && npm test && npm run typecheck
```

`extension/test/background.e2e.test.ts` runs the real extension background script against the real helper bridge (with a mocked `chrome` API), including pairing, settings and token reset.

## Known limitations

- YouTube Music's page can change at any time; selectors and `mediaSession` behaviour may need updates.
- Discord Rich Presence is a custom activity, not Spotify's native integration. Its look depends on Discord's client.
- The helper is an Electron app, so it is larger than it needs to be for a tray icon. Replacing it with something lighter is possible later.
- Not yet packaged: you run the helper from source for now, and the extension is loaded unpacked.

## Roadmap

Live-site verification, a Windows installer (helper that starts with Windows), signing, and a lighter helper.
