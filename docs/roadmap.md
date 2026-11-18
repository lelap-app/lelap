# Roadmap

Milestones in the order we plan them. Each has its own file in [`milestones/`](milestones/): its
title, status, summary and pull requests in front matter, what shipped or what is planned, and its
open checks at the end. The table below is generated from those files: change a milestone's file
and run `pnpm roadmap`; never edit the table by hand. `pnpm checks` lists every open check.
Decisions and architecture live in [`brief.md`](brief.md).

<!-- milestones:start -->

| Milestone                                            | Status      | Open checks | In short                                                                                                |
| ---------------------------------------------------- | ----------- | ----------: | ------------------------------------------------------------------------------------------------------- |
| [M0 Claim the name](milestones/m0.md)                | Done        |             | Domain, email, GitHub organisation and Cloudflare account                                               |
| [M1 Audio spike](milestones/m1.md)                   | Done        |           4 | Media3 playback on a real phone: gapless parts, speed, calls, sleep fade                                |
| [M2 Local library](milestones/m2.md)                 | Done        |          13 | Local files and folders, chapters from tags, progress, bookmarks                                        |
| [M3 Add-on protocol and SDK](milestones/m3.md)       | Done        |           4 | Add-on protocol, SDK, Workers template, Catalog and LibriVox add-ons                                    |
| [M4 Downloads](milestones/m4.md)                     | Done        |           8 | Background downloads with Wi-Fi and charging rules, storage overview                                    |
| [M5 Podcasts](milestones/m5.md)                      | Done        |           6 | RSS, OPML in and out, auto-download, Up Next                                                            |
| [M6 Web build](milestones/m6.md)                     | Done        |           3 | The same app on the web: OPFS storage, web audio, feed and cover proxy                                  |
| [M7 Sync](milestones/m7.md)                          | Done        |           5 | Pairing code and end-to-end encrypted sync of places and lists                                          |
| [M8 Release pipeline](milestones/m8.md)              | Done        |           2 | Signed APK in CI, in-app updater, Docker images, landing page live                                      |
| [M9 Profiles](milestones/m9.md)                      | Done        |           5 | Profiles with avatars, PINs and kids limits                                                             |
| [M10 Your own storage](milestones/m10.md)            | Done        |           7 | WebDAV (Nextcloud, ownCloud, any server) and S3-compatible buckets                                      |
| [M11 Background engine](milestones/m11.md)           | Done        |           2 | Up Next with the app closed, feed refresh and auto-download in the background, background sync          |
| [M12 Look and feel](milestones/m12.md)               | Done        |           4 | UI pass against the design sketch, one icon set, player polish, simple motion                           |
| [M13 Landing page 2](milestones/m13.md)              | Done        |           2 | Download options (APK, GitHub Releases, Obtainium, F-Droid later), light motion, drop the badge         |
| [M14 Developer platform](milestones/m14.md)          | Done        |           2 | Developer docs on the site, manifest builder, samples (Hono, Node, Python), hosting guide               |
| [M15 Find any book](milestones/m15.md)               | Done        |           4 | Search every book (Open Library), item pages without a source, choose between editions and sources      |
| [M16 Organise](milestones/m16.md)                    | Done        |           6 | Tags, playlists, smart lists, full export and import                                                    |
| [M17 Car and offline web](milestones/m17.md)         | Done        |          13 | Android Auto browsing, service worker for the web app                                                   |
| [M18 Updates over the air](milestones/m18.md)        | Done        |           7 | OTA bundles with code signing, beta channel for OTA                                                     |
| [M19 Security and hardening](milestones/m19.md)      | Done        |           9 | Audit of the services and app, key storage in the Android Keystore, CSP for the web app                 |
| [M20 SDK on npm](milestones/m20.md)                  | Done        |           1 | Build step for `@lelap/sdk`, Changesets, publishing with provenance from CI                             |
| [M21 Translations](milestones/m21.md)                | Done        |           3 | UI text in translation files, a few first languages, a way for others to contribute                     |
| [M22 Smarter audio](milestones/m22.md)               | Done        |          11 | Volume boost, voice EQ and mono through Media3's audio processors                                       |
| [M23 Podcasting 2.0](milestones/m23.md)              | Done        |           6 | Transcripts, chapter files, person and season tags, funding links from feeds                            |
| [M24 Stats and goals](milestones/m24.md)             | Done        |           4 | Listening time, streaks, finished books, an optional yearly goal; computed and kept on device           |
| [M25 Home screen and tiles](milestones/m25.md)       | Done        |           9 | Android widget, Quick Settings tile, sleep timer from the lock screen                                   |
| [M26 Casting](milestones/m26.md)                     | Done        |          10 | Sonos and DLNA over UPnP, Google Cast speakers (Nest) through an open Cast client, FCast; no Google SDK |
| [M27 Add-on protocol v2](milestones/m27.md)          | Done        |           6 | Settings pages for add-ons, add-on sign-in, health checks, protocol versioning                          |
| [M28 F-Droid](milestones/m28.md)                     | In progress |           2 | Reproducible APKs, an F-Droid listing, signed checksums on the site                                     |
| [M29 Sleep and links](milestones/m29.md)             | Done        |          10 | Sleep timer until end of chapter or episode, shake to extend, retry `/resolve` on 403 and 410           |
| [M30 Scrobbling](milestones/m30.md)                  | Done        |           5 | `POST /scrobble` in the app, Hardcover and gPodder add-ons, a “Want to read” row on Home                |
| [M31 Discover 2](milestones/m31.md)                  | Done        |           7 | “Playable only” filter, source badges on covers, alerts when a wanted book gets a source                |
| [M32 Audnexus](milestones/m32.md)                    | Done        |           4 | Narrators, series and chapters from Audnexus in the Catalog add-on                                      |
| [M33 Everyday Android](milestones/m33.md)            | Done        |          14 | Wear OS controls, car mode, bedtime sleep timer; nothing that needs Google Play services                |
| [M34 Importers](milestones/m34.md)                   | Done        |           7 | Goodreads CSV, AntennaPod and Smart AudioBook Player backups                                            |
| [M35 Add-on trust and art](milestones/m35.md)        | Done        |           3 | Permission view before install, an artwork resource for covers                                          |
| [M36 Jellyfin](milestones/m36.md)                    | Done        |           5 | Jellyfin as a source, next to Audiobookshelf                                                            |
| [M37 Kids profile](milestones/m37.md)                | Done        |           4 | A profile with its own library and no add-on installation                                               |
| [M38 Add-ons in the app](milestones/m38.md)          | Done        |           5 | Sandboxed JavaScript add-ons with network only to declared hosts, for LAN sources                       |
| [M39 Precise seeking](milestones/m39.md)             | Done        |           4 | Bookmarks on the progress bar with snapping, fine scrubbing and jump-to-time for long books             |
| [M40 First release](milestones/m40.md)               | In progress |             | Beta with everything, test round 2 on the phone, fixes, a stable `v0.1.0`                               |
| [M41 Audiobookshelf](milestones/m41.md)              | Done        |           7 | Audiobookshelf libraries as a source, with progress synced both ways                                    |
| [M42 Accessibility](milestones/m42.md)               | Done        |          23 | TalkBack, large text, contrast, focus order, right-to-left layouts                                      |
| [M43 Big libraries](milestones/m43.md)               | Done        |           5 | 10,000 books: start-up, lists, indexes, scan speed, bundle size                                         |
| [M44 Tablet and desktop](milestones/m44.md)          | Done        |           8 | Two panes on wide screens, landscape player, keyboard shortcuts on the web                              |
| [M45 Trim silence](milestones/m45.md)                | Done        |          12 | Chapters from silences for books without them, intro and outro skipping per podcast                     |
| [M46 Recommendations](milestones/m46.md)             | Done        |           4 | “Because you finished …” rows worked out on the device                                                  |
| [M47 Diagnostics](milestones/m47.md)                 | Done        |           3 | Opt-in local log and health, exported for bug reports; nothing collected                                |
| [M48 More languages](milestones/m48.md)              | Done        |           6 | Contribution flow for translators, native Android text, landing page in Malay                           |
| [M49 Artwork badges](milestones/m49.md)              | Done        |           5 | Rating and progress badges drawn by the app on add-on artwork                                           |
| [M50 Casting 2](milestones/m50.md)                   | Done        |          10 | Casting that survives a locked phone: foreground service, sleep timer, finish and Up Next on receivers  |
| [M51 Background accounting](milestones/m51.md)       | Done        |           7 | Stats and scrobbles from the playback service when the app is swiped away                               |
| [M52 Sync upkeep](milestones/m52.md)                 | Done        |           4 | Snapshots that compact the sync log, expiry of idle groups                                              |
| [M53 Storage choices](milestones/m53.md)             | Done        |          11 | Download location, covers from server folders, Atom feeds, export to a file                             |
| [M54 Faster builds, smaller APKs](milestones/m54.md) | Done        |           9 | Build unsigned with caches and sign separately; one APK per CPU type                                    |
| [M55 Light landing page](milestones/m55.md)          | Done        |           4 | The site and docs in a light theme too, following the system, with a switch                             |
| [M56 Your copy, linked](milestones/m56.md)           | Done        |           7 | Books found in Discover linked to your own copy on a folder, WebDAV, S3 or a media server               |
| [M57 Add-ons as library sources](milestones/m57.md)  | Done        |           9 | In-app add-ons with sealed logins, stream headers and library scans; bundled ones in “Add a server”     |
| [M58 Navidrome and Subsonic](milestones/m58.md)      | Done        |           8 | A bundled add-on for Subsonic-API servers: library, streams, bookmarks                                  |
| [M59 Plex and Emby](milestones/m59.md)               | Done        |          11 | Bundled add-ons for two more media servers, places both ways                                            |
| [M60 Internet Archive](milestones/m60.md)            | Done        |           5 | A hosted add-on for public-domain audio on archive.org beyond LibriVox                                  |
| [M61 Open Library reading log](milestones/m61.md)    | Done        |           8 | A scrobble add-on marking books read or reading on Open Library                                         |
| [M62 SMB and SFTP](milestones/m62.md)                | Done        |          11 | Built-in sources for NAS shares and plain servers, on Android                                           |
| [M63 Playback fixes](milestones/m63.md)              | Planned     |             | Small fixes in the playback service and the player, left from earlier reviews                           |
| [M64 Library fixes](milestones/m64.md)               | Planned     |             | Folder scans, tags, downloads and matching: small fixes left from earlier reviews                       |
| [M65 Server sources 2](milestones/m65.md)            | Planned     |             | Outboxes, narrators and series, and steadier places for the media servers                               |
| [M66 Add-on protocol 3](milestones/m66.md)           | Planned     |             | Editions, settings for every route, paging, more scrobble events and upkeep of first-party add-ons      |
| [M67 Web app 2](milestones/m67.md)                   | Planned     |             | Faster saves, covers from servers and steadier media keys in the web app                                |
| [M68 Sync fixes](milestones/m68.md)                  | Planned     |             | Quieter scans, the source choice synced, and sturdier snapshots and expiry                              |
| [M69 Casting 3](milestones/m69.md)                   | Planned     |             | Outro skipping, smart rewind and measured timings on receivers, Cast device authentication              |
| [M70 Release upkeep](milestones/m70.md)              | Planned     |             | Smaller OTA updates, a pinned signing toolchain, F-Droid update checks and other pipeline fixes         |
| [M71 App polish](milestones/m71.md)                  | Planned     |             | Small fixes on Home, the Library, the Player and Settings, left from earlier reviews                    |
| [M72 Languages 2](milestones/m72.md)                 | Planned     |             | Native errors, made-up chapter titles, dates and numbers in the profile’s language                      |
| [M73 Landing page polish](milestones/m73.md)         | Planned     |             | Theme switch announcements, one shared hidden class, light splash colours and narrow screens            |
| [M74 Car and widget 2](milestones/m74.md)            | Planned     |             | Covers from servers in the widget and the car, a list of your cars, a better battery estimate           |
| [M75 Podcasts 3](milestones/m75.md)                  | Planned     |             | More Podcasting 2.0 tags, Atom content and logging from the background refresh                          |
| [M76 Hardcover catalogs](milestones/m76.md)          | Done        |           8 | Trending books, featured lists and your own Hardcover lists as catalogs, on your own token              |
| [M77 Hide from library](milestones/m77.md)           | Done        |          15 | Hide items from the library and bring them back; suggestions to hide what looks like music              |

<!-- milestones:end -->

The first stable release is `v0.1.0`, shipped by [M40](milestones/m40.md) with everything built so
far.

## Future goals

Ideas without a number or a place in the order yet. One becomes a milestone, with its own file,
when it is planned.

- **WebDAV and S3 integration tests in CI:** a small WebDAV server (for example `rclone serve webdav`)
  as a service container, with `checkWebdav` and `listWebdav` run against it over real HTTP, so
  the WebDAV code is tested against a real server on every pull request, not only stand-ins.
  One-off checks against Nextcloud 35 and MinIO (S3) in Docker passed on 2026-11-17; the same
  CI job can cover S3 with MinIO.
- **Developer setup:** Babel's cache hides edits to existing `.sql` migrations (start Expo with
  `--clear`), and `.claude/launch.json` assumes `~/.nvm/nvm.sh` (from M2's review).
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
