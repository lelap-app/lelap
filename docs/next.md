# Next

What comes after M0–M9: the v1.0 gaps, the next ten milestones, and the smaller tasks and
decisions collected on 2026-11-17. Move an item into [`roadmap.md`](roadmap.md) when work on it
starts. Scope rules from [`AGENTS.md`](../AGENTS.md) apply to everything here: open sources and
storage the user controls only, no add-on directory, audio never through our servers.

## v1.0 gaps

In [the brief's v1.0 scope](brief.md#v10-scope) but not built by M1–M9:

- **WebDAV add-on** (also the most asked-for source; see M10).
- **Tags, playlists, smart lists** and **full export** of the library.
- **Shake to extend** the sleep timer.
- **Android Auto browsing.**
- **OTA updates** (expo-updates; design in [M8 follow-ups](m8-follow-ups.md#3-left-out-of-this-pass-ota-bundles)).
- **Offline PWA** (a service worker; the web app is installable but needs the network to start).

## Proposed milestones

| #   | Milestone              | In short                                                                                        |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| M10 | Your own storage       | WebDAV (Nextcloud, ownCloud, any server), S3-compatible buckets, Audiobookshelf                 |
| M11 | Background engine      | Up Next with the app closed, feed refresh and auto-download in the background, background sync  |
| M12 | Look and feel          | UI pass against the design sketch, one icon set, player polish, simple motion                   |
| M13 | Landing page 2         | Download options (APK, GitHub Releases, Obtainium, F-Droid later), light motion, drop the badge |
| M14 | Developer platform     | Developer docs on the site, manifest builder, samples (Hono, Node, Python), hosting guide       |
| M15 | Find any book          | Search every book (Open Library), item pages without a source, choose between editions/sources  |
| M16 | Organise               | Tags, playlists, smart lists, full export and import                                            |
| M17 | Car and offline web    | Android Auto browsing, service worker for the web app                                           |
| M18 | Updates over the air   | OTA bundles with code signing, beta channel for OTA                                             |
| M19 | Security and hardening | Audit of the services and app, key storage in the Android Keystore, CSP for the web app         |
| M20 | SDK on npm             | Build step for `@lelap/sdk`, Changesets, publishing with provenance from CI                     |
| M21 | Translations           | UI text in translation files, a few first languages, a way for others to contribute             |
| M22 | Smarter audio          | Volume boost, voice EQ and mono through Media3's audio processors                               |
| M23 | Podcasting 2.0         | Transcripts, chapter files, person and season tags, funding links from feeds                    |
| M24 | Stats and goals        | Listening time, streaks, finished books, an optional yearly goal; computed and kept on device   |
| M25 | Home screen and tiles  | Android widget, Quick Settings tile, sleep timer from the lock screen                           |
| M26 | Casting                | Open protocols only (DLNA/UPnP, which includes Sonos, and FCast), no Google Cast SDK            |
| M27 | Add-on protocol v2     | Settings pages for add-ons, add-on sign-in, health checks, protocol versioning                  |
| M28 | F-Droid                | Reproducible APKs, an F-Droid listing, signed checksums on the site                             |
| M29 | Sleep and links        | Sleep timer until end of chapter or episode, shake to extend, retry `/resolve` on 403 and 410   |
| M30 | Scrobbling             | `POST /scrobble` in the app, Hardcover and gPodder add-ons, a "Want to read" row on Home        |
| M31 | Discover 2             | "Playable only" filter, source badges on covers, alerts when a wanted book gets a source        |
| M32 | Audnexus               | Narrators, series and chapters from Audnexus in the Catalog add-on                              |
| M33 | Everyday Android       | Wear OS controls, car mode, bedtime sleep timer; nothing that needs Google Play services        |
| M34 | Importers              | Goodreads CSV, AntennaPod and Smart AudioBook Player backups                                    |
| M35 | Add-on trust and art   | Permission view before install, an artwork resource for covers                                  |
| M36 | Jellyfin               | Jellyfin as a source, next to Audiobookshelf                                                    |
| M37 | Kids profile           | A profile with its own library and no add-on installation                                       |
| M38 | Add-ons in the app     | Sandboxed JavaScript add-ons (QuickJS) with network only to declared hosts, for LAN sources     |

M29 and M32 close gaps in the brief's v1.0 scope; they can run before the others.

Much later (around M40): themes, community skins and community players (the M9 avatars and the
night theme are the start). Not planned: an iOS app, which would need an App Store account.

### M20 SDK on npm

- `@lelap/sdk` (MIT) gets a build step (ESM and type declarations), a `files` list and a README.
- Changesets for versions and changelogs; a workflow on the `release` environment publishes with
  `npm publish --provenance`. Needs an npm account, the `@lelap` scope and an automation token.
- M14's samples and manifest builder then install the SDK from npm instead of the workspace.

### M10 Your own storage

- **How sources work today:** a source is an add-on, installed by pasting its manifest URL in
  Settings → Add-ons. OPML is only for podcast subscriptions. WebDAV and Audiobookshelf need
  add-ons (or built-in sources); none exist yet.
- **Design question:** add-ons are stateless HTTP services, but WebDAV and S3 need credentials, and
  the audio must go from the server to the phone directly (never through ours). Options:
  1. A built-in source in the app, next to local folders: the app talks WebDAV/S3 itself and keeps
     the credentials on the device. Simplest and private; works on the web for servers with CORS.
  2. A self-hosted add-on (in the Docker compose) that lists the server and returns signed or
     tokenised stream URLs. Fits the add-on model; more setup for the user.
     Proposal: 1 for WebDAV and S3 (they are “storage the user controls”, like local folders), 2 for
     Audiobookshelf, which already has its own API and tokens.
- Book grouping reuses M2's folder rules; downloads reuse M4.

### M14 Developer platform

- `lelap.app/docs` grows into a developer section: protocol reference (exists), data model samples,
  a manifest builder page (fill in a form, get a `manifest.json` and a starter project), samples in
  Hono (exists as `services/template`), plain Node and Python, and a hosting section (Workers,
  Docker, any HTTPS host).
- **Hard-coded catalogs** are already easy: `catalog` handlers can return a fixed list. The docs
  get an example with two seasonal catalogs (for example “Christmas” and “Autumn”) of public-domain
  LibriVox books, served from static JSON with no code beyond the SDK.

### M15 Find any book

- Search already returns Open Library works from the Catalog add-on, and their item pages say
  “No audio for this book yet” when no installed add-on has a stream. M15 makes that a first-class
  page (description, editions, author) and shows every matching source when there are several.
- Several sources per book: the item page lists each stream with its add-on and title (“LibriVox ·
  read by …”, “Nextcloud · /Audiobooks/…”), and the choice is remembered per book.

## Smaller tasks

- **UI review:** compare every screen with the design sketch and the landing page mockup; the skip
  and rewind buttons are text glyphs today and should be icons. Also from the sketch: a “Ready for
  offline” card and an add-on status pill on Home, “Searched 5 add-ons · 4 answered” in Search,
  and the airplane-mode banner in Library. (M12)
- **Landing page:** remove the “Screen off, still playing” badge (a commit for it sits on branch
  `site/drop-screen-off-badge` and never got a PR). (M13)
- **Download location:** downloads live in the app's private no-backup storage, removed with the
  app and invisible to file managers. Add a choice of a folder (SD card, shared storage) through
  Android's folder picker. (M10 or M16)
- **Security audit** of the four services and the app. The backend is small, so this is mostly
  the sync and proxy rate limits, pairing, CORS, headers, dependencies and secrets handling. (M19)
- **Next steps for M5 and M7** that need no phone: background feed refresh, sync log compaction.

## Answers worth keeping

- **Third-party sources in general:** anyone can host an add-on that speaks the protocol and give
  people its manifest URL; Lelap never needs to know about it, and the project neither lists nor
  builds add-ons for services outside its scope.
- **Hard-coded catalogs:** yes, see M14.

## Decisions on 2026-11-17

- **Casting** uses open protocols (DLNA/UPnP, FCast) instead of the Google Cast SDK, so one build
  works for F-Droid too.
- **No guessed chapters:** chapters come from tags, feeds and Audnexus, never from silence
  detection. Skip silence is out as well.
- **Wear OS and car mode** only if they need no Google Play services; Wear OS controls come from
  the media session, without a separate watch app that needs the Wearable Data Layer.
