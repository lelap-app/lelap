# Roadmap

Milestones in the order we plan them. Each has its own file in [`milestones/`](milestones/): its
title, status, summary and pull requests in front matter, what shipped or what is planned, and its
open checks at the end. The table below is generated from those files: change a milestone's file
and run `pnpm roadmap`; never edit the table by hand. `pnpm checks` lists every open check.
Decisions and architecture live in [`brief.md`](brief.md).

<!-- milestones:start -->

| Milestone                                            | Status      | Open checks | In short                                                                                                                                                      |
| ---------------------------------------------------- | ----------- | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [M0 Claim the name](milestones/m0.md)                | Done        |             | Domain, email, GitHub organisation and Cloudflare account                                                                                                     |
| [M1 Audio spike](milestones/m1.md)                   | Done        |           6 | Media3 playback on a real phone: gapless parts, speed, calls, sleep fade                                                                                      |
| [M2 Local library](milestones/m2.md)                 | Done        |          13 | Local files and folders, chapters from tags, progress, bookmarks                                                                                              |
| [M3 Add-on protocol and SDK](milestones/m3.md)       | Done        |           4 | Add-on protocol, SDK, Workers template, Catalog and LibriVox add-ons                                                                                          |
| [M4 Downloads](milestones/m4.md)                     | Done        |           8 | Background downloads with Wi-Fi and charging rules, storage overview                                                                                          |
| [M5 Podcasts](milestones/m5.md)                      | Done        |           6 | RSS, OPML in and out, auto-download, Up Next                                                                                                                  |
| [M6 Web build](milestones/m6.md)                     | Done        |           3 | The same app on the web: OPFS storage, web audio, feed and cover proxy                                                                                        |
| [M7 Sync](milestones/m7.md)                          | Done        |           5 | Pairing code and end-to-end encrypted sync of places and lists                                                                                                |
| [M8 Release pipeline](milestones/m8.md)              | Done        |           2 | Signed APK in CI, in-app updater, Docker images, landing page live                                                                                            |
| [M9 Profiles](milestones/m9.md)                      | Done        |           5 | Profiles with avatars, PINs and kids limits                                                                                                                   |
| [M10 Your own storage](milestones/m10.md)            | Done        |           7 | WebDAV (Nextcloud, ownCloud, any server) and S3-compatible buckets                                                                                            |
| [M11 Background engine](milestones/m11.md)           | Done        |           2 | Up Next with the app closed, feed refresh and auto-download in the background, background sync                                                                |
| [M12 Look and feel](milestones/m12.md)               | Done        |           4 | UI pass against the design sketch, one icon set, player polish, simple motion                                                                                 |
| [M13 Landing page 2](milestones/m13.md)              | Done        |           2 | Download options (APK, GitHub Releases, Obtainium, F-Droid later), light motion, drop the badge                                                               |
| [M14 Developer platform](milestones/m14.md)          | Done        |           2 | Developer docs on the site, manifest builder, samples (Hono, Node, Python), hosting guide                                                                     |
| [M15 Find any book](milestones/m15.md)               | Done        |           4 | Search every book (Open Library), item pages without a source, choose between editions and sources                                                            |
| [M16 Organise](milestones/m16.md)                    | Done        |           6 | Tags, playlists, smart lists, full export and import                                                                                                          |
| [M17 Car and offline web](milestones/m17.md)         | Done        |          13 | Android Auto browsing, service worker for the web app                                                                                                         |
| [M18 Updates over the air](milestones/m18.md)        | Done        |           7 | OTA bundles with code signing, beta channel for OTA                                                                                                           |
| [M19 Security and hardening](milestones/m19.md)      | Done        |           9 | Audit of the services and app, key storage in the Android Keystore, CSP for the web app                                                                       |
| [M20 SDK on npm](milestones/m20.md)                  | Done        |           1 | Build step for `@lelap/sdk`, Changesets, publishing with provenance from CI                                                                                   |
| [M21 Translations](milestones/m21.md)                | Done        |           3 | UI text in translation files, a few first languages, a way for others to contribute                                                                           |
| [M22 Smarter audio](milestones/m22.md)               | Done        |          11 | Volume boost, voice EQ and mono through Media3's audio processors                                                                                             |
| [M23 Podcasting 2.0](milestones/m23.md)              | Done        |           6 | Transcripts, chapter files, person and season tags, funding links from feeds                                                                                  |
| [M24 Stats and goals](milestones/m24.md)             | Done        |           4 | Listening time, streaks, finished books, an optional yearly goal; computed and kept on device                                                                 |
| [M25 Home screen and tiles](milestones/m25.md)       | Done        |           9 | Android widget, Quick Settings tile, sleep timer from the lock screen                                                                                         |
| [M26 Casting](milestones/m26.md)                     | Done        |          12 | Sonos and DLNA over UPnP, Google Cast speakers (Nest) through an open Cast client, FCast; no Google SDK                                                       |
| [M27 Add-on protocol v2](milestones/m27.md)          | Done        |           6 | Settings pages for add-ons, add-on sign-in, health checks, protocol versioning                                                                                |
| [M28 F-Droid](milestones/m28.md)                     | In progress |           2 | Reproducible APKs, an F-Droid listing, signed checksums on the site                                                                                           |
| [M29 Sleep and links](milestones/m29.md)             | Done        |          10 | Sleep timer until end of chapter or episode, shake to extend, retry `/resolve` on 403 and 410                                                                 |
| [M30 Scrobbling](milestones/m30.md)                  | Done        |           5 | `POST /scrobble` in the app, Hardcover and gPodder add-ons, a “Want to read” row on Home                                                                      |
| [M31 Discover 2](milestones/m31.md)                  | Done        |           7 | “Playable only” filter, source badges on covers, alerts when a wanted book gets a source                                                                      |
| [M32 Audnexus](milestones/m32.md)                    | Done        |           4 | Narrators, series and chapters from Audnexus in the Catalog add-on                                                                                            |
| [M33 Everyday Android](milestones/m33.md)            | Done        |          14 | Wear OS controls, car mode, bedtime sleep timer; nothing that needs Google Play services                                                                      |
| [M34 Importers](milestones/m34.md)                   | Done        |           7 | Goodreads CSV, AntennaPod and Smart AudioBook Player backups                                                                                                  |
| [M35 Add-on trust and art](milestones/m35.md)        | Done        |           3 | Permission view before install, an artwork resource for covers                                                                                                |
| [M36 Jellyfin](milestones/m36.md)                    | Done        |           5 | Jellyfin as a source, next to Audiobookshelf                                                                                                                  |
| [M37 Kids profile](milestones/m37.md)                | Done        |           4 | A profile with its own library and no add-on installation                                                                                                     |
| [M38 Add-ons in the app](milestones/m38.md)          | Done        |           5 | Sandboxed JavaScript add-ons with network only to declared hosts, for LAN sources                                                                             |
| [M39 Precise seeking](milestones/m39.md)             | Done        |           4 | Bookmarks on the progress bar with snapping, fine scrubbing and jump-to-time for long books                                                                   |
| [M40 First release](milestones/m40.md)               | In progress |             | Beta with everything, test round 2 on the phone, fixes, a stable `v0.1.0`                                                                                     |
| [M41 Audiobookshelf](milestones/m41.md)              | Done        |           7 | Audiobookshelf libraries as a source, with progress synced both ways                                                                                          |
| [M42 Accessibility](milestones/m42.md)               | Done        |          23 | TalkBack, large text, contrast, focus order, right-to-left layouts                                                                                            |
| [M43 Big libraries](milestones/m43.md)               | Done        |           5 | 10,000 books: start-up, lists, indexes, scan speed, bundle size                                                                                               |
| [M44 Tablet and desktop](milestones/m44.md)          | Done        |           8 | Two panes on wide screens, landscape player, keyboard shortcuts on the web                                                                                    |
| [M45 Trim silence](milestones/m45.md)                | Done        |          12 | Chapters from silences for books without them, intro and outro skipping per podcast                                                                           |
| [M46 Recommendations](milestones/m46.md)             | Done        |           4 | “Because you finished …” rows worked out on the device                                                                                                        |
| [M47 Diagnostics](milestones/m47.md)                 | Done        |           3 | Opt-in local log and health, exported for bug reports; nothing collected                                                                                      |
| [M48 More languages](milestones/m48.md)              | Done        |           6 | Contribution flow for translators, native Android text, landing page in Malay                                                                                 |
| [M49 Artwork badges](milestones/m49.md)              | Done        |           5 | Rating and progress badges drawn by the app on add-on artwork                                                                                                 |
| [M50 Casting 2](milestones/m50.md)                   | Done        |          10 | Casting that survives a locked phone: foreground service, sleep timer, finish and Up Next on receivers                                                        |
| [M51 Background accounting](milestones/m51.md)       | Done        |           7 | Stats and scrobbles from the playback service when the app is swiped away                                                                                     |
| [M52 Sync upkeep](milestones/m52.md)                 | Done        |           4 | Snapshots that compact the sync log, expiry of idle groups                                                                                                    |
| [M53 Storage choices](milestones/m53.md)             | Done        |          11 | Download location, covers from server folders, Atom feeds, export to a file                                                                                   |
| [M54 Faster builds, smaller APKs](milestones/m54.md) | Done        |           9 | Build unsigned with caches and sign separately; one APK per CPU type                                                                                          |
| [M55 Light landing page](milestones/m55.md)          | Done        |           4 | The site and docs in a light theme too, following the system, with a switch                                                                                   |
| [M56 Your copy, linked](milestones/m56.md)           | Done        |           7 | Books found in Discover linked to your own copy on a folder, WebDAV, S3 or a media server                                                                     |
| [M57 Add-ons as library sources](milestones/m57.md)  | Done        |           9 | In-app add-ons with sealed logins, stream headers and library scans; bundled ones in “Add a server”                                                           |
| [M58 Navidrome and Subsonic](milestones/m58.md)      | Done        |           8 | A bundled add-on for Subsonic-API servers: library, streams, bookmarks                                                                                        |
| [M59 Plex and Emby](milestones/m59.md)               | Done        |          11 | Bundled add-ons for two more media servers, places both ways                                                                                                  |
| [M60 Internet Archive](milestones/m60.md)            | Done        |           5 | A hosted add-on for public-domain audio on archive.org beyond LibriVox                                                                                        |
| [M61 Open Library reading log](milestones/m61.md)    | Done        |           8 | A scrobble add-on marking books read or reading on Open Library                                                                                               |
| [M62 SMB and SFTP](milestones/m62.md)                | Done        |          11 | Built-in sources for NAS shares and plain servers, on Android                                                                                                 |
| [M63 Playback fixes](milestones/m63.md)              | Done        |          10 | Small fixes in the playback service and the player, left from earlier reviews                                                                                 |
| [M64 Library fixes](milestones/m64.md)               | Done        |          16 | Covers from image files, and folder scans, tags, downloads and matching: fixes left from earlier reviews                                                      |
| [M65 Server sources 2](milestones/m65.md)            | Done        |          15 | Outboxes, narrators and series, and steadier places for the media servers                                                                                     |
| [M66 Add-on protocol 3](milestones/m66.md)           | Done        |          12 | Editions, settings for every route, paging, more scrobble events and upkeep of first-party add-ons                                                            |
| [M67 Web app 2](milestones/m67.md)                   | Done        |           9 | Faster saves, covers from servers and steadier media keys in the web app                                                                                      |
| [M68 Sync fixes](milestones/m68.md)                  | Done        |           5 | Quieter scans, the source choice synced, and sturdier snapshots and expiry                                                                                    |
| [M69 Casting 3](milestones/m69.md)                   | Done        |           9 | Outro skipping, smart rewind and measured timings on receivers, Cast device authentication                                                                    |
| [M70 Release upkeep](milestones/m70.md)              | Done        |           5 | Smaller OTA updates, a pinned signing toolchain, F-Droid update checks and other pipeline fixes                                                               |
| [M71 App polish](milestones/m71.md)                  | Done        |          13 | Small fixes on Home, the Library, the Player and Settings, left from earlier reviews                                                                          |
| [M72 Languages 2](milestones/m72.md)                 | Done        |           7 | Native errors, made-up chapter titles, dates and numbers in the profile’s language                                                                            |
| [M73 Landing page polish](milestones/m73.md)         | Done        |           2 | Theme switch announcements, one shared hidden class, narrow screens and escaped holes                                                                         |
| [M74 Car and widget 2](milestones/m74.md)            | Done        |          11 | Car mode with the player's look, phone covers in Android Auto, your cars, a learned battery estimate                                                          |
| [M75 Podcasts 3](milestones/m75.md)                  | Done        |           4 | More Podcasting 2.0 tags, Atom content and logging from the background refresh                                                                                |
| [M76 Hardcover catalogs](milestones/m76.md)          | Done        |           8 | Trending books, featured lists and your own Hardcover lists as catalogs, on your own token                                                                    |
| [M77 Hide from library](milestones/m77.md)           | Done        |          15 | Hide items from the library and bring them back; suggestions to hide what looks like music                                                                    |
| [M78 Casting 4](milestones/m78.md)                   | Done        |          11 | Speaker groups across protocols, and Cast device authentication enforced                                                                                      |
| [M79 Library by progress](milestones/m79.md)         | Done        |           4 | The Library in three groups, In progress, Not started and Finished, each in its own order                                                                     |
| [M80 App polish 2](milestones/m80.md)                | In progress |           7 | A zoomed scrubber, matched covers kept offline, faster web saves, player tools at 320 dp                                                                      |
| [M81 Test round 2](milestones/m81.md)                | Planned     |             | A full phone round over adb and the fixes it finds, the gate for v0.1.0                                                                                       |
| [M82 First start](milestones/m82.md)                 | Done        |          10 | A first start that helps: choose a folder or a server, suggested add-ons, helpful empty states                                                                |
| [M83 Accessibility 2](milestones/m83.md)             | Done        |          10 | One pass over every screen with TalkBack, large text and contrast                                                                                             |
| [M84 Better sound](milestones/m84.md)                | Done        |          12 | Voice boost, skip silence and even loudness between books                                                                                                     |
| [M85 Chapters and bookmarks 2](milestones/m85.md)    | Done        |          10 | Edit chapter names and times, notes on bookmarks, share a short clip                                                                                          |
| [M86 Sleep 2](milestones/m86.md)                     | Done        |          14 | Shake for more time as a setting, a bedtime routine with its volume, back to when you last used it                                                            |
| [M87 Stats and year in sound](milestones/m87.md)     | Done        |           7 | Listening time, finished books and a year overview, worked out on the phone                                                                                   |
| [M88 Podcasts 4](milestones/m88.md)                  | Done        |           8 | Chapter images, soundbites in the player, clips that stop at their end, shared places in episodes                                                             |
| [M90 Web app 3](milestones/m90.md)                   | Done        |           9 | Offline downloads in the browser, a better installed app, desktop keys                                                                                        |
| [M91 iOS decision](milestones/m91.md)                | Done        |             | A decision on iOS: what an App Store app would mean for Lelap                                                                                                 |
| [M92 Hardcover sign-in](milestones/m92.md)           | Done        |           7 | Sign in to Hardcover instead of pasting a token                                                                                                               |
| [M93 Developer docs 2](milestones/m93.md)            | Done        |           3 | A real guide to building an add-on, sample source files and shared page styling                                                                               |
| [M94 Tests against real servers](milestones/m94.md)  | Done        |           1 | WebDAV and S3 servers in CI, and an emulator smoke test of the app                                                                                            |
| [M95 Self-hosting 2](milestones/m95.md)              | Done        |           3 | One-command setup, a small admin page and backup guides                                                                                                       |
| [M96 Security review 2](milestones/m96.md)           | Done        |           7 | A second audit of what landed since M19, its fixes, and an SBOM with each release                                                                             |
| [M97 Landing page 3](milestones/m97.md)              | Done        |           4 | Drawn phone screens checked against reference shots of the app, a changelog page and help                                                                     |
| [M98 Developer verification](milestones/m98.md)      | Planned     |             | Google's developer verification for sideloaded apps                                                                                                           |
| [M99 Languages 3](milestones/m99.md)                 | Done        |          13 | Media3's own notification texts, saved English chapter names, raw native error details                                                                        |
| [M100 Server sources 3](milestones/m100.md)          | Done        |           9 | Places sent while the app is closed, Plex addresses that follow the server, a login that never follows a redirect off it                                      |
| [M101 Better sound 2](milestones/m101.md)            | Done        |           9 | Skip silence and even loudness on the web, and steadier skip silence accounting                                                                               |
| [M102 Add-on protocol 4](milestones/m102.md)         | In progress |          12 | Ratings, Android finish sessions, scrobblers on the SDK's configure and catalog upkeep                                                                        |
| [M103 Podcasts 5](milestones/m103.md)                | Done        |           7 | Alternate enclosures, podcast:integrity checks, chapter images on the lock screen                                                                             |
| [M104 Security hardening 3](milestones/m104.md)      | Done        |          10 | What M96's audit left: LAN addresses for add-ons, discovery, SMB signing, SDK sealing                                                                         |
| [M105 App polish 3](milestones/m105.md)              | In progress |           9 | What M80 left: podcast “new” badges, covers by their first bytes, a zoom key, chapter titles read again                                                       |
| [M106 Speed and battery](milestones/m106.md)         | Done        |          12 | The web app shows 10,000 books in 0.34 s instead of 0.85 s with 47 MB less, fewer wakeups while playing, budgets in the bench                                 |
| [M107 Car and Bluetooth 3](milestones/m107.md)       | Done        |           9 | Car mode sideways on phones, covers granted per car app, headphone drain counted once                                                                         |
| [M108 Themes](milestones/m108.md)                    | Done        |          11 | Themes beyond the night theme, an accent colour, high contrast, and themes shared as a file                                                                   |
| [M109 Series and reading order](milestones/m109.md)  | Done        |           7 | Reading order within a series, "Next in the series" when a book ends, missing volumes shown                                                                   |
| [M110 Upkeep](milestones/m110.md)                    | Done        |           2 | First start leftovers, scan and play in the emulator test, developer setup fixes                                                                              |
| [M111 Podcasts 6](milestones/m111.md)                | Done        |           4 | A show's place on a map and podcast:value shown as information                                                                                                |
| [M112 Lists 2](milestones/m112.md)                   | Done        |          10 | Play a list from start to end, books and episodes mixed, building on M16's lists                                                                              |
| [M113 Big screens 2](milestones/m113.md)             | Done        |          10 | What M44 left: foldables, a third column, resizable panes, drag to lists, no stretched screens                                                                |
| [M114 Add-on test kit](milestones/m114.md)           | Done        |           2 | A command in the SDK that checks an add-on against protocol v1 and says what's wrong                                                                          |
| [M115 Series 2](milestones/m115.md)                  | In progress |           6 | Series leftovers from M109; hidden volumes, streamed books on other devices, faster lists                                                                     |
| [M117 Themes 2](milestones/m117.md)                  | Done        |           5 | High contrast in theme files, a file theme's own accent in car mode, and a live theme switch                                                                  |
| [M118 App polish 4](milestones/m118.md)              | In progress |           4 | What M105 left for a decision or a sample: suggestion covers, Plex library list, Library reads                                                                |
| [M119 Lists 3](milestones/m119.md)                   | Done        |          11 | Lists in Android Auto, Previous in list off the phone, the list on the widget, lighter reads                                                                  |
| [M120 Big screens 3](milestones/m120.md)             | Done        |          11 | What M113 left: drag to a list on Android and from catalog tiles, drop on the Library's list cards                                                            |
| [M121 Podcasts 7](milestones/m121.md)                | Done        |           7 | Integrity checks for web downloads, the smaller file with the app closed, chapter images on the web                                                           |
| [M122 Better sound 3](milestones/m122.md)            | Done        |           7 | Skip silence on the web for M4B, Opus, Vorbis and FLAC, from the stream the element already reads                                                             |
| [M123 Server sources 4](milestones/m123.md)          | Done        |          11 | Add-on servers' places with the app closed, sent after each pause; located addresses for books started without the app                                        |
| [M124 Languages 4](milestones/m124.md)               | Done        |           7 | Chapter names that follow a language switch at once, typed chapter names kept, the last English failure texts                                                 |
| [M125 Casting 5](milestones/m125.md)                 | In progress |          15 | An FCast receiver that goes silent, Cast on the web, bedtime volume while casting, remembered speaker groups, “Connect anyway” pinned by certificate          |
| [M126 Speed and battery 2](milestones/m126.md)       | Planned     |             | What M106 left: Android's start, a Library that rereads only what changed, a smaller start bundle                                                             |
| [M127 Series 3](milestones/m127.md)                  | Done        |           6 | Whole series from Wikidata, in release order, with the books the library lacks by title                                                                       |
| [M128 OPDS](milestones/m128.md)                      | Done        |           8 | Any OPDS catalog as a source, such as a Calibre content server at home or a library's open catalog                                                            |
| [M130 BookWyrm](milestones/m130.md)                  | Planned     |             | The listener's public BookWyrm shelves as catalog rows, from their own instance                                                                               |
| [M131 Lepak](milestones/m131.md)                     | Done        |           7 | Free Malay, Indonesian and Singaporean podcasts from Podcast Index by language, in rows Cerita, Sembang, Sejarah and Singapura                                |
| [M132 Open lectures](milestones/m132.md)             | Done        |           6 | 37 complete Open Yale Courses as books, one lecture per part, with Yale's credit and licence on every course                                                  |
| [M133 Settings 2](milestones/m133.md)                | Done        |           8 | Settings as eight groups, each line saying what is set now and opening its own page                                                                           |
| [M134 Better sound 4](milestones/m134.md)            | Planned     |             | The sound effects on cast receivers through a stream the phone renders; skip silence on the web for variable-bitrate MP3, and MP3's encoder delay per browser |
| [M135 OPDS 2](milestones/m135.md)                    | Planned     |             | What M128 left: Digest logins for audio, OPDS Progression places, a feed's summary, language and series                                                       |
| [M136 Lecture transcripts](milestones/m136.md)       | Planned     |             | Yale's transcripts for Open lectures on the transcript screen, through a stream part's transcripts                                                            |
| [M138 Playback history](milestones/m138.md)          | Done        |          13 | A short log per book of plays, pauses, skips, seeks, chapter jumps and sleep timer stops, so one tap undoes an accidental jump                                |
| [M139 Casting 6](milestones/m139.md)                 | Planned     |             | Receiver waits tuned from measured timings, and the leading speaker leaving a group                                                                           |

<!-- milestones:end -->

The first stable release is `v0.1.0`, shipped by [M40](milestones/m40.md) with everything built so
far.

## Future goals

Ideas without a number or a place in the order yet. One becomes a milestone, with its own file,
when it is planned.

- **Metadata from Google Books:** fill missing descriptions, covers, genres and years from the Google
  Books API in the Catalog add-on, as the metadata rule in the brief allows. Planned as M137 on
  2026-11-19, then set aside the same day: Google's terms require its mark and a link beside every
  field and forbid lasting copies (so no Google fields in downloads or sync), it has no narrators or
  lengths, and its coverage of Danish editions is unknown until a key exists. Apple's iTunes Search
  API is out unless a store link is shown beside its data. M137 is left unused.
- **Playback history, finer points (after M138):** while casting, log a seek's target rather than
  the receiver's position, which may lag; log the app's skips at the place the service lands on
  across file ends rather than the place plus the interval; log taps for the profile the player
  plays for when it differs from the one on screen; don't offer “Go back” in the app after the
  notification's own Back.
- **Wear OS:** control playback from the watch (tile and app: play, pause, skip, the sleep timer),
  and maybe play downloads on it. Was M89; set aside on 2026-11-18 until there is a watch to test
  on.
- **Smart AudioBook Player bookmarks (left from M34, then M118):** bookmarks are a paid feature in
  that app, so no sample with known places has turned up. The one public sample is a `<root>` of
  `<bookmark>` elements, each with `<title/>`, `<description/>`, `<fileName>` and
  `<filePosition>` (141 for a preface), and whether `filePosition` is seconds or milliseconds is
  unknown. The import waits for someone to send a real `bookmarks.sabp.xml` with places they
  know.

- **Rules of hooks in lint (left from M117):** colours outside a class come from `useColors()`
  since M117, and nothing checks where a hook is called. `eslint-plugin-react-hooks` would catch
  one in a callback, a condition or a render helper.

- **Scrobble bookkeeping (left from M102):** mark a book as heard by an add-on when its event is
  delivered rather than queued, and log a session's start with the Android `finish` itself, so a
  session too short for the tally to see never borrows an earlier one's start.

- **More from Podcasting 2.0 tags (left from M75):** play a soundbite as a clip that stops at its
  end, and list soundbites in the player; let the listener pick among alternate enclosures (a
  smaller file on mobile data) and check `podcast:integrity`. Sending value-for-value payments
  would move money and needs a decision first.
- **Accessibility leftovers (from M83):** the web app ignores the browser's default text size, since
  react-native-web sets sizes in pixels; zooming works. Following it would mean reading the root
  font size and scaling text the way Android's font scale does. The accessibility check has gaps
  that pass today's code but could hide a later problem: an error inside a `View` or returned
  early isn't seen, colours in short hex or `rgba()` aren't checked, and a spinner is only found
  in `cond ? <ActivityIndicator /> : …`.
- **Themes and community looks:** community skins and community players. M108 brought built-in
  themes, accents and theme files of colours only.
- **Episode file leftovers (from M121):** the Android service compares the addresses the app sent,
  not the file it picked: when the app re-picks a loaded episode's automatic file, the service may
  prepare the same file again, a short rebuffer. Comparing what `EpisodeFiles` would pick avoids it.
- **Series leftovers (from M127):** Hardcover's series for listeners who connected Hardcover with
  their own token, to fill what Wikidata lacks (Department Q's book 10, years it doesn't have).
  A hidden book matched only by its title still shows as a book the listener lacks. And an app
  that drops resources it doesn't know, instead of refusing the manifest, would let later
  resources join existing add-ons.
- **BookBrainz (skipped, M129 left unused):** BookBrainz's API gives a series' books without their
  positions, and the app takes meta from the first add-on that answers, so a second metadata source
  for Open Library works would never be used. Worth another look if both change.
- **BookWyrm reading status (from M130):** start, finish and stopped reading as the listener plays,
  once BookWyrm ships a client API with its own sign-in
  ([issue #785](https://github.com/bookwyrm-social/bookwyrm/issues/785)). Until then the add-on
  only shows shelves: no password, no posting of the site's forms.
- **A second server address:** Audiobookshelf, Jellyfin and WebDAV with a home and an outside
  address, switching by itself to the one that answers.
- **“Play X” by voice:** voice search through the Assistant and Android Auto.
- **Following authors and narrators:** follow a person and get a Home row of their new books.
- **Taste 2:** separate ratings for story and narration, “why this pick”, “More like this” and an
  “I have N hours” filter.

## Environments

| Environment | When     | What                                                                                                                                                                      |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev   | Now      | `pnpm dev:site`; `wrangler dev` simulates D1, R2 and KV offline.                                                                                                          |
| Production  | Now      | Merges to `main` deploy the site (and later the PWA).                                                                                                                     |
| PR previews | Optional | Pages branch deploys at `<branch>.lelap-site.pages.dev`; only for branches in this repository, since forks get no secrets.                                                |
| Staging     | From M7  | A `staging` environment in each service's `wrangler.toml` with its own D1 and R2. Merges to `main` deploy services to staging, `v*` tags (beta and stable) to production. |
| Beta        | From M8  | expo-updates `beta` channel and pre-release tags (`v1.2.0-beta.1`) publishing `beta.json`; testers opt in from the app's settings.                                        |

## Before the first public release

- Check Google's developer verification requirements for sideloaded apps.
- Decide on F-Droid: reproducible builds or F-Droid's own signing key. No separate flavor is
  needed: casting ([M26](milestones/m26.md)) uses open protocols, not the Google Cast SDK.
- Review the terms and privacy pages.
- Publish the add-on SDK under MIT.
