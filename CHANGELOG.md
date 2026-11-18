# Changelog

What changed in each Lelap release, newest first.

## 0.1.0-beta.5 (2026-11-18)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it.

There are now two APKs, one per kind of phone. Most phones from the last several years take the
64-bit one, the download button on lelap.app. Phones that can only run 32-bit apps, such as many
Android Go phones, take the 32-bit one linked under it (`beta-armv7.apk`); GitHub Releases carry
both. From now on the app updates itself to the right one. A 32-bit-only phone with beta 4 can’t
tell the two apart yet: it offers the 64-bit APK, which won’t install, so install the 32-bit APK
by hand once. (#114)

### New

- SMB and SFTP servers as library folders: Windows shares, Synology, QNAP, Samba and SSH servers.
  Books scan in with tags, chapters and covers, play, download and cast. Android only. (#122)
- SFTP shows the server’s key before any login is sent and refuses a server whose key changed
  later. A key file with a passphrase works as well as a password. (#122)
- Navidrome and other Subsonic servers: audiobooks by genre or music folder, with your place kept
  in the server’s bookmarks both ways. The password never leaves the phone. (#118)
- Emby: sign in with a password or an API key; audiobook libraries scan in, and your place syncs
  with Emby both ways. (#119)
- Plex: press Sign in and enter the code at plex.tv/link; Lelap never sees your Plex password. It
  finds your server at home and away, and keeps your place on Plex. (#119)
- HTTP folder: audiobooks in a folder that nginx, Apache or Caddy lists, with an optional login.
  (#117)
- Choose where downloads go, an SD card for example: Settings → Downloads → Download folder.
  Downloads you already have move there in the background, and “Move back” returns them. Android
  only. (#113)
- Your copy on a work’s page: a book in Discover or Search that you also have in your own storage
  lists “Your copy” first and plays it from your place. Matching happens on your phone. (#116)
- Books match by ISBN or ASIN on their own. A match by title and author asks “In your library?”
  first, and “Not your copy? Unlink” undoes either. (#116)
- Match with catalog… on a library book: pick the work, and the book takes its title, author and
  cover. (#116)
- Internet Archive add-on: old-time radio series as podcasts, lectures, talks and readings from
  archive.org, only in the public domain or under a Creative Commons licence. It isn’t installed
  by default: add `https://catalog.lelap.app/internet-archive/manifest.json` in Settings → Add-ons.
  (#120)
- Open Library reading log: starting a book puts it on Currently reading and finishing it on
  Already read. Set it up in Settings → Add-ons → Comes with Lelap with your archive.org keys,
  which stay on the phone. Android only. (#121)
- Atom podcast feeds subscribe like RSS ones, also from an OPML file. (#113)

### Improved

- Stats and scrobbles count listening with the app closed: Android Auto, headphones, Up Next, a
  night with the sleep timer and time on a speaker while casting. Nothing is counted twice. (#110)
- WebDAV and S3 books without an embedded cover show `cover.jpg`, `folder.jpg` or `cover.png`
  from their folder. (#113)
- Exporting your library, the diagnostics log or your podcasts as OPML shares a real file instead
  of pasted text. (#113)
- Sync stays small: older changes are folded into one sealed snapshot, and a new phone starts from
  it. Sync groups unused for two years are removed from lelap.app; the privacy page says so. (#112)
- An app too old to read a snapshot says “Update Lelap to keep syncing” instead of missing
  changes; it keeps its data and syncs after the update. (#112)
- The APKs are smaller: about 38 MB for 64-bit phones and 30 MB for 32-bit ones.
  (#114, #124)
- F-Droid can rebuild Lelap from source and get the same bytes as our APK, so the APK F-Droid
  ships is the one we sign. The animation library is built without link-time optimisation for
  this, which adds about 0.4 MB to the APK. (#124)
- lelap.app and the developer docs have a light theme by day, and a switch in the header picks
  light, dark or the system’s choice. (#115)

### Fixed

- A server login is no longer sent on when the server redirects to another host, for WebDAV and
  for every add-on inside the app. (#117, #121)
- An add-on inside the app can no longer open the phone’s browser. (#117)
- The web app reads the length of books on your servers; before, it gave up on all of them. (#118)

### Self-hosting and add-on developers

- Protocol revision 5: `Manifest.settings`, a `library` resource listing a server’s files, and
  `headers` on streams and library listings, for add-ons inside the app only. (#117)
- Protocol revision 6: `LibraryResponse.query`, `LibraryFile.downloadUrl`, `LibraryFile.place` and
  a `place` resource for keeping places on the server. (#118)
- Protocol revision 7: a `signin` setting type and resource (a code entered on a website), and
  `LibraryResponse.webQuery` for the web app. (#119)
- Protocol revision 8: an add-on inside the app with `scrobble` and `settings` gets a set-up form,
  and its settings reach its `scrobble` handler. (#121)
- Add-ons inside the app follow no redirects, and a host in `sandbox.hosts` without a port is
  reached over https only. (#121)
- `@lelap/sdk` changesets for the next release: revisions 5 to 8 with their helpers, and the
  matcher the app uses (`createWorkIndex`, `matchStrength`, `idsFromTags`, `lookupWork`). New docs
  page “Mapping your files to works”, and `examples/source-addon`. (#116–#119, #121)
- The catalog Worker and its Docker image serve the Internet Archive add-on at
  `/internet-archive/manifest.json`. (#120)
- Sync: migration `0002_snapshots.sql` runs on deploy. `SYNC_IDLE_EXPIRY_DAYS` removes idle groups
  (a daily cron on Workers, a daily timer in Docker); unset or `0` keeps them for ever. (#112)
- Build tools: pnpm overrides move esbuild and minimatch to patched versions. Both are used only
  while building, not in the app or the services. (#125)
- Releases: `beta.json` and `latest.json` gain `apks`, one entry per CPU type, and F-Droid builds
  one APK per CPU type. The versionCode is the old one times ten plus 2 (64-bit) or 1 (32-bit).
  (#114)

### Known issues

- SMB and SFTP were tested against servers from a computer, not inside the app on a phone. (#122)
- Plex sign-in hasn’t been tried with a real Plex account. Navidrome and Emby were tried in the web
  app only, not on a phone. (#118, #119)
- Casting books from SMB, SFTP, HTTP folder, Subsonic, Emby or Plex servers hasn’t been tried on
  real speakers. (#117–#119, #122)
- Moving downloads to an SD card, and taking the card out, haven’t been tried on a phone. (#113)
- The Open Library reading log hasn’t been tried with a real account. (#121)
- Counting listening with the app closed, and the 32-bit APK, haven’t been tried on a phone yet.
  (#110, #114)

## 0.1.0-beta.4 (2026-11-17)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it.

### New

- Audiobookshelf: add your server with an API key (Audiobookshelf 2.26 or later) and pick its book
  libraries. Books play from the original files, and your place syncs both ways. (#91)
- Find chapters in a book that has none: Player → Chapters → Find chapters marks a part at each
  long silence. Android only. (#98)
- Skip a podcast’s intro and outro, from 15 to 90 seconds, set once per show. Reaching the outro
  marks the episode played. (#98)
- Tablets and laptops: in a wide window the tabs become a rail and the player stands beside your
  library. A phone turned sideways shows the cover beside the controls. (#95)
- Keyboard shortcuts in the web app: Space or K plays and pauses, ← → or J L skip, < > change the
  speed, / opens Search and ? lists them. (#95)
- “Because you finished …” rows on Home suggest books by the same author or series. They are
  worked out on your phone; Hide on the row turns them off. (#101)
- Badges on covers: a rating or “3 new” episodes when an add-on sends them, and ✓ or “42 %” for
  what you finished or started. LibriVox books show their archive.org rating. Turn them off in
  Settings → Catalogs. (#106)
- A diagnostics log, off by default, in Settings → Help → Diagnostics. It keeps the last 500
  events without personal data, and you see the whole file before you share it. (#103)
- Translating Lelap needs no development setup: one file per language, edited in the browser on
  GitHub or sent through the new Translation issue form. (#104)

### Improved

- Casting: the lock screen, the notification, headphones, watches and Android Auto control the
  speaker, and a cast keeps going with the screen off. (#107)
- Casting: the sleep timer fades the speaker’s own volume, the volume keys change it, and a book
  that ends on the speaker is marked finished, with Up Next going on there. (#107)
- Casting: UPnP speakers play at the book’s speed when they support it, and “Play on this phone”
  carries on from the speaker’s place. (#107)
- TalkBack names every control, reads the scrubber as “12:30 of 45:00” and offers Delete on
  bookmarks. Buttons are at least 48 dp, screens hold up at the largest text size, and reduced
  motion stops the animations. (#92)
- Big libraries: with 10,000 books, Library, Home and Podcasts open several times faster, and
  rescanning an unchanged folder takes 0.3 s instead of 7 s on a laptop. The web app starts faster
  and loads less. (#93)
- Notifications, the widget, the Quick Settings tile and Android Auto follow the profile’s
  language. (#104)
- Adding a WebDAV server reads only the folder you entered. Each request gives up after 30 s with
  a clear message instead of spinning. (#94)
- The APK is about half the size: it carries code for ARM phones only. x86 Chromebooks and
  emulators can use the web app. (#85)

### Fixed

- With “Duck on calls” on, pressing Play during a call plays the book quietly instead of pausing
  it again at once. (#89)
- Sync works from the beta: its server goes live with this release. Before, pairing failed
  because the server couldn’t be found. (#99)

### Self-hosting and add-on developers

- Protocol revision 4: `badges` on `MetaPreview` and `Meta` (`rating` 0 to 5, `newEpisodes`).
  Older apps ignore them. The SDK release with revision 4 follows `@lelap/sdk` 0.3.0. (#106)
- `@lelap/sdk` 0.3.0 brings protocol revisions 2 and 3 to npm: health, behaviour hints, artwork
  and add-ons inside the app. (#87)

### Known issues

- Casting with these changes hasn’t been tried on real speakers yet (Sonos, DLNA, Google Cast,
  FCast). (#107)
- Audiobookshelf was tested against a stand-in, not a real server; casting an Audiobookshelf book
  may not play. (#91)
- The tablet layout was checked in a browser only, not on an Android tablet. (#95)
- Find chapters and the intro and outro skips haven’t been tried on a phone yet. (#98)
- A book already playing when a call starts may go silent rather than quieter. (#89)
