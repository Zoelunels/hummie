# Hummie privacy policy

Hummie is an open-source project. It has no accounts, no analytics, no advertising and no servers of its own. This page describes exactly what the extension and the helper do with your data.

## What Hummie reads

On `music.youtube.com` the extension reads what is playing: song title, artist, album, cover image address, length, current position, play/pause state, and the page address of the song. It reads nothing else on the page and runs on no other site.

## Where it goes

1. **To the Hummie helper on your own computer.** The extension sends the playback information to the helper over a local connection (`127.0.0.1`, never the network). Pairing is approved by you in a dialog, and the helper rejects web pages.
2. **To Discord.** The helper shows your activity on your Discord profile through the Discord app already running on your computer: song title, artist, album, cover image address, timestamps, and (if the button setting is on) a link to the song. "Hide title / artist" replaces these with generic text.
3. **To LRCLIB, only if you turn on lyrics.** If **Lyrics on Discord** is on, the helper sends the song title, artist, album and length to [lrclib.net](https://lrclib.net) to look up synced lyrics. This is off by default and only happens while lyrics would actually be shown. LRCLIB's own policies apply to that request.
4. **Cover images.** The extension popup loads the cover image directly from the image server named in the song's metadata (normally YouTube's), as the YouTube Music page itself does.

Nothing is sent to the Hummie authors or to any other third party.

## What is stored

- In the browser (`chrome.storage.local`): the pairing key that lets the extension talk to your helper.
- On your computer (the helper's data folder): your settings and the same pairing key. Lyrics are not written to disk; recent lookups are kept in memory only.

You can remove all of it by uninstalling the extension and the helper and deleting the helper's data folder (`%APPDATA%\Hummie`).

## Your choices

Everything above can be turned off in the popup's Settings tab: share to Discord, album art, progress bar, hide title / artist, the link button, and lyrics.

## Contact

Open an issue at <https://github.com/Zoelunels/hummie/issues>.
