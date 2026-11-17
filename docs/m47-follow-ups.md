# M47 follow-ups

Checked in the web preview (wide and 375 px wide): Settings → Help → Diagnostics opens; the log is
off at first; turned on, it stays on after a reload; Prepare the file shows the whole file (app,
settings, library counts, `addon#1 built in ok`, sync off, the log) with Download and Close.
Turned off, the next file says `log off` and `## Log (0)`.

Covered by tests: `packages/core/src/diagnostics/diagnostics.test.ts` builds a database with a
WebDAV URL holding a user name and password, an Audiobookshelf API key, an add-on URL with a
configuration token, a book title and file path, a sync key, group ID, device name and pairing
code, records failures whose error messages carry all of them, and checks that none of them (nor
pieces such as the user name or the token's first characters) are in the export. It also covers
off by default, cleared when off, the 500-event ring (kept by time), events with text refused,
per-export numbering, and that the bedtime window is left out.
`modules/audio/.../DiagnosticsTest.kt` covers the service's own ring of 200, its encoding, and
that presses of Play and Pause, the end of a book and focus coming back are not logged.

## What a file holds

App version and platform (with the Android API level), the playback, download and update
settings, counts of books, podcasts and downloads, each library folder or server by type and
whether it needs a login, each add-on as built in or added with its health, whether sync is on and
when it last ran, then the log: player errors and pauses the system made (focus, unplugged
headphones), refreshed links, failed downloads, scans, add-on requests and syncs, and errors
nothing else caught. Times are whole hours before the file was made.

## Open on a phone

- <a id="log"></a>Settings → Help → Diagnostics, turn the log on, play a stream and turn Wi-Fi off
  until it fails: Prepare the file lists `player error` with a Media3 code and the book as
  `book#1`; Share opens the share sheet with the text.
- With the log on, take a phone call while a book plays, and unplug wired headphones: the file
  lists `focus-lost-briefly` or `focus-ducked`, and `paused-by-system AUDIO_BECOMING_NOISY (3)`,
  also when the app was swiped away before.
- Turn the log off and on again, then prepare the file: the log is empty, also of the service's
  events from before.
- A download that fails (a WebDAV server switched off mid-download) and a rescan of that server:
  `download failed` and `scan failed webdav server#1 offline`, with no address in the file.
- TalkBack reads the switch as “Keep a diagnostics log” and the buttons by their text; each is at
  least 48 dp.

## Review findings

Fixed after review: minute-level times and events that only say when someone listens or sleeps
(sleep timer done, book ended, service start and stop, focus back) are gone; times are whole
hours. Turning the log off on Android runs on the service's thread, so an append can't bring the
log back. Add-on failures repeat at most every 5 minutes per kind, and logging them can't change
the request. The ring trims by time. The route is closed to a kids profile.

Minor, left for later:

- Android shares the file as text through the share sheet, not as a `.txt` attachment, as the
  library export does; sending a real file needs `expo-sharing`. Some apps cut very long text.
- The file's text is fixed at a small size in a sideways scroller; with a large font setting it
  is hard to read. A full-screen view could follow.
- A book ID longer than 200 characters would make a player event fail validation and be dropped;
  IDs are UUIDs today.
- Background runs (the podcast refresh task) don't load the switch, so they log nothing.
