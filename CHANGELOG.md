# Changelog

What changed in each Lelap release, newest first.

## 0.1.0-beta.17 (2026-11-21)

This beta changes one line of native code (Android Auto's “Up next”), so Android needs the new
APK: beta 16 can't get it over the air. No database changes and no new permissions.

### Improved

- Every screen has the same header, buttons, text fields, empty screens and notices, in every
  theme. (#284)
- Every tab has the same header with Settings last, so Discover, Search and Podcasts reach
  Settings too. The add-on count moved from Home to Settings › Library and sources. (#285)
- On a wide screen the side rail stays beside every screen, a book's page and Settings included,
  with whole labels and Settings at its foot. (#285)
- Settings rows that open another screen show a chevron and their state, and text follows one
  type scale throughout. (#285)
- Clearer names everywhere: “Stats”, “Sleep timer”, “Up next”, “podcast” instead of “show”, and
  “Needs a connection” on an offline book. The “Metadata only” badge is gone; the Playable only
  filter covers it. (#285)
- Switching tabs and opening Settings is quicker: screens out of sight no longer redraw on every
  player tick or download. (#286)

### Fixed

- A page that can't load (a podcast, series, add-on, place or transcript) now shows Try again
  after 15 seconds instead of spinning forever. (#284)
- The offline line on Library is translated. (#284)

### Self-hosting and add-on developers

- A status page service (`services/status`) checks the landing page, web app, catalog, proxy,
  sync and updates every 5 minutes and shows a page and `/status.json`, with optional email on
  changes. Proxy, sync and updates answer `GET /health`. Docker leaves it out. (#283)

### Known issues

- None of the new look has been checked on a phone yet, and the Malay lines for it wait for a
  native speaker. Tab switching times are measured in logcat but not yet compared on a phone.

## 0.1.0-beta.16 (2026-11-21)

This beta changes native code, so Android needs the new APK: beta 15 can't get it over the air.
One database change runs once at the first start. No new permissions.

### New

- An add-on can say which Lelap it needs. When it needs a newer one, its rows say “Needs a newer
  Lelap” with an Update button instead of failing. (#278)

### Improved

- Audio that is still being prepared now waits with “Preparing…” and a countdown wherever it
  happens: also in the middle of a book, and also when the add-on didn't say so up front. (#276)
- If one copy of a book won't open before it plays, the next copy plays instead. (#276)
- Seeking into a part whose length isn't known yet lands where you meant once the part opens, and
  a book of such parts gets its chapters once every part is measured. (#276)
- In Firefox, skip silence works on variable-bitrate MP3 as well. (#279)
- While casting with your sound settings, the time skip silence saves now counts, and a speaker
  that joins a group mid-book starts at the same place without restarting the others. (#279)

### Fixed

- In Firefox, skip silence no longer speeds through words in constant-bitrate MP3 files without
  an Info frame; it leaves those files alone. (#279)

### Self-hosting and add-on developers

- `@lelap/sdk` 0.8.0 is on npm with protocol revision 15: the app sends its revision as a
  `Lelap-Protocol` header to add-ons that declare 15 or higher, handlers get it as `appProtocol`,
  and `createAddon({ minProtocolVersion })` answers `426 Upgrade Required` to older apps by itself.
  Preflights are cached for a day. (#278, #280)

### Known issues

- Preparing audio mid-book, the next copy on failure, the update prompt for add-ons and the
  casting changes haven't been tried on a phone or on real speakers yet. Skip silence in Safari
  hasn't been measured.

## 0.1.0-beta.15 (2026-11-20)

This beta changes native code, so Android needs the new APK: beta 14 can't get it over the air.
Two database changes run once at the first start. No new permissions.

### New

- Ask the Assistant or Android Auto to play a book or an episode by name, even with the app
  closed: “play Pride and Prejudice on Lelap”, “resume my book” or “the latest episode of …”.
  Android Auto's search lists the matches. (#267)
- WebDAV, Jellyfin and Audiobookshelf servers can have a second address, such as one at home and
  one outside. The app uses whichever answers and moves a playing book across without stopping.
  Existing servers get an Addresses button in Settings → Library and sources. (#268)
- Live streams from add-ons play as a station: “Live” instead of the bar, the song or programme
  on air under the name, no saved place and no download. HLS streams play on Android and the web.
  (#270)
- Settings → Streams orders every add-on's streams by your languages and formats, and shows the
  same release from several add-ons as one row. (#272)
- A BookWyrm add-on shows your public shelves from your own instance as rows, without a password.
  (#252)
- Open lectures has Yale's transcripts: More → Transcript during a lecture. (#253)
- OPDS: a Calibre content server's default login works, books bring their summary, language and
  series, and a catalog with OPDS Progression gets your place back. (#257)

### Improved

- With voice boost, skip silence or other sound settings on, a cast speaker now plays them too.
  (#258)
- In Chrome, skip silence works on variable-bitrate MP3 as well. (#258)
- Taking the leading speaker out of a group no longer stops the others, and each speaker's waits
  fit how fast it answers. (#260)
- The Library redraws only the books that changed, and the web app starts with less to load.
  (#254)
- A stream that is still being prepared says “Preparing…”, counts down and plays when ready, or
  downloads when ready from the download queue. (#269)
- The web app offers a new version with a Reload button instead of waiting for the next visit.
  (#244)
- The add-on review sheet's permission lines are in Malay. (#265)

### Fixed

- Pressing Play twice while a stream starts no longer adds two plays to the history. (#245)
- Choosing an episode's automatic file again no longer reloads it, and the history logs seeks
  while casting where they went. (#265)
- An add-on whose manifest lists something this version doesn't know still loads. (#265)

### Self-hosting and add-on developers

- `@lelap/sdk` 0.7.0 is on npm with protocol revision 14: streams still preparing, parts without
  lengths, `refreshAfter`, and stream `format`, `language`, `releaseId` and `live`. (#269, #270,
  #274) 0.6.0 brought revisions 10 to 13, `waitUntil`, field links and groups, `fingerprint`,
  `log` and `mockFetch`. (#264)
- The developer docs have `llms.txt` and `llms-full.txt`. (#266)

### Known issues

- Voice search, live streams, casting with sound settings, the second server address and the
  BookWyrm and transcript add-ons haven't been tried on a phone, in a car or on real speakers yet.

## 0.1.0-beta.14 (2026-11-20)

This beta changes only the app’s JavaScript, so Android apps on beta 13 get it over the air,
without a new APK. No database changes, no new permissions.

### Improved

- The player shows fewer buttons under the controls: Sleep, Chapters, Bookmarks and Cast, with
  More for Speed, Sound, Transcript, Soundbites and History. Speed stays in the row while it isn’t
  1×, and Sound while its settings are on. (#241)
- On a tablet or a computer, menus and sheets open as a dialog in the middle of the window instead
  of rising from the bottom edge. (#241)
- The Add-ons page puts the field for adding an add-on at the top, above the installed ones.
  (#241)

### Fixed

- A quick double tap, on Settings for example, no longer opens the same screen twice, so one Back
  is enough. Opening a page that is already open further back brings that page forward. (#241)
- A stream whose add-on gives no length no longer shows 0:00 of 0:00 in the player: the app keeps
  the length the player measures. (#241)
- A book from a source that doesn’t allow downloads no longer offers Download in its menu, only to
  refuse. (#241)

## 0.1.0-beta.13 (2026-11-19)

This beta changes the app’s Android code for playback and casting, so it needs the new APK; an
over-the-air update can’t bring it to older APKs. The app offers the APK as usual. At first start
the app’s database adds a table for each book’s playback history. No new permissions.

### New

- Each book keeps a short playback history on your device: plays, pauses, skips, seeks, chapter
  jumps and sleep timer stops, and where each came from (the app, the notification, headphones,
  the car, a watch, the widget, media keys or a shake). Quick skips within 5 s are one entry. It
  keeps the last 50 per book, none older than 30 days, and isn’t synced. Open it with History in
  the player; a tap on an entry goes back to the place before it without playing. (#234)
- After a skip, seek or chapter jump of more than a minute, the player says “Moved from …” with Go
  back for 10 s. (#234)
- On Android, for 30 s after a long jump made away from the app, the notification’s sleep timer
  button becomes “Back to where you were”, and Android Auto shows it too. (#234)
- The web app can cast through the browser: the Cast tool appears when Chrome (Google Cast) or
  Safari (AirPlay) can reach a speaker, and opens the browser’s own list. Sound effects and skip
  silence rest while casting. Downloaded books play only in the browser. (#238)
- Speakers you played on together show at the top of the Cast sheet as one row, “Played together
  before”, with Forget. While a book plays, other speakers have Add and the ones in the group have
  Take out; a speaker that joins starts at the group’s place and is kept in step. (#238)
- After signing in to Plex, the server form lists the server’s music libraries to tick, instead of
  names to type. A server added before keeps its typed names. (#236)

### Improved

- The bedtime routine’s quieter volume and the sleep timer’s fade now reach a cast speaker too, and
  the speaker’s own volume comes back when the timer ends. In a group each speaker keeps its
  share. (#238)
- “Back to when you last used it” after the sleep timer now reads the playback history, so it also
  knows presses from the notification with the app closed. It shows in the web app too. (#234)
- “Because you finished …” tiles show their cover when Home showed that cover earlier in the same
  session, not only for the first ten books of a row. Nothing is saved or synced for it. (#236)

### Fixed

- An FCast receiver that answers pings and then goes quiet no longer runs the place on: it stops
  6 s after the receiver’s last word, and after 15 s the phone takes over, paused. (#238)
- “Connect anyway” now trusts the certificate the refused speaker showed, not its name on the
  network, so another device that takes over the name is asked about again. (#238)

### Self-hosting and add-on developers

- Sync: no D1 migration, and the sync Worker hasn’t changed.
- Catalog service: a new add-on, Lepak (`/lepak/manifest.json`), with Malay, Indonesian and
  Singapore podcasts from Podcast Index in four rows (Cerita, Sembang, Sejarah and Singapura) and a
  search of its own. It is served only when `PODCASTINDEX_KEY` and `PODCASTINDEX_SECRET` are set,
  and the app offers it under Lelap’s own add-ons, off by default, only when the catalog lists it.
  The hosted catalog has no Podcast Index keys yet, so the app doesn’t offer Lepak there; it
  appears once they are set. Feed lookups now fill fields a Podcast Index listing leaves empty,
  such as covers. These deployed with the merges to `main`. (#237)
- Protocol revision 11 gains `choice` settings: fixed `options`, or options the add-on’s new
  `settings` resource lists for the form so far. An app before revision 11 refuses a manifest that
  lists `settings` or has a choice field. (#236)
- Coming with the next SDK release (0.6, not on npm yet; `@lelap/sdk` 0.5.0 is the current one):
  the `choice` settings and the `settings` resource (`ChoiceOption`, `SettingsOptions`,
  `settingsPath`, `choiceOptions`, `choiceValues`, `offersSettingOptions`), and `lelap-sdk check`
  warnings for them. Until then they run from the repository. (#236)

### Known issues

- Playback history is untested on Android: skips from the notification, headphones, watches and
  the car, and the notification’s “Back to where you were”. That button may crowd the
  notification’s controls on some phones; if it does, it will leave the notification and stay in
  the car. (#234)
- Headphone and watch detection is untested on real devices: whether their skips and pauses show
  in History as “headphones” and “watch”. (#234)
- Plex libraries from a list haven’t been tried against a real Plex server. (#236)
- An FCast receiver that goes silent, and one left paused for a long time, are untested on a real
  receiver. (#238)
- The bedtime volume and the sleep timer’s fade on a cast speaker or a group are untested on real
  speakers. (#238)
- Remembered groups, Add and Take out are untested on real speakers. (#238)
- Casting from the web app is untested in Chrome and Safari with a real speaker or TV. (#238)
- “Connect anyway” by certificate is untested against a real receiver that isn’t a Google device.
  Google Cast device authentication with Google’s bundled roots is still untested against a real
  Nest speaker. (#212, #238)
- Playing on several speakers is untested on real speakers. (#212)
- The new Settings has only been tried in the web app: not on Android, with TalkBack or on a
  tablet. (#227)
- Sign in with Hardcover hasn’t been tried with a real Hardcover account, nor has renewing the
  sign-in after a week. (#221)
- Places sent with the app closed to Subsonic, Plex, Emby, Jellyfin or Audiobookshelf are untested
  on a phone and a real server. (#210, #222)
- A Plex book or download that finds the server’s address away from home is untested on a real
  Plex server. (#210, #222)
- Skip silence and even loudness in the web app have only been tried in Chromium, not in Firefox or
  Safari. (#209, #229)
- OPDS hasn’t been tried against a real Calibre server. Calibre may not list M4B books at all,
  since it doesn’t know their file type. Calibre’s default login over http (Digest) isn’t
  supported: set Calibre to Basic. (#230)
- In the web app, Open lectures courses that stream from Yale can’t be downloaded or use the sound
  effects, because Yale’s server doesn’t let the browser read its files. They stream as usual; the
  three courses from archive.org download. Downloads on a phone are untested. (#231)
- Dragging onto a list on an Android tablet is untested on a real tablet. (#228)
- Lists in Android Auto, and playing a list with the app closed or while casting, haven’t been
  tried in a car or on a phone. (#204, #225)
- Books from a server with a login play on Android through a new reader, untested on a phone.
  (#210)
- Foldable layouts are untested on a real foldable, and the dividers on a tablet with a finger.
  (#206, #228)
- Clearing made-up chapter names at first start, and getting typed names back from sync, are
  untested on a real library. (#211, #219)
- Episode file choices with the app closed, integrity checks and chapter pictures on the lock
  screen and in the car are untested on a phone. (#208, #220)
- Themes on Android, including theme files and car mode’s accent, haven’t been looked at on a
  phone. (#199, #216)
- Whole series pages and reading series from the files’ tags are untested on a phone. (#196, #218)
- Ratings sent to Hardcover, and Hardcover’s audiobook editions, haven’t been tried against the
  live service. (#203)
- Car mode sideways, and the tap on a podcast’s place opening a map app, are untested on a phone.
  (#194, #198)
- SMB requires signing for logged-in sessions. A Samba server that maps a login to its guest
  account may stop working. (#191)
- Shared place links open in the web app; opening them in the Android app isn’t switched on yet.
  (#187)
- Some new Malay lines, here and in earlier betas, haven’t been checked by a native speaker.
  (#211, #227, #234, #238)

## 0.1.0-beta.12 (2026-11-19)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it to older APKs. The app offers the APK as usual. At first start the app’s database adds a
table that keeps whole series on the device. One new permission, to see network connections: the
app checks whether the phone is on mobile data to pick an episode’s smaller file with the app
closed. Android grants it at install without asking.

### New

- Settings is a short list of eight groups: Look and language, Listening, Sleep, Library and
  sources, Downloads and storage, People and devices, Backup and updates, and Help. Each opens its
  own page, and each line says what is set now, such as “Night · Amber · English”. Every setting
  stays as it was. (#227)
- A series page lists the whole series in reading order, from Wikidata: the books in your library
  play, and the others show their title, number and year with Look for it. Missing books are named
  in the language of the editions you have. Next in the series names the next book by its title
  when you don’t have it. The list is kept on the device for 30 days, so the page works offline.
  (#218)
- OPDS catalogs as a library source: add a Calibre content server on your home network, or a
  library’s open catalog, under Add a server. Only the audiobooks come in, with their covers; the
  login stays on your device. In the web app the catalog must use https and send CORS headers.
  OPDS is offered under Lelap’s own add-ons, off by default. (#230)
- Open lectures: 37 complete Open Yale Courses as books, one lecture a part, with Yale’s credit
  line and licence on each course’s page. Add it under Lelap’s own add-ons; it is off by default.
  (#231)
- Sign in with Hardcover: the Hardcover add-on’s set-up page signs you in through Hardcover, and you
  never handle a token. Pasting a token you make yourself still works. (#221)
- Android Auto has a Lists shelf. A list opens on Play list, which starts where the list stands, and
  it plays on from item to item with the app closed. (#225)
- Previous in list sits beside Next in list in the notification’s overflow, on the lock screen, on
  watches and in Android Auto, also with the app closed. (#225)
- The tall widget says “Next in list: …” while a list plays. (#225)
- On a tablet or another wide window on Android, press and hold a book or an episode, then move it
  onto a list. Tiles on Home and Discover and Search results can be dragged onto a list as well,
  there and in the web app; the book joins your library without playing. The Library’s list cards
  take drops as well as the side rail. (#228)
- A theme file can be marked high contrast. Saving the High contrast theme marks it, and opening the
  file brings back the thick focus ring and solid badges. (#216)

### Improved

- Skip silence in the web app now works on M4B, Opus, Vorbis and FLAC files as well as on MP3s
  with a constant bitrate. It reads the stream the player already loads instead of fetching it
  twice. A browser that can’t decode the format plays the book unchanged. (#229)
- With Subsonic, Plex or Emby, a pause with Lelap closed now reaches the server about 10 s later
  instead of with the next hourly refresh. Jellyfin and Audiobookshelf get the place sooner too.
  (#222)
- A Plex book started with Lelap closed (from Up Next, Android Auto, the widget or headphones) finds
  the server’s current address before it plays, and a Plex download does the same, so both work
  away from home. (#222)
- On Android, episodes started with the app closed follow the connection: on mobile data a show
  set to Automatic streams its smallest file. (#220)
- Web downloads check a file against the hash its feed gives, as the phone does. A file that
  doesn’t match isn’t kept. (#220)
- The browser’s media controls show the picture of the chapter playing, and the cover where a
  chapter has none. (#220)
- In car mode, a theme file’s accent stays, made darker or lighter until it reads well on the day
  or night colours. (#216)
- Changing the theme or the accent no longer moves Settings back to the top. (#216)
- Switching the language renames untitled chapters at once on the notification, the lock screen,
  the widget and Android Auto. (#219)
- Chapters you make from chapters found from silences are named “Part n”. (#219)
- An SMB or SFTP failure, a download that can’t be saved and casting to an unknown kind of receiver
  now show a translated line instead of English. (#219)
- On a foldable half open on a table, the screens above the hinge no longer leave room for the
  navigation bar, and the layout no longer splits the old window when the hinge is reported first.
  (#228)
- A playing list reads only its own books, not the whole library. (#225)

### Fixed

- Chapter names you typed yourself are kept. Beta 11 cleared your own chapter names that read
  exactly “Chapter n” or “Bab n” for their place; a phone that updates from beta 10 or earlier now
  keeps them. With sync on, a phone that already ran beta 11 gets those names back from the sync
  group where its chapter list hasn’t changed since. Without sync they have to be typed again.
  (#219)

### Self-hosting and add-on developers

- Sync: no D1 migration, and the sync Worker hasn’t changed.
- Catalog service: a new default add-on, Whole series (`/series/manifest.json`), reads Wikidata
  with no key. Open lectures is under `/lectures`. Hardcover sign-in needs `HARDCOVER_CLIENT_ID`
  and `HARDCOVER_CLIENT_SECRET` (on Docker in `.env`, plus `CATALOG_ORIGIN` when the catalog is
  public under another address); without them, pasting a token still works. On Workers each
  sign-in is a Durable Object; on Docker it is a file in the secrets volume, so back that up.
  These deployed with the merges to `main`. (#218, #221, #231)
- Protocol revision 11 gains the `series` resource. An app before revision 11 refuses a manifest
  that lists it, so keep it in an add-on of its own. (#218)
- Coming with the next SDK release (0.6, not on npm yet; `@lelap/sdk` 0.5.0 is the current one):
  protocol revisions 10 and 11 with the `series` resource, `lelap-sdk check` with `--series`, and
  `text.signIn` on the configure page for signing in with the service. Until then they run from the
  repository. (#218, #221)

### Known issues

- The new Settings has only been tried in the web app: not on Android, with TalkBack or on a
  tablet. (#227)
- Sign in with Hardcover hasn’t been tried with a real Hardcover account, nor has renewing the
  sign-in after a week. (#221)
- Places sent with the app closed to Subsonic, Plex, Emby, Jellyfin or Audiobookshelf are untested
  on a phone and a real server. (#210, #222)
- A Plex book or download that finds the server’s address away from home is untested on a real
  Plex server. (#210, #222)
- Skip silence and even loudness in the web app have only been tried in Chromium, not in Firefox or
  Safari. (#209, #229)
- OPDS hasn’t been tried against a real Calibre server. Calibre may not list M4B books at all,
  since it doesn’t know their file type. Calibre’s default login over http (Digest) isn’t
  supported: set Calibre to Basic. (#230)
- In the web app, Open lectures courses that stream from Yale can’t be downloaded or use the sound
  effects, because Yale’s server doesn’t let the browser read its files. They stream as usual; the
  three courses from archive.org download. Downloads on a phone are untested. (#231)
- Dragging onto a list on an Android tablet is untested on a real tablet. (#228)
- Lists in Android Auto, and playing a list with the app closed or while casting, haven’t been
  tried in a car or on a phone. (#204, #225)
- Google Cast device authentication now uses Google’s bundled roots and is untested against a
  real Nest speaker. If a genuine speaker is refused, Connect anyway lets it in. (#212)
- Playing on several speakers is untested on real speakers. (#212)
- Books from a server with a login play on Android through a new reader, untested on a phone.
  (#210)
- Foldable layouts are untested on a real foldable, and the dividers on a tablet with a finger.
  (#206, #228)
- Clearing made-up chapter names at first start, and getting typed names back from sync, are
  untested on a real library. (#211, #219)
- Episode file choices with the app closed, integrity checks and chapter pictures on the lock
  screen and in the car are untested on a phone. (#208, #220)
- Themes on Android, including theme files and car mode’s accent, haven’t been looked at on a
  phone. (#199, #216)
- Whole series pages and reading series from the files’ tags are untested on a phone. (#196, #218)
- Ratings sent to Hardcover, and Hardcover’s audiobook editions, haven’t been tried against the
  live service. (#203)
- Car mode sideways, and the tap on a podcast’s place opening a map app, are untested on a phone.
  (#194, #198)
- SMB requires signing for logged-in sessions. A Samba server that maps a login to its guest
  account may stop working. (#191)
- Shared place links open in the web app; opening them in the Android app isn’t switched on yet.
  (#187)
- Some new Malay lines, here and in earlier betas, haven’t been checked by a native speaker.
  (#211, #227)

## 0.1.0-beta.11 (2026-11-19)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it to older APKs. The app offers the APK as usual. At first start the app’s database makes
room for a show’s episode file choice and for a confirmed work’s series, and clears chapter names
that an earlier scan made up (“Chapter 3”, “Bab 3”), so they show in your profile’s language. No
new permissions. The app now includes Jetpack WindowManager, which reads a foldable’s hinge.

### New

- Play on several speakers: tick two or more in the Cast sheet, of any kind (a Sonos and a Nest
  speaker, say), and the book plays on all of them. The first one ticked leads, and the others are
  moved back in step when they drift more than 1 s. Volume keeps each speaker’s share. A speaker
  that can’t be reached or goes quiet leaves the group, and the rest play on. (#212)
- Skip silence and even loudness in the web app, in the Sound sheet and Settings as on Android.
  Skip silence works on MP3 files with a constant bitrate, such as LibriVox’s. Even loudness reads
  a file’s ReplayGain tags, or measures the book and brings it towards one level. A file from a
  host that doesn’t let the browser read it plays without the effects. The audio still goes
  straight from its host to the browser. (#209)
- Episode file: a show whose feed offers other files of each episode, such as a smaller AAC or
  Opus file, gets an Episode file row on its page: Automatic, Smallest, the feed’s own file or one
  of the others. Automatic plays the feed’s own file, and the smallest one on mobile data. The
  choice is per show and profile, and syncs. Switching keeps your place and bookmarks; a
  downloaded episode keeps the file it downloaded. (#208)
- Chapter pictures from a podcast’s chapters file show on the lock screen, in the notification and
  in Android Auto as each chapter starts, with the cover where a chapter has none. (#208)
- A third column on wide screens: from 1400 points wide, a book’s or a show’s page opens between
  the list and the player. ✕ or Back closes it. The lines before the page and the player can be
  dragged, or moved with ← and → when they have focus; Home resets them. The widths are kept on
  the device. (#206)
- Foldables: half open like a book, the screens end at the hinge and the player starts after it.
  Half open on a table, the screens sit above the hinge and the player below. Nothing is drawn
  under the hinge. (#206)
- In the web app, the side rail lists your lists under the tabs, and a book or an episode can be
  dragged onto a hand-made one. The list lights up and says Added. (#206)

### Improved

- Google Cast speakers must now prove they are genuine Google Cast devices before Lelap connects.
  When one doesn’t, the Cast sheet says so and offers Connect anyway, which lets in that one
  speaker until the app restarts. (#212)
- Downloads check a file against the hash its feed gives (`podcast:integrity`). A file that
  doesn’t match isn’t kept, and Downloads says why. (#208)
- A chapter without a title is named in the language of the profile looking at it: “Chapter 3” in
  English, “Bab 3” in Bahasa Melayu, and “Part 3” for chapters found from silences. This holds in
  the chapter list, the player, car mode, bookmarks, the notification, the widget and Android
  Auto. (#211)
- The notification’s play and pause descriptions follow the profile’s language. (#211)
- Failed downloads and moves, storage errors, app updates, casting faults and the line under the
  player show a translated line for what went wrong, instead of Android’s own error text. The web
  player does the same. (#211)
- A place saved with Lelap closed (paused from the notification, the lock screen or the car) now
  reaches the book’s server. It goes when the app next opens, and for Jellyfin and Audiobookshelf
  also from the background refresh, about once an hour. It never replaces a newer place. (#210)
- Plex: when your server’s address changes, a scan finds the new one through plex.tv without a
  new sign-in. Before a book streams, Lelap checks which address answers as your server, so books
  play away from home without a rescan. (#210)
- Books from a server with a login follow the server’s redirects, and the login goes only to the
  book’s own server. (#210)
- A streamed book’s series now syncs, so another device shows it under Series without playing it
  first. Jellyfin audiobooks get their series from the server. Saying yes to “In your library?”
  keeps the work’s series, while the book keeps its own title and cover. (#214)
- The web app starts sooner with a large library. With 10,000 books, in headless Chrome on an
  Apple M1 Max with the production build, the Library showed its rows in 0.34 s instead of 0.85 s
  and Home in 0.27 s instead of 0.65 s, and the app held 47 MB less memory. A save takes about
  18 ms longer. (#213)
- Fewer wakeups while a book plays on Android: the sleep timer ticks every 5 s until its last
  minute, the lock screen’s chapter title is checked at the next chapter mark, the app hears the
  player every 10 s in the background, and downloaded and local books no longer hold a Wi-Fi lock.
  Battery use on a phone hasn’t been measured yet. (#213)

### Fixed

- A book you hid no longer shows its number as missing in its series, and Next in the series
  doesn’t ask you to look for it. (#214)
- Files tagged with a series name and only a movement number (`MVIN`) no longer take that number
  as the book’s number in the series. (#214)
- A streamed book added again from an add-on that no longer names a series loses the old one.
  (#214)
- On Android, the time skip silence saved goes to the right book when books switch, and each
  part’s ReplayGain applies from its first sample instead of a moment late. (#209)

### Self-hosting and add-on developers

- Sync: no D1 migration, and the sync Worker hasn’t changed. A show’s episode file choice and the
  series of streamed books and confirmed works travel as new fields on existing operations, which
  older app versions leave alone. (#208, #214)
- Protocol revision 11, for add-ons inside the app: a library listing can return `settings` (new
  values for the add-on’s own fields, such as a server’s new address), and a new `locate`
  resource says where a book’s files stream from just before it plays. (#210)
- The protocol now says an add-on may leave a chapter’s title empty; the app names it in the
  listener’s language. (#211)
- Coming with the next SDK release (0.6, not on npm yet; `@lelap/sdk` 0.5.0 is the current one):
  protocol revisions 10 and 11, the larger configure page, sealed settings bound to the add-on’s
  ID, and `lelap-sdk check`. Until then they run from the repository. (#191, #200, #203, #210)
- The app already speaks revision 11: the web app since these changes reached `main`, and the
  Android app with this beta. (#210)

### Known issues

- Google Cast device authentication now uses Google’s bundled roots and is untested against a
  real Nest speaker. If a genuine speaker is refused, Connect anyway lets it in. (#212)
- Playing on several speakers is untested on real speakers. (#212)
- Books from a server with a login now play on Android through a new reader, untested on a phone.
  (#210)
- Places saved with the app closed reaching Jellyfin, Audiobookshelf or Plex are untested on a
  phone and a real server. (#210)
- Foldable layouts are untested on a real foldable, and the dividers on a tablet with a finger.
  (#206)
- Skip silence and even loudness in the web app have only been tried in Chromium. (#209)
- Clearing made-up chapter names at first start is untested on a real library. (#211)
- Episode file choices, integrity checks and chapter pictures on the lock screen and in the car
  are untested on a phone. (#208)
- The new notification texts in Bahasa Melayu are untested on a phone, and some new Malay lines
  haven’t been checked by a native speaker. (#211)
- Themes on Android: the themes haven’t been looked at on a phone. (#199)
- Android Auto covers rely on the access each car app gets per list. Covers in Android Auto
  haven’t been tried in a car with this change. (#194)
- Playing a list with the app closed, in the car and while casting is untested. (#204)
- Reading series from the files’ tags is untested on a phone. (#196, #214)
- Ratings sent to Hardcover, and Hardcover’s audiobook editions, haven’t been tried against the
  live service. (#203)
- Car mode sideways, and the tap on a podcast’s place opening a map app, are untested on a phone.
  (#194, #198)
- SMB requires signing for logged-in sessions. A Samba server that maps a login to its guest
  account may stop working. (#191)
- Shared place links open in the web app; opening them in the Android app isn’t switched on yet.
  (#187)

## 0.1.0-beta.10 (2026-11-19)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it to older APKs. The app offers the APK as usual. At first start the app’s database notes
when each podcast episode arrived and gets a “Play finished ones too” setting for lists. No new
permissions. Android Auto now gets read access only to the covers in the lists it asked for,
instead of the cover provider being open to every app.

### New

- Themes, in Settings → Theme: Night (the default), Dusk, Day, Sepia, High contrast, and Like the
  phone, which follows the phone’s light or dark setting. Settings → Accent picks Amber, Teal,
  Rose, Blue, Green or Violet. Both are kept per profile. High contrast keeps text at 7:1 or more.
  A theme can be saved as a small file and opened on another device; a file with anything besides
  a name and its colours, or with colours that are too hard to read, is refused with the reasons.
  (#199)
- Series: Library → Series lists each series with its author, how many books you have, how many
  you finished and which numbers are missing. A series page shows the books in reading order, and
  each missing number has Look for it, which searches your add-ons’ catalogs. You can change the
  order, and it syncs. The player links to the book’s series and, at the end of a book, offers the
  next one. (#196)
- Series also come from the files’ own tags on Android, from an add-on’s details for streamed
  books and from Match with catalog…, as well as from Audiobookshelf. The next scan reads the
  first file of each book once more for this. (#196)
- Play a list from start to end: Play list starts where the list stands and plays item after
  item, books and episodes alike, also with the app closed. Tapping an item plays the list from
  there. The player says which list it plays from and what comes next, with Previous and Next in
  list. Up Next still comes first. (#204)
- While a list plays, the notification, the lock screen and Android Auto have Next in list. In car
  mode, Next chapter becomes Next in list in a book’s last chapter. A list can also play its
  finished items again from their start (“Play finished ones too”). (#204)
- Ratings: stars on a book’s page and Rate… in its menu, in half stars. Ratings are kept per
  profile, sync to your other devices and go to the scrobbling add-ons you set up, such as
  Hardcover for a book already on one of your Hardcover shelves. The row says which add-ons get it.
  (#203)
- “New” on podcasts: the Podcasts tab shows how many episodes arrived since you last opened a
  show, and the show’s page marks them. Opening the page clears it. Counted per device. (#202)
- A podcast’s place (`podcast:location`) shows under its author as a link that opens your map app,
  or OpenStreetMap in a browser; an episode with its own place shows it too. Shows that take small
  payments as you listen (`podcast:value`) get a card that says through what and to whom. Lelap
  draws no map and sends no payments. (#198)
- After a Goodreads import, Lelap can look up your to-read books it doesn’t have in your search
  catalogs, if you say yes; those it finds make a Want to read · Goodreads row on Home. (#203)
- Car mode turns sideways on a phone: cover and title on the left, the buttons in a column on the
  right. The rest of the app stays upright, and the phone’s auto-rotate setting still applies. At
  night, car mode’s background takes a faint tint from the cover. (#194)

### Improved

- The Hardcover and gPodder set-up pages have the steps on the page, and the link they make is
  copied with a tap. Opened from the app, the page hands the link straight back. Links made before
  keep working. (#203)
- The Open Library reading log puts a book you began before setting it up on Currently reading.
  gPodder and the reading log only get the kinds of events they use. (#203)
- On Android, finishing a book with the app closed now tells scrobbling add-ons where that
  listening session began, as the app already did while open. (#203)
- Catalog tiles show the rating their item’s page last showed. Hardcover lists audiobook
  editions, and more editions get their narrators, length and cover filled in. (#203)
- The web app’s position bar zooms with Z while it has focus; ? lists the key. (#202)
- Stats and the year overview follow the app’s theme. (#199)
- The first start names the free-book add-ons this build installed, instead of always LibriVox.
  (#192)

### Fixed

- Headphone battery: a listening session’s drain is counted once, also when the app restarts in
  the middle of it. (#194)
- LibriVox no longer repeats books when you page through a list after an uneven page. (#201)
- Pasting a bare Hardcover or gPodder add-on link opens its set-up page instead of installing an
  add-on that can’t work yet. (#201)
- Covers that a server sends without an image type now show in the web app. (#202)
- A saved cover that went missing falls back to the catalog’s cover instead of the title’s
  letter, and is saved again. (#202)
- Subsonic and Plex chapters that showed as “001 …” get their track titles on the next scan.
  (#202)
- Updating no longer brings back the welcome for an install whose only traces were add-ons, a
  sync group or listening history. (#192)

### Self-hosting and add-on developers

- Sync: no D1 migration, and the sync Worker hasn’t changed. Series order and ratings travel as
  new kinds of sync operations, which older app versions skip. (#196, #203)
- The catalog takes `APP_ORIGINS`: web builds of the app that the Hardcover and gPodder set-up
  pages may send the listener back to. In Docker it comes from `WEB_ORIGIN`. (#203)
- The proxy’s `/cover` recognises JPEG, PNG, GIF, WebP and AVIF by their first bytes, up to 10 MB,
  and refuses SVG, HTML and audio whatever their type says. (#202)
- Release builds take `LELAP_CONTACT` (a repository variable) for the User-Agent that Open Library
  sees. (#203)
- The hosted catalog’s LibriVox, Hardcover and gPodder add-ons pass the add-on check; Hardcover and
  gPodder answer `/health` before they are set up. (#201)
- Coming with the next SDK release (0.6, not on npm yet; `@lelap/sdk` 0.5.0 is the current one):
  protocol revision 10, with `events` on the `scrobble` resource, `rate` without a rating to take
  one back, `resumed` only to an add-on that heard of the book, and `sessionStartMs` on every
  `finish` that ends a session; a larger configure page (`url` and `choices` fields, page text, a
  second page, a manifest per listener); and `lelap-sdk check`, which checks an add-on the way
  the app reads it, with `--json` and exit codes for CI. Until then the check runs from the
  repository. (#200, #203)
- The app already speaks revision 10: the web app since these changes reached `main`, and the
  Android app with this beta. (#203)

### Known issues

- Themes on Android: the colours now come from variables set at the app’s root. The emulator test
  passed, but the themes haven’t been looked at on a phone. (#199)
- Android Auto covers now rely on the access each car app gets per list. Covers in Android Auto
  haven’t been tried in a car with this change. (#194)
- Playing a list with the app closed, in the car and while casting is untested. (#204)
- Reading series from the files’ tags is untested on a phone. (#196)
- Ratings sent to Hardcover, and Hardcover’s audiobook editions, haven’t been tried against the
  live service. (#203)
- Car mode sideways, and the tap on a podcast’s place opening a map app, are untested on a phone.
  (#194, #198)
- SMB requires signing for logged-in sessions. A Samba server that maps a login to its guest
  account may stop working. (#191)
- Shared place links open in the web app; opening them in the Android app isn’t switched on yet.
  (#187)
- Some new Bahasa Melayu lines haven’t been checked by a native speaker.

## 0.1.0-beta.9 (2026-11-18)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it to older APKs. The app offers the APK as usual. At first start the app’s database gets
a table for chapters you edit yourself. Add-ons on Android now make their requests through a new
client in the app, which keeps them away from your home network unless you typed the address.

### New

- A first start for a new device: a welcome, then where your books are (a folder on this phone, a
  server, or the free books already there; on the web, another device with Lelap), then Lelap’s
  own optional add-ons. Every step has Skip, and it never shows again for that profile. A device
  that already has books never sees it, nor does a kids profile. (#174)
- Edit chapters for any book: rename them, change where one starts (typed, or Now for where you
  are), add and remove. Your chapters are kept per profile, survive a rescan and sync to your
  other devices. Reset brings back the book’s own. (#175)
- Bookmark notes can be changed at any time, and Library → Bookmarks lists every book’s bookmarks,
  newest first. A tap plays from there. (#175)
- Share a place, a bookmark or the last 30 seconds as a link, in a book or a podcast episode. The
  link names the book or the show and episode, never a file path or the audio; whoever opens it
  plays their own copy, or is offered the book in the catalog or the show to follow. An episode
  isn’t shared when its feed address has a login, a query or what looks like a key. (#175, #182)
- During calls, in Settings → Playback (Android): Pause, or Lower the volume to a level from 20 to
  100 %. 20 % is the default and the old level. (#185)
- The bedtime timer can turn the volume down to 80, 60 or 40 % for the night, and now also starts
  when bedtime begins while a book is playing (Android). (#181)
- After the sleep timer stops, the player offers “Back to when you last used it”, with the clock
  time, or 5, 10 or 15 min back. Nothing jumps by itself (Android). (#181)
- Podcasts: the player shows each chapter’s picture from the episode’s chapters file, and an
  episode with soundbites gets a Soundbites button. A soundbite plays from its start and pauses
  at its end. (#182)
- A long press on the elapsed time zooms the scrubber to the ten minutes around where you are.
  Marks, snapping and TalkBack’s swipes work inside it; tap the note over the bar to zoom out.
  (#186)
- Web app: P and N move between chapters, B adds a bookmark (with Undo), and 1 to 5 open the tabs.
  The installed web app has Library, Search, Podcasts and Downloads in its icon’s menu, its window
  names the book, and Settings has Install Lelap where the browser offers it. (#187)

### Improved

- Find chapters starts at once when you ask for it. It waits only when the battery really is low,
  and then carries on from where it stopped. The sheet and the notification show how far it is
  through the book. (#175)
- Shake for more time is a setting in Settings → Playback, on by default. (#181)
- Web downloads wait while the browser is offline and carry on when it is back; a connection that
  drops mid-file is retried. A book that won’t fit says “Not enough space” with what it needs and
  what is left. Downloads asks the browser to keep its storage and says whether it does. Server
  logins go with web downloads, as on Android. (#187)
- A cover you chose with Match with catalog… is kept on the phone, so it shows offline. (#186)
- Saving in the web app no longer works out a checksum of the whole library on each change. (#186)
- On a narrow phone the player’s tools wrap into rows and their labels no longer end in “…”; the
  playback buttons shrink to fit. (#186)
- Accessibility: every screen has a heading, errors are read out when they appear, buttons keep
  their name while they show a spinner, text fields are at least 48 points tall, and dimmed items
  still have readable contrast. A profile’s initial is dark on amber, teal and rose. Car mode fits
  a 320-point screen, and the handoff banner works at large text sizes. (#190)
- Empty screens say what to do: Home points to the Library, an empty Library offers a folder, a
  server and the free books, and Podcasts offers a search. (#174)
- An add-on on Android can’t reach addresses on your home network, unless you typed that address
  yourself (as for Subsonic, Plex or Emby). Each add-on has at most six requests open at a time.
  (#191)
- An add-on update that asks for more, such as a new kind of access, plain http or new hosts,
  shows the review sheet again. A `lelap://addon` link can only move an installed add-on to a new
  address on the same server. (#183, #191)
- SMB requires signing for logged-in sessions; guest logins are unchanged. (#191)
- Casting: the phone serves your files to a speaker only over Wi-Fi or Ethernet, also with a VPN
  on, and fetches only from the address that answered discovery. Speaker descriptions with a DTD
  are refused. (#183, #191)
- Android Auto’s cover provider opens only image files, and covers synced from another device must
  be web addresses. A book streamed from another device is added only with web addresses. (#183,
  #191)

### Fixed

- Find chapters no longer sits on “Waiting for enough battery.” with a full battery. (#175)
- A podcast cover that fails to load shows the title’s letter instead of an empty tile, and a
  chapter picture that fails falls back to the episode’s cover. (#186)
- Leaving car mode early no longer fails in the web app, and the web tab bar no longer cuts off
  its labels. (#190)

### Self-hosting and add-on developers

- Sync: no D1 migration, and the sync Worker hasn’t changed.
- `docker compose up -d` in `docker/` now starts the web app, catalog, proxy and sync with health
  checks, and makes `ADMIN_TOKEN` and `CONFIG_SECRET` on first start. `updates` is behind
  `--profile updates`, and `--profile https` adds Caddy. Settings are in `docker/.env.example`.
  (#176)
- Each service has an admin page on its own port (9787 to 9790), behind a token, on
  `127.0.0.1` only, and answering only IP addresses, `localhost` and `ADMIN_HOSTS`. Ten wrong
  tokens lock an address out for 15 minutes. `SERVICE_BIND` keeps the service ports on loopback.
  (#176, #183, #191)
- Upgrade note: each service now has its own secrets volume. The catalog keeps the existing
  one, so Hardcover and gPodder set-ups keep working; proxy, sync and updates get new admin tokens
  unless `ADMIN_TOKEN` is set in `.env`. (#183)
- `node sync-db.mjs` in the sync image backs up, verifies and restores the sync database; guide in
  `docker/backup.md`. Reverse proxy examples for Caddy, nginx and Traefik are in
  `docker/reverse-proxy/`. (#176)
- Shared place links open in the Android app through App Links when the web build has
  `LELAP_ANDROID_CERT_SHA256`. (#187)
- Each release now has an SBOM, `lelap-<version>-sbom.cdx.json`, with the app’s npm packages and
  the Android libraries, and the Docker images have SBOM attestations. (#183, #191)
- `@lelap/sdk` 0.5.0 is on npm with protocol revision 9. (#172)
- Coming with the next SDK release (0.6, not on npm yet): settings are sealed as `e2.` tokens
  bound to the add-on’s manifest ID, so two add-ons sharing a secret can’t read each other’s.
  `e1.` tokens still open. (#191)
- Your first add-on, a step-by-step guide at `/docs/guide/`, with its code as a tested sample in
  `examples/guide-addon`. (#179)
- Protocol: no new revision. On Android, a declared host that resolves to a private, loopback or
  link-local address is refused, and each add-on has six requests in flight at most. (#191)

### Known issues

- None of this beta has been tried on a phone yet. The new add-on client on Android is tested only
  in code: Subsonic, Plex, Emby and other servers on your home network haven’t been tried through
  add-ons on a phone. (#191)
- SMB now requires signing for logged-in sessions. A Samba server that maps a login to its guest
  account may stop working. (#191)
- Casting, TalkBack and the During calls slider are untested on a phone. (#183, #185, #190, #191)
- Shared place links open in the web app; opening them in the Android app isn’t switched on yet.
  (#187)
- Bedtime volume, Back to when you last used it, Edit chapters and Find chapters starting at once
  are tested only in code. (#175, #181)
- Some new Bahasa Melayu lines haven’t been checked by a native speaker.

## 0.1.0-beta.8 (2026-11-18)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it. The app offers it as usual. At first start the app’s database gets a table for places
waiting to reach your servers, and room for each book’s and show’s sound choices. The Android app
now shares saved covers with Android Auto.

### New

- Better sound, in Player → Sound. Voice boost brings soft and loud words closer together. Skip
  silence shortens pauses longer than 0.4 s, and the sheet shows the time it saved, such as
  “12 min saved in this book”. Even loudness keeps books at one level, using the volume tags in
  the files when they have them. Choose them for one book or one show, or keep the defaults from
  Settings → Playback; your choices sync like speed does. Skip silence and even loudness are on
  Android only; the web app has voice boost. A speaker you cast to plays without them. (#169)
- Stats: time listened today, this week, this year and in all, with bars for the last 7 days and
  the last 8 weeks. Your current and longest streak, and the books you finished this year. (#168)
- Year in sound: per year, the time, the days you listened, the books you finished, your longest
  streak, your busiest day and a bar per month. Share it as an image, drawn on your phone; nothing
  else leaves it. (#168)
- A book’s page lists its audio editions when there are two or more. Choose one to see its cover,
  year and narrators, and add-ons look for audio by that edition. The choice stays on this device.
  (#170)
- “Stop reading” in a book’s menu tells your trackers you stopped; Hardcover shows it as Did not
  finish. “Mark as finished” now tells your trackers too. (#170)
- Your cars: with “Offer car mode in the car” on, Settings lists your connected Bluetooth audio
  devices. Mark one as a car if it reports itself as headphones. (#165)

### Improved

- Car mode looks like the player: a large cover, the title in large type, the chapter below it,
  and round buttons for back, play and forward. It turns light when the phone is in light mode,
  and the cover shrinks so a warning or large text never pushes a button off the screen. (#165)
- Android Auto shows the covers saved on your phone. (#165)
- The widget’s back and forward buttons work with nothing loaded: they load the last book at its
  place. With no book at all, they are hidden. (#165)
- Places for Jellyfin, Audiobookshelf, Subsonic, Plex and Emby wait on the phone until the server
  answers, and go out when the app starts or comes back to the front. Only the latest place per
  book is kept. (#164)
- Audiobookshelf narrators and series, and Jellyfin narrators, show under the title in the
  player. An Audiobookshelf book made of several files gets the server’s chapters for the whole
  book. (#164)
- Dates and numbers follow the profile’s language with the phone’s region: English on a Danish
  phone writes 18/11/2026. Durations such as “3 h 12 min left” are translated too. (#163)
- More of the app speaks the profile’s language: errors from downloads, casting and app updates,
  untitled chapters (“Bab 3” in Malay), a Bluetooth device without a name, the headphone battery
  banner, the car mode offer and download states. (#163)
- The headphone battery estimate counts drain only while a book plays and remembers it per
  device, so earbuds that last long get a fairer estimate. (#165)
- Lelap’s own add-ons, such as Hardcover, say “This add-on is made by Lelap.” instead of the
  warning for add-ons from others. On their setup pages a tap copies the add-on link. (#157)
- Open Library and Hardcover can ask Lelap to wait before sending again, and it does. (#170)
- Audnexus is asked in the stores that fit the edition’s language. The Internet Archive shows one
  recording uploaded at two bitrates once, and dates broadcasts from the 2000s in the right
  century. (#170)
- An Audiobookshelf track with an unusual file extension is kept, and a book without a title is
  named after its folder. (#164)

### Fixed

- Hardcover’s choices page keeps your ticks and typed links when it shows an error. (#170)
- Carrying on with a book no longer moves it back to Currently reading on Open Library or
  Hardcover, and playing the end of a finished book leaves it read there. (#170)
- A place is no longer sent at 0 when playback starts, before the player moves to the saved
  place. (#164)
- When the profile that added a server is deleted, places still go out to the server. (#164)
- Subsonic: bookmark times are corrected when the server’s clock is off, and a big library may
  take up to 10 min to list instead of failing after 2. Plex finds a book’s place faster after a
  restart, and Emby no longer loses items from a long library. (#164)
- A sign-in no longer overwrites a field you changed while it ran. When a book on an SMB, SFTP or
  Audiobookshelf server fails to play, a refused login shows in Settings straight away. (#164)
- After a download is complete, its job file no longer keeps the server login or SFTP key. (#164)

### Self-hosting and add-on developers

- Sync: no D1 migration, and the sync service hasn’t changed.
- Protocol revision 9: a meta’s `editions`, `resumed` on a `start` event, `next` for a library in
  pages (up to 1,000 pages and 200,000 files), and settings on every call for an add-on inside the
  app with settings and no library. Backward compatible both ways. (#170)
- `@lelap/sdk`: a minor release (0.5.0) is waiting as a changeset with revision 9, `Edition`,
  `setUpWithSettings`, `AddonError`’s `{ retryAfter }` and `PAGE_STYLE`. Configure pages now say
  “This page is run by {host}, not by Lelap.” The matcher patch from beta 7 is still waiting too.
  npm still has 0.4.0 until the SDK is released. (#170)
- The Hardcover choices page seals its drafts apart from add-on links, with an hour’s expiry. The
  token cache key is now an HMAC keyed with `CONFIG_SECRET`. (#170)
- The Android app exports a read-only content provider at `<package>.covers` for Android Auto. It
  serves only covers of books the car already lists, by hash, never by path. (#165)
- The WebDAV and S3 code is now tested against real servers in CI, and an emulator test starts the
  app on `main`. (#167)

### Known issues

- None of this beta has been tried on a phone yet: better sound, stats, car mode, Android Auto
  covers, the widget, the server place queue, editions and the translated lines are tested only
  in code and in the web preview. (#163, #164, #165, #168, #169, #170)
- Casting receivers are only partly tested: discovery and casting to a Google Cast speaker
  worked on beta 7; the other kinds of speaker haven’t been tried with this beta.
- Find chapters can stay on “Waiting for enough battery.” for a long time before it starts, even
  with a full battery.
- Some new Bahasa Melayu lines haven’t been checked by a native speaker.

## 0.1.0-beta.7 (2026-11-18)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it. The app offers it as usual. The app’s database doesn’t change. In the web app, a library
saved by an earlier version is moved to the new storage once, the first time it opens.

### New

- The Library opens in three groups: In progress, by when you last played; Not started, by when
  you added it; and Finished, by when you finished it. Finished starts closed, and the Library
  remembers whether you opened it. The first pill is now Progress, which replaces Recent; Title
  and Author still show one list. (#153)
- Covers come from image files next to the audio, in your folders and on your servers. For each
  book the first that fits wins: a picture in the tags; an image with the audio file’s name
  (`s01e01.mp3` → `s01e01.jpg`); an image called cover, folder, front, poster or albumart; an image
  named after the folder; the only image. Among several others, Lelap picks the most nearly
  square, then the largest. A better match added later replaces that guess at the next scan.
  (#150)
- A rescan button in the Library’s header, when you have a folder or a server. (#155)
- Soundbites: a podcast page says how many an episode has. Hold the episode to list them, and tap
  one to play the episode from there. (#148)
- A show that names its place shows “Place: …” under its author. (#148)

### Improved

- The web app saves much faster: it writes only the part of the library that changed. In a library
  of 10,000 books, one change writes 256 KB instead of 49 MB. (#151)
- The web app shows covers from your WebDAV, S3, Subsonic and Plex servers. It fetches them once
  with your login, straight from your server, and keeps them in the browser. (#151)
- In the web app, media keys and the browser’s media controls show the chapter that’s playing,
  and dragging there seeks within it. The Delete key hides a Library row or deletes a bookmark.
  The scrubber moves with the arrow keys, Page Up, Page Down, Home and End. Screen readers get the
  same hints as TalkBack. (#151)
- Casting skips a podcast’s outro on the speaker too: the episode counts as played and Up Next
  goes on, as on the phone. (#149)
- Smart rewind on a speaker is one jump before it plays, so you no longer hear a moment at the old
  place first. A stopped speaker loads the file once instead of twice. (#149)
- When a speaker drops off, the place stops moving after 3 s. A Google Cast speaker that stays
  silent for 15 s counts as lost, and the phone takes over. (#149)
- Lelap now checks a Google Cast speaker’s identity on a connection of its own. For now it only
  writes the result to the Android log; casting goes on whatever it says. (#149)
- The skip buttons in the Player and car mode show your skip interval (10 to 60 s), not always 30.
  (#155)
- The Continue card names the chapter. (#155)
- Places saved while the app was closed show as soon as it opens. (#155)
- During a scan, books show one folder or server at a time instead of all at the end. The spinner
  shows only for scans that read files. (#155)
- A big first scan is about twice as fast: 10,000 books in 1.7 s instead of 3.5 s. Covers from
  the phone’s folder aren’t decoded again on every rescan. (#150)
- More tags are read: more kinds of ID3 tags, UTF-16 chapter titles in m4b files, and genre,
  narrator and ISBN from Ogg Vorbis and Opus files. (#150)
- An episode of a video show that also lists an audio file now plays the audio. Atom feeds with
  formatted descriptions show them. (#148)
- The diagnostics log, when it’s on, records how background podcast refreshes went: counts and
  error codes, never titles or addresses. (#148)
- An add-on whose settings can’t be opened on this device says so on its row. (#155)

### Fixed

- On Android 17, library servers on your home network (WebDAV, SMB, SFTP, S3, Jellyfin,
  Audiobookshelf, Plex, Emby, Subsonic and others) now ask for local network access. Before,
  their scans, streams and downloads failed. Lelap asks when you add or test a server, play from
  it or download from it. A background scan never asks: it skips the server, and Settings shows
  “Needs local network access…” on its row, with Allow. A download without access stops at once
  and says why, instead of retrying. (#154)
- After a rescan regroups the book that’s playing, the Player keeps it at the same place instead
  of showing “Nothing is playing”. (#155)
- In the web app, the first chapter of a Subsonic or Plex book shows its title, not “001 …”. (#151)
- A book’s tags and length are kept when reading its chapters or saving its cover fails. (#150)
- A book with a file that stays missing is rebuilt once, not at every scan. (#150)
- A queued download whose folder is gone says “The download stopped.” after a minute. (#150)
- Stop, then Find chapters, no longer mixes two chapter scans. (#150)
- A failed download move no longer fails the move queued behind it, and leftovers of a move cut
  short are cleared. (#150)
- Hidden books no longer count as on the device for a wanted book’s alert. (#150)
- A book matched by title and author shows the same ✓ or percentage on its page as on its tile.
  (#155)
- Discover keeps its place when the player pane opens or the window changes size. (#155)
- No unexplained errors at start-up, from Rescan or from the folder picker: they show a message
  or go to the diagnostics log. (#155)
- The web app’s media controls show covers kept in the browser. (#155)
- Pressed chips show their colour again, and the diagnostics text wraps at large text sizes.
  (#155)

### Self-hosting and add-on developers

- Sync: no D1 migration, and the sync service hasn’t changed.
- Protocol: when a library file comes without `durationMs`, its `title`, `album`, `artist`,
  `albumArtist` and `ids` now fill in what the file itself lacks, since a browser reads only the
  length. The bundled Subsonic and Plex add-ons send that file’s tags this way. The protocol
  version is unchanged. (#151)
- `@lelap/sdk`: a patch is waiting as a changeset. The work matcher reads a leading “Book 2 -
  Title” or “Vol. 3: Title” as a series number, and a print book’s ASIN, which is its ISBN-10,
  meets the same book’s `isbn:978…`. npm still has 0.4.0 until the SDK is released. (#150)

### Known issues

- Casting to real speakers hasn’t been tried with this beta: the outro, smart rewind, dropped
  speakers and the identity check are tested only in code. (#149)
- The Android 17 local network asks for library servers haven’t been tried on a phone with access
  turned off. (#154)
- The Library’s groups, the cover rules and the app fixes haven’t been tried on a phone yet.
  (#150, #153, #155)
- Covers from real servers in the web app, and the web app with a screen reader, haven’t been
  tried yet. (#151)
- Some new Bahasa Melayu lines haven’t been checked by a native speaker.

## 0.1.0-beta.6 (2026-11-18)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it. The app offers it as usual. At first start it adds a table for hidden items, and on
Android the first scan reads single-file books once more for their tags.

### New

- Hardcover rows on Home and in Discover: the books trending this month and of all time, your own
  lists (private ones too), the lists you follow, Hardcover’s featured lists and any public list
  added by its link. Choose up to 12 on the add-on’s settings page. Everything is read with your
  own token. (#133)
- Hide a book or episode from the Library: swipe its row to the left, or choose Hide in its menu.
  A bar offers Undo, and “Hidden (N)” next to the sort pills shows what you hid, with “Show in
  library” to bring it back. Hidden items stay out of Continue listening, lists, suggestions and
  Android Auto; a book’s page and the player still find them. (#135)
- Files that look like music: a card at the top of the Library says “N items look like music.”
  Review lists them, and “Hide selected” hides the ones you tick. Nothing is hidden on its own.
  (#135)
- Hardcover and gPodder sync are in Settings → Add-ons under Comes with Lelap, with Set up. On
  Android, Open in Lelap on the setup page adds the add-on; in the web app you paste the link.
  (#136)
- The Hardcover setup page walks you through making a token: a button opens Hardcover’s form with
  the right permissions ticked, then numbered steps. (#137, #138)

### Improved

- The source you choose for a book follows you to your other devices. (#139)
- The Play on sheet stops spinning after 12 s with nothing found. It names the usual causes, such
  as another Wi-Fi, a guest network or a VPN, and offers Search again. (#143)
- When the search for speakers can’t start, the sheet says so with an error code. The diagnostics
  log records how the search went, without names or addresses. (#145)
- Settings lists Catalogs right after Servers, so everything about where books come from sits
  together. (#134)
- The Catalog add-on is now called Open Library catalog. Nothing to do: installed apps pick up the
  new name. (#136)
- A later release that changes only the app’s JavaScript arrives over the air, without offering an
  APK of about 40 MB for the same code. (#141)
- lelap.app fits a 320 px screen, the theme switch says its new name, and other open tabs follow a
  theme change. The site no longer offers to install itself as an app; the web app still does.
  (#132, #140)

### Fixed

- Casting found no speakers or TVs on Android 17. Lelap never asked for Android 17’s new local
  network permission, so the search saw nothing. The Play on sheet now asks on every Android 17
  phone, and the search starts once you allow it. (#145)
- Resuming from headphones plays at the speed you last chose, also when you changed it from the
  notification, a watch or the car. Smart rewind counts from when you paused. (#142)
- Removing a download while its book plays switches to the stream at the same place. A finished
  download now reaches a paused book. (#142)
- After switching to a profile with nothing to play, headphones and the car no longer resume the
  last profile’s book. (#142)
- Chapters found from silences reach a book while it plays: the lock screen title and an
  end-of-chapter sleep timer follow them. (#142)
- A place saved inside a show’s intro stays there; only a start from 0 skips the intro. (#142)
- Changing the skip interval reaches watches and Android Auto, not only the button icons. (#142)
- An episode in Up Next no longer starts from deleted files after a download move. (#142)
- Weeks with the app closed no longer grow the listening log to its cap; it keeps one total per
  book and day. (#142)
- A large first sync works: changes go out in messages and pushes the server accepts. One change
  too large for any message is left out instead of stopping sync. (#139)
- A phone that only receives changes keeps its sync group; before, idle expiry counted only
  pushes. (#139)
- A phone whose sync group is gone says “Sync stopped on this device” instead of blaming another
  device. (#139)
- Shows whose intro and outro an older version dropped get their values back. (#139)
- The developer test screen no longer opens in release builds. (#141)

### Self-hosting and add-on developers

- `@lelap/sdk` 0.4.0 is on npm: protocol revisions 4 to 8 and the work matcher
  (`createWorkIndex`, `lookupWork` and the normalising helpers). (#128)
- The Hardcover add-on caches rows for hours per token, keyed on a SHA-256 of it; Docker keeps them
  in memory. Opening an add-on link with `configure` in place of `manifest.json` changes its rows.
  The configure pages end in an Open in Lelap button (`lelap://addon?manifest=…`). (#133, #136)
- The Catalog add-on’s manifest name is now Open Library catalog; its ID `app.lelap.catalog` and
  URL stay. (#136)
- Sync: no D1 migration. Pulls now update `last_push_at` at most once a day, so idle expiry counts
  any sync. Snapshots keep at most 20,000 operations of unknown types. (#139)
- Releases: `beta.json` and `latest.json` gain `runtime`. When it is unchanged and the
  over-the-air bundle went out, the release leaves the file alone. Signing pins build-tools 37.0.0
  and checks the certificate against `AllowedAPKSigningKeys`. The F-Droid recipe reads the version
  from `apps/app/app.json` at the tag, which the release pull request now stamps. (#141)

### Known issues

- On Android 17, library servers at a local network address (SMB, SFTP, WebDAV, Audiobookshelf,
  Jellyfin and others) don’t ask for the local network permission yet, so scanning or playing from
  them may fail. Casting asks already.
- The Android 17 casting fix follows what we found on a phone over adb, but this build hasn’t been
  tried on one yet. (#145)
- Hardcover rows haven’t been tried with a real token. (#133)
- Hiding, the music card and the playback fixes haven’t been tried on a phone yet. (#135, #142)

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
