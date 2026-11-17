# Roadmap

Milestones in the order we plan them. Each has its own file in [`milestones/`](milestones/) with
its status, what it needs and when it is done. Change the status line there, never this table, so
pull requests for different milestones never touch the same lines. Decisions and architecture live
in [`brief.md`](brief.md).

| Milestone                                            | In short                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [M0 Claim the name](milestones/m0.md)                | Domain, email, GitHub organisation and Cloudflare account                                               |
| [M1 Audio spike](milestones/m1.md)                   | Media3 playback on a real phone: gapless parts, speed, calls, sleep fade                                |
| [M2 Local library](milestones/m2.md)                 | Local files and folders, chapters from tags, progress, bookmarks                                        |
| [M3 Add-on protocol and SDK](milestones/m3.md)       | Add-on protocol, SDK, Workers template, Catalog and LibriVox add-ons                                    |
| [M4 Downloads](milestones/m4.md)                     | Background downloads with Wi-Fi and charging rules, storage overview                                    |
| [M5 Podcasts](milestones/m5.md)                      | RSS, OPML in and out, auto-download, Up Next                                                            |
| [M6 Web build](milestones/m6.md)                     | The same app on the web: OPFS storage, web audio, feed and cover proxy                                  |
| [M7 Sync](milestones/m7.md)                          | Pairing code and end-to-end encrypted sync of places and lists                                          |
| [M8 Release pipeline](milestones/m8.md)              | Signed APK in CI, in-app updater, Docker images, landing page live                                      |
| [M9 Profiles](milestones/m9.md)                      | Profiles with avatars, PINs and kids limits                                                             |
| [M10 Your own storage](milestones/m10.md)            | WebDAV (Nextcloud, ownCloud, any server), S3-compatible buckets, Audiobookshelf                         |
| [M11 Background engine](milestones/m11.md)           | Up Next with the app closed, feed refresh and auto-download in the background, background sync          |
| [M12 Look and feel](milestones/m12.md)               | UI pass against the design sketch, one icon set, player polish, simple motion                           |
| [M13 Landing page 2](milestones/m13.md)              | Download options (APK, GitHub Releases, Obtainium, F-Droid later), light motion, drop the badge         |
| [M14 Developer platform](milestones/m14.md)          | Developer docs on the site, manifest builder, samples (Hono, Node, Python), hosting guide               |
| [M15 Find any book](milestones/m15.md)               | Search every book (Open Library), item pages without a source, choose between editions/sources          |
| [M16 Organise](milestones/m16.md)                    | Tags, playlists, smart lists, full export and import                                                    |
| [M17 Car and offline web](milestones/m17.md)         | Android Auto browsing, service worker for the web app                                                   |
| [M18 Updates over the air](milestones/m18.md)        | OTA bundles with code signing, beta channel for OTA                                                     |
| [M19 Security and hardening](milestones/m19.md)      | Audit of the services and app, key storage in the Android Keystore, CSP for the web app                 |
| [M20 SDK on npm](milestones/m20.md)                  | Build step for `@lelap/sdk`, Changesets, publishing with provenance from CI                             |
| [M21 Translations](milestones/m21.md)                | UI text in translation files, a few first languages, a way for others to contribute                     |
| [M22 Smarter audio](milestones/m22.md)               | Volume boost, voice EQ and mono through Media3's audio processors                                       |
| [M23 Podcasting 2.0](milestones/m23.md)              | Transcripts, chapter files, person and season tags, funding links from feeds                            |
| [M24 Stats and goals](milestones/m24.md)             | Listening time, streaks, finished books, an optional yearly goal; computed and kept on device           |
| [M25 Home screen and tiles](milestones/m25.md)       | Android widget, Quick Settings tile, sleep timer from the lock screen                                   |
| [M26 Casting](milestones/m26.md)                     | Sonos and DLNA over UPnP, Google Cast speakers (Nest) through an open Cast client, FCast; no Google SDK |
| [M27 Add-on protocol v2](milestones/m27.md)          | Settings pages for add-ons, add-on sign-in, health checks, protocol versioning                          |
| [M28 F-Droid](milestones/m28.md)                     | Reproducible APKs, an F-Droid listing, signed checksums on the site                                     |
| [M29 Sleep and links](milestones/m29.md)             | Sleep timer until end of chapter or episode, shake to extend, retry `/resolve` on 403 and 410           |
| [M30 Scrobbling](milestones/m30.md)                  | `POST /scrobble` in the app, Hardcover and gPodder add-ons, a "Want to read" row on Home                |
| [M31 Discover 2](milestones/m31.md)                  | "Playable only" filter, source badges on covers, alerts when a wanted book gets a source                |
| [M32 Audnexus](milestones/m32.md)                    | Narrators, series and chapters from Audnexus in the Catalog add-on                                      |
| [M33 Everyday Android](milestones/m33.md)            | Wear OS controls, car mode, bedtime sleep timer; nothing that needs Google Play services                |
| [M34 Importers](milestones/m34.md)                   | Goodreads CSV, AntennaPod and Smart AudioBook Player backups                                            |
| [M35 Add-on trust and art](milestones/m35.md)        | Permission view before install, an artwork resource for covers                                          |
| [M36 Jellyfin](milestones/m36.md)                    | Jellyfin as a source, next to Audiobookshelf                                                            |
| [M37 Kids profile](milestones/m37.md)                | A profile with its own library and no add-on installation                                               |
| [M38 Add-ons in the app](milestones/m38.md)          | Sandboxed JavaScript add-ons (QuickJS) with network only to declared hosts, for LAN sources             |
| [M39 Precise seeking](milestones/m39.md)             | Bookmarks on the progress bar with snapping, fine scrubbing and jump-to-time for long books             |
| [M40 First release](milestones/m40.md)               | Beta with everything, test round 2 on the phone, fixes, a stable `v0.1.0`                               |
| [M41 Audiobookshelf](milestones/m41.md)              | Audiobookshelf libraries as a source, with progress synced both ways                                    |
| [M42 Accessibility](milestones/m42.md)               | TalkBack, large text, contrast, focus order, right-to-left layouts                                      |
| [M43 Big libraries](milestones/m43.md)               | 10,000 books: start-up, lists, indexes, scan speed, bundle size                                         |
| [M44 Tablet and desktop](milestones/m44.md)          | Two panes on wide screens, landscape player, keyboard shortcuts on the web                              |
| [M45 Trim silence](milestones/m45.md)                | Chapters from silences for books without them, intro and outro skipping per podcast                     |
| [M46 Recommendations](milestones/m46.md)             | “Because you finished …” rows worked out on the device                                                  |
| [M47 Diagnostics](milestones/m47.md)                 | Opt-in local log and health, exported for bug reports; nothing collected                                |
| [M48 More languages](milestones/m48.md)              | Contribution flow for translators, native Android text, landing page in Malay                           |
| [M49 Artwork badges](milestones/m49.md)              | Rating and progress badges drawn by the app on add-on artwork                                           |
| [M50 Casting 2](milestones/m50.md)                   | Casting that survives a locked phone: foreground service, sleep timer, finish and Up Next on receivers  |
| [M51 Background accounting](milestones/m51.md)       | Stats and scrobbles from the playback service when the app is swiped away                               |
| [M52 Sync upkeep](milestones/m52.md)                 | Snapshots that compact the sync log, expiry of idle groups                                              |
| [M53 Storage choices](milestones/m53.md)             | Download location, covers from server folders, Atom feeds, export to a file                             |
| [M54 Faster builds, smaller APKs](milestones/m54.md) | Build unsigned with caches and sign separately; one APK per CPU type                                    |
| [M55 Light landing page](milestones/m55.md)          | The site and docs in a light theme too, following the system, with a switch                             |

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
