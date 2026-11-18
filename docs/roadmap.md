# Roadmap

Milestones in the order we plan them. Each has its own file in [`milestones/`](milestones/): its
title, status, summary and pull requests in front matter, what shipped or what is planned, and its
open checks at the end. The table below is generated from those files: change a milestone's file
and run `pnpm roadmap`; never edit the table by hand. `pnpm checks` lists every open check.
Decisions and architecture live in [`brief.md`](brief.md).

<!-- milestones:start -->

| Milestone                                            | Status      | Open checks | In short                                                                                                 |
| ---------------------------------------------------- | ----------- | ----------: | -------------------------------------------------------------------------------------------------------- |
| [M0 Claim the name](milestones/m0.md)                | Done        |             | Domain, email, GitHub organisation and Cloudflare account                                                |
| [M1 Audio spike](milestones/m1.md)                   | Done        |           6 | Media3 playback on a real phone: gapless parts, speed, calls, sleep fade                                 |
| [M2 Local library](milestones/m2.md)                 | Done        |          13 | Local files and folders, chapters from tags, progress, bookmarks                                         |
| [M3 Add-on protocol and SDK](milestones/m3.md)       | Done        |           4 | Add-on protocol, SDK, Workers template, Catalog and LibriVox add-ons                                     |
| [M4 Downloads](milestones/m4.md)                     | Done        |           8 | Background downloads with Wi-Fi and charging rules, storage overview                                     |
| [M5 Podcasts](milestones/m5.md)                      | Done        |           6 | RSS, OPML in and out, auto-download, Up Next                                                             |
| [M6 Web build](milestones/m6.md)                     | Done        |           3 | The same app on the web: OPFS storage, web audio, feed and cover proxy                                   |
| [M7 Sync](milestones/m7.md)                          | Done        |           5 | Pairing code and end-to-end encrypted sync of places and lists                                           |
| [M8 Release pipeline](milestones/m8.md)              | Done        |           2 | Signed APK in CI, in-app updater, Docker images, landing page live                                       |
| [M9 Profiles](milestones/m9.md)                      | Done        |           5 | Profiles with avatars, PINs and kids limits                                                              |
| [M10 Your own storage](milestones/m10.md)            | Done        |           7 | WebDAV (Nextcloud, ownCloud, any server) and S3-compatible buckets                                       |
| [M11 Background engine](milestones/m11.md)           | Done        |           2 | Up Next with the app closed, feed refresh and auto-download in the background, background sync           |
| [M12 Look and feel](milestones/m12.md)               | Done        |           4 | UI pass against the design sketch, one icon set, player polish, simple motion                            |
| [M13 Landing page 2](milestones/m13.md)              | Done        |           2 | Download options (APK, GitHub Releases, Obtainium, F-Droid later), light motion, drop the badge          |
| [M14 Developer platform](milestones/m14.md)          | Done        |           2 | Developer docs on the site, manifest builder, samples (Hono, Node, Python), hosting guide                |
| [M15 Find any book](milestones/m15.md)               | Done        |           4 | Search every book (Open Library), item pages without a source, choose between editions and sources       |
| [M16 Organise](milestones/m16.md)                    | Done        |           6 | Tags, playlists, smart lists, full export and import                                                     |
| [M17 Car and offline web](milestones/m17.md)         | Done        |          13 | Android Auto browsing, service worker for the web app                                                    |
| [M18 Updates over the air](milestones/m18.md)        | Done        |           7 | OTA bundles with code signing, beta channel for OTA                                                      |
| [M19 Security and hardening](milestones/m19.md)      | Done        |           9 | Audit of the services and app, key storage in the Android Keystore, CSP for the web app                  |
| [M20 SDK on npm](milestones/m20.md)                  | Done        |           1 | Build step for `@lelap/sdk`, Changesets, publishing with provenance from CI                              |
| [M21 Translations](milestones/m21.md)                | Done        |           3 | UI text in translation files, a few first languages, a way for others to contribute                      |
| [M22 Smarter audio](milestones/m22.md)               | Done        |          11 | Volume boost, voice EQ and mono through Media3's audio processors                                        |
| [M23 Podcasting 2.0](milestones/m23.md)              | Done        |           6 | Transcripts, chapter files, person and season tags, funding links from feeds                             |
| [M24 Stats and goals](milestones/m24.md)             | Done        |           4 | Listening time, streaks, finished books, an optional yearly goal; computed and kept on device            |
| [M25 Home screen and tiles](milestones/m25.md)       | Done        |           9 | Android widget, Quick Settings tile, sleep timer from the lock screen                                    |
| [M26 Casting](milestones/m26.md)                     | Done        |          12 | Sonos and DLNA over UPnP, Google Cast speakers (Nest) through an open Cast client, FCast; no Google SDK  |
| [M27 Add-on protocol v2](milestones/m27.md)          | Done        |           6 | Settings pages for add-ons, add-on sign-in, health checks, protocol versioning                           |
| [M28 F-Droid](milestones/m28.md)                     | In progress |           2 | Reproducible APKs, an F-Droid listing, signed checksums on the site                                      |
| [M29 Sleep and links](milestones/m29.md)             | Done        |          10 | Sleep timer until end of chapter or episode, shake to extend, retry `/resolve` on 403 and 410            |
| [M30 Scrobbling](milestones/m30.md)                  | Done        |           5 | `POST /scrobble` in the app, Hardcover and gPodder add-ons, a “Want to read” row on Home                 |
| [M31 Discover 2](milestones/m31.md)                  | Done        |           7 | “Playable only” filter, source badges on covers, alerts when a wanted book gets a source                 |
| [M32 Audnexus](milestones/m32.md)                    | Done        |           4 | Narrators, series and chapters from Audnexus in the Catalog add-on                                       |
| [M33 Everyday Android](milestones/m33.md)            | Done        |          14 | Wear OS controls, car mode, bedtime sleep timer; nothing that needs Google Play services                 |
| [M34 Importers](milestones/m34.md)                   | Done        |           7 | Goodreads CSV, AntennaPod and Smart AudioBook Player backups                                             |
| [M35 Add-on trust and art](milestones/m35.md)        | Done        |           3 | Permission view before install, an artwork resource for covers                                           |
| [M36 Jellyfin](milestones/m36.md)                    | Done        |           5 | Jellyfin as a source, next to Audiobookshelf                                                             |
| [M37 Kids profile](milestones/m37.md)                | Done        |           4 | A profile with its own library and no add-on installation                                                |
| [M38 Add-ons in the app](milestones/m38.md)          | Done        |           5 | Sandboxed JavaScript add-ons with network only to declared hosts, for LAN sources                        |
| [M39 Precise seeking](milestones/m39.md)             | Done        |           4 | Bookmarks on the progress bar with snapping, fine scrubbing and jump-to-time for long books              |
| [M40 First release](milestones/m40.md)               | In progress |             | Beta with everything, test round 2 on the phone, fixes, a stable `v0.1.0`                                |
| [M41 Audiobookshelf](milestones/m41.md)              | Done        |           7 | Audiobookshelf libraries as a source, with progress synced both ways                                     |
| [M42 Accessibility](milestones/m42.md)               | Done        |          23 | TalkBack, large text, contrast, focus order, right-to-left layouts                                       |
| [M43 Big libraries](milestones/m43.md)               | Done        |           5 | 10,000 books: start-up, lists, indexes, scan speed, bundle size                                          |
| [M44 Tablet and desktop](milestones/m44.md)          | Done        |           8 | Two panes on wide screens, landscape player, keyboard shortcuts on the web                               |
| [M45 Trim silence](milestones/m45.md)                | Done        |          12 | Chapters from silences for books without them, intro and outro skipping per podcast                      |
| [M46 Recommendations](milestones/m46.md)             | Done        |           4 | “Because you finished …” rows worked out on the device                                                   |
| [M47 Diagnostics](milestones/m47.md)                 | Done        |           3 | Opt-in local log and health, exported for bug reports; nothing collected                                 |
| [M48 More languages](milestones/m48.md)              | Done        |           6 | Contribution flow for translators, native Android text, landing page in Malay                            |
| [M49 Artwork badges](milestones/m49.md)              | Done        |           5 | Rating and progress badges drawn by the app on add-on artwork                                            |
| [M50 Casting 2](milestones/m50.md)                   | Done        |          10 | Casting that survives a locked phone: foreground service, sleep timer, finish and Up Next on receivers   |
| [M51 Background accounting](milestones/m51.md)       | Done        |           7 | Stats and scrobbles from the playback service when the app is swiped away                                |
| [M52 Sync upkeep](milestones/m52.md)                 | Done        |           4 | Snapshots that compact the sync log, expiry of idle groups                                               |
| [M53 Storage choices](milestones/m53.md)             | Done        |          11 | Download location, covers from server folders, Atom feeds, export to a file                              |
| [M54 Faster builds, smaller APKs](milestones/m54.md) | Done        |           9 | Build unsigned with caches and sign separately; one APK per CPU type                                     |
| [M55 Light landing page](milestones/m55.md)          | Done        |           4 | The site and docs in a light theme too, following the system, with a switch                              |
| [M56 Your copy, linked](milestones/m56.md)           | Done        |           7 | Books found in Discover linked to your own copy on a folder, WebDAV, S3 or a media server                |
| [M57 Add-ons as library sources](milestones/m57.md)  | Done        |           9 | In-app add-ons with sealed logins, stream headers and library scans; bundled ones in “Add a server”      |
| [M58 Navidrome and Subsonic](milestones/m58.md)      | Done        |           8 | A bundled add-on for Subsonic-API servers: library, streams, bookmarks                                   |
| [M59 Plex and Emby](milestones/m59.md)               | Done        |          11 | Bundled add-ons for two more media servers, places both ways                                             |
| [M60 Internet Archive](milestones/m60.md)            | Done        |           5 | A hosted add-on for public-domain audio on archive.org beyond LibriVox                                   |
| [M61 Open Library reading log](milestones/m61.md)    | Done        |           8 | A scrobble add-on marking books read or reading on Open Library                                          |
| [M62 SMB and SFTP](milestones/m62.md)                | Done        |          11 | Built-in sources for NAS shares and plain servers, on Android                                            |
| [M63 Playback fixes](milestones/m63.md)              | Done        |          10 | Small fixes in the playback service and the player, left from earlier reviews                            |
| [M64 Library fixes](milestones/m64.md)               | Done        |          16 | Covers from image files, and folder scans, tags, downloads and matching: fixes left from earlier reviews |
| [M65 Server sources 2](milestones/m65.md)            | Done        |          15 | Outboxes, narrators and series, and steadier places for the media servers                                |
| [M66 Add-on protocol 3](milestones/m66.md)           | Done        |          12 | Editions, settings for every route, paging, more scrobble events and upkeep of first-party add-ons       |
| [M67 Web app 2](milestones/m67.md)                   | Done        |           9 | Faster saves, covers from servers and steadier media keys in the web app                                 |
| [M68 Sync fixes](milestones/m68.md)                  | Done        |           5 | Quieter scans, the source choice synced, and sturdier snapshots and expiry                               |
| [M69 Casting 3](milestones/m69.md)                   | Done        |           9 | Outro skipping, smart rewind and measured timings on receivers, Cast device authentication               |
| [M70 Release upkeep](milestones/m70.md)              | Done        |           5 | Smaller OTA updates, a pinned signing toolchain, F-Droid update checks and other pipeline fixes          |
| [M71 App polish](milestones/m71.md)                  | Done        |          13 | Small fixes on Home, the Library, the Player and Settings, left from earlier reviews                     |
| [M72 Languages 2](milestones/m72.md)                 | Done        |           7 | Native errors, made-up chapter titles, dates and numbers in the profile’s language                       |
| [M73 Landing page polish](milestones/m73.md)         | Done        |           2 | Theme switch announcements, one shared hidden class, narrow screens and escaped holes                    |
| [M74 Car and widget 2](milestones/m74.md)            | Done        |          11 | Car mode with the player's look, phone covers in Android Auto, your cars, a learned battery estimate     |
| [M75 Podcasts 3](milestones/m75.md)                  | Done        |           4 | More Podcasting 2.0 tags, Atom content and logging from the background refresh                           |
| [M76 Hardcover catalogs](milestones/m76.md)          | Done        |           8 | Trending books, featured lists and your own Hardcover lists as catalogs, on your own token               |
| [M77 Hide from library](milestones/m77.md)           | Done        |          15 | Hide items from the library and bring them back; suggestions to hide what looks like music               |
| [M78 Casting 4](milestones/m78.md)                   | Planned     |             | Speaker groups across protocols, and Cast device authentication enforced                                 |
| [M79 Library by progress](milestones/m79.md)         | Done        |           4 | The Library in three groups, In progress, Not started and Finished, each in its own order                |
| [M80 App polish 2](milestones/m80.md)                | In progress |           7 | A zoomed scrubber, matched covers kept offline, faster web saves, player tools at 320 dp                 |
| [M81 Test round 2](milestones/m81.md)                | Planned     |             | A full phone round over adb and the fixes it finds, the gate for v0.1.0                                  |
| [M82 First start](milestones/m82.md)                 | Done        |          10 | A first start that helps: choose a folder or a server, suggested add-ons, helpful empty states           |
| [M83 Accessibility 2](milestones/m83.md)             | Planned     |             | One pass over every screen with TalkBack, large text and contrast                                        |
| [M84 Better sound](milestones/m84.md)                | Done        |          12 | Voice boost, skip silence and even loudness between books                                                |
| [M85 Chapters and bookmarks 2](milestones/m85.md)    | Done        |          10 | Edit chapter names and times, notes on bookmarks, share a short clip                                     |
| [M86 Sleep 2](milestones/m86.md)                     | Done        |          14 | Shake for more time as a setting, a bedtime routine with its volume, back to when you last used it       |
| [M87 Stats and year in sound](milestones/m87.md)     | Done        |           7 | Listening time, finished books and a year overview, worked out on the phone                              |
| [M88 Podcasts 4](milestones/m88.md)                  | Done        |           8 | Chapter images, soundbites in the player, clips that stop at their end, shared places in episodes        |
| [M90 Web app 3](milestones/m90.md)                   | Done        |           9 | Offline downloads in the browser, a better installed app, desktop keys                                   |
| [M91 iOS decision](milestones/m91.md)                | Done        |             | A decision on iOS: what an App Store app would mean for Lelap                                            |
| [M92 Hardcover sign-in](milestones/m92.md)           | Planned     |             | Sign in to Hardcover instead of pasting a token                                                          |
| [M93 Developer docs 2](milestones/m93.md)            | Done        |           3 | A real guide to building an add-on, sample source files and shared page styling                          |
| [M94 Tests against real servers](milestones/m94.md)  | Done        |           1 | WebDAV and S3 servers in CI, and an emulator smoke test of the app                                       |
| [M95 Self-hosting 2](milestones/m95.md)              | Done        |           3 | One-command setup, a small admin page and backup guides                                                  |
| [M96 Security review 2](milestones/m96.md)           | Done        |           7 | A second audit of what landed since M19, its fixes, and an SBOM with each release                        |
| [M97 Landing page 3](milestones/m97.md)              | Done        |           4 | Drawn phone screens checked against reference shots of the app, a changelog page and help                |
| [M98 Developer verification](milestones/m98.md)      | Planned     |             | Google's developer verification for sideloaded apps                                                      |
| [M99 Languages 3](milestones/m99.md)                 | Planned     |             | Media3's own notification texts, saved English chapter names, raw native error details                   |
| [M100 Server sources 3](milestones/m100.md)          | Planned     |             | Places sent while the app is closed, and Plex addresses that follow the server                           |
| [M101 Better sound 2](milestones/m101.md)            | Planned     |             | Skip silence and even loudness on the web, and steadier skip silence accounting                          |
| [M102 Add-on protocol 4](milestones/m102.md)         | Planned     |             | Ratings, Android finish sessions, scrobblers on the SDK's configure and catalog upkeep                   |
| [M103 Podcasts 5](milestones/m103.md)                | Planned     |             | Alternate enclosures, podcast:integrity checks, chapter images on the lock screen                        |
| [M104 Security hardening 3](milestones/m104.md)      | Planned     |             | What M96's audit left: LAN addresses for add-ons, discovery, SMB signing, SDK sealing                    |
| [M105 App polish 3](milestones/m105.md)              | Planned     |             | What M80 left: suggestion covers, podcast badges, Plex library list, a Library that reads less           |
| [M106 Speed and battery](milestones/m106.md)         | Planned     |             | Budgets for cold start, the Library's first draw, memory and battery, kept by the benchmark              |
| [M107 Car and Bluetooth 3](milestones/m107.md)       | Planned     |             | Car mode sideways on phones, covers granted per car app, headphone drain counted once                    |
| [M108 Themes](milestones/m108.md)                    | Planned     |             | Themes beyond the night theme, an accent colour, high contrast, and themes shared as a file              |
| [M109 Series and reading order](milestones/m109.md)  | Planned     |             | Reading order within a series, "Next in the series" when a book ends, missing volumes shown              |
| [M110 Upkeep](milestones/m110.md)                    | Planned     |             | First start leftovers, scan and play in the emulator test, developer setup fixes                         |
| [M111 Podcasts 6](milestones/m111.md)                | Planned     |             | A show's place on a map and podcast:value shown as information                                           |

<!-- milestones:end -->

The first stable release is `v0.1.0`, shipped by [M40](milestones/m40.md) with everything built so
far.

## Future goals

Ideas without a number or a place in the order yet. One becomes a milestone, with its own file,
when it is planned.

- **Wear OS:** control playback from the watch (tile and app: play, pause, skip, the sleep timer),
  and maybe play downloads on it. Was M89; set aside on 2026-11-18 until there is a watch to test
  on.

- **First start, small things (left from M82):** the “Free books” choice names LibriVox even in a
  build whose default add-ons leave it out; it could name the installed ones instead. An install
  with only add-ons, sync or listening history and no books sees the welcome once after updating;
  `needsFirstStart` could count those too.
- **Scan and play on the emulator (left from M94):** the emulator smoke test stops at the empty
  Library. Scanning a pushed folder and playing a file needs the folder picker driven, or a
  debug-only way to add a folder, and a check in logcat that playback started.
- **Developer setup:** Babel's cache hides edits to existing `.sql` migrations (start Expo with
  `--clear`), and `.claude/launch.json` assumes `~/.nvm/nvm.sh` (from M2's review).
- **More from Podcasting 2.0 tags (left from M75):** play a soundbite as a clip that stops at its
  end, and list soundbites in the player; let the listener pick among alternate enclosures (a
  smaller file on mobile data) and check `podcast:integrity`; open a show's place on a map; show
  `podcast:value`. Sending value-for-value payments would move money and needs a decision first.
- **Car and Bluetooth leftovers (from M74):** car mode sideways on phones, which needs the app's
  portrait lock lifted for that screen (`expo-screen-orientation`); a cover provider that grants
  each car app its covers instead of being exported; a headphone drain written once per session,
  so an app restart mid-session doesn't count that session twice.
- **Themes and community looks:** themes for the app beyond the night theme, community skins and
  community players. The M9 avatars and the night theme are the start.

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
