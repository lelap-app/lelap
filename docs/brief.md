# Lelap project brief

The single place for decisions, architecture and scope. Change it in the same pull request as any
change that makes it untrue.

## Decisions

| Topic        | Decision                                                                    | Why                                                                                     |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Name         | **Lelap**, Indonesian for deep, peaceful sleep                              | Short, ownable, neutral to English speakers; matching domain, GitHub and F-Droid names. |
| Slogan       | “From first chapter to fast asleep.”                                        | Descriptor underneath: “The open player for audiobooks and podcasts.”                   |
| Sleep timer  | Called “Sleep timer”, no brand name                                         | Plain words beat a coined name; it was “Lull” until M1.                                 |
| GitHub       | Organisation `lelap-app`, repository `lelap`; images on `ghcr.io/lelap-app` | `lelap` was taken.                                                                      |
| Domain       | `lelap.app` only; developer docs at `lelap.app/docs`                        | Registered through Cloudflare Registrar, WHOIS redacted.                                |
| Web app      | `listen.lelap.app`                                                          | Avoids `app.lelap.app`.                                                                 |
| Platforms    | Android app and web/PWA from one codebase; no iOS app                       | iPhone users get the web app.                                                           |
| Distribution | APK outside Google Play: R2 download, GitHub Releases, Obtainium            | No store review. In-app updater for APKs, OTA for JavaScript changes.                   |
| Releases     | Signed in CI on `v*` tags, behind an environment approval                   | No manual signing.                                                                      |
| Accounts     | None. Optional sync with a pairing code, end-to-end encrypted               | The server only sees ciphertext, including add-on URLs.                                 |
| Content      | Neutral core; content comes from add-ons                                    | See Policy.                                                                             |

## Principles

- **Local first.** Library, progress, downloads and playlists live in SQLite on the device.
- **Offline is a normal day.** Downloads carry cover, chapters and a metadata snapshot.
- **The app only knows “audio file”.** Add-ons are opaque URLs; their settings live with the
  add-on provider. Audio goes from source to device, never through our servers.
- **Native where it matters.** Playback, downloads, casting and the sleep timer run in Kotlin
  services, so they work with the screen off.

## Architecture

```
UI (Expo Router, NativeWind)          same screens on Android and web
Core (TypeScript)                     model, add-on client, ID graph, downloads, sync
Platform adapters                     audio, storage, downloads, casting (.native.ts / .web.ts)
Kotlin modules                        Media3 MediaLibraryService, downloads, Cast/UPnP, updater
Storage                               SQLite (Android), SQLite WASM on OPFS (web)
```

Planned repository layout:

```
apps/app          Expo app: Android and web (listen.lelap.app)
apps/site         landing page and docs: Astro (lelap.app)
packages/core     domain model, add-on client, sync, ID graph
packages/sdk      add-on SDK and types (npm)
modules/audio     Kotlin: Media3 service, focus, fade
modules/download  Kotlin: background downloads
modules/cast      Kotlin: Cast SDK, UPnP
services/catalog  catalog add-on (Hono)
services/proxy    RSS, cover and transcript proxy for the web (Hono)
services/sync     encrypted sync (Hono)
services/updates  expo-updates server and latest.json (Hono)
docker/           compose file and images for self-hosting
```

## Stack

| Area           | Choice                                                          |
| -------------- | --------------------------------------------------------------- |
| Monorepo       | pnpm workspaces; Changesets for the SDK; Turborepo if needed    |
| App            | Expo with dev client, Expo Router, react-native-web             |
| Styling        | NativeWind (Tailwind classes on native and web)                 |
| Server state   | TanStack Query                                                  |
| Audio, Android | Media3 ExoPlayer in a `MediaLibraryService`, own audio focus    |
| Audio, web     | `<audio>`, volume fade for the sleep timer, Media Session       |
| Database       | SQLite via Drizzle ORM (expo-sqlite; sql.js + OPFS on the web)  |
| Validation     | zod; the protocol's JSON Schema generated with `z.toJSONSchema` |
| Sync crypto    | `@noble` XChaCha20-Poly1305, key shared by a pairing code       |
| Backend        | Hono on Cloudflare Workers; same code in Docker via Node        |
| OTA updates    | expo-updates, self-hosted server, code-signed bundles           |
| Site and docs  | Astro, static on Cloudflare Pages                               |
| Tests          | Vitest; `@cloudflare/vitest-pool-workers` for services          |

## Add-on protocol

Stateless HTTP and JSON, modelled on Stremio's add-on protocol. Every response sends
`Access-Control-Allow-Origin: *`.

```
GET  /manifest.json
GET  /catalog/{type}/{id}/{extra}.json
GET  /meta/{type}/{id}.json
GET  /stream/{type}/{id}.json
POST /scrobble            (only if declared)
GET  /configure           (the add-on's own settings page)
```

- **Types:** `audiobook`, `podcast`, `episode`.
- **Stream objects:** one file with `chapters`, or `parts` (files with durations); `size`, `mime`,
  `bitrate`, `downloadable`, a stable `sourceKey`.
- **Resolve redirect:** a stable `/resolve/…` URL that redirects to a fresh link; the player calls
  it again on 403 or 410.
- **IDs:** Open Library work IDs are canonical; meta add-ons return `externalIds`. Podcasts use
  `podcast:guid` and episode GUIDs.
- **Configuration** lives on the add-on's `/configure` page; the app stores only the URL.
- **Scrobble events** carry an `eventId`, the real timestamp and never the source URL.

First-party add-ons: Catalog (Open Library, Audnexus, Podcast Index), LibriVox, WebDAV,
Audiobookshelf. RSS and local files are built into the app.

## Infrastructure

| Host                | What                                  | Runs on                       |
| ------------------- | ------------------------------------- | ----------------------------- |
| `lelap.app`         | Landing page, `/docs`, terms, privacy | Pages                         |
| `listen.lelap.app`  | The PWA                               | Pages                         |
| `dl.lelap.app`      | APKs, `latest.json`, OTA bundles      | R2                            |
| `updates.lelap.app` | expo-updates manifests                | Worker + R2                   |
| `catalog.lelap.app` | Catalog add-on                        | Worker + Cache API            |
| `proxy.lelap.app`   | RSS, covers, transcripts; never audio | Worker + Cache API            |
| `sync.lelap.app`    | Encrypted blobs and oplogs            | Worker + D1 or Durable Object |

Self-hosting: images `web`, `catalog`, `proxy`, `sync` on `ghcr.io`; storage adapters swap D1 for
SQLite and R2 for disk or MinIO.

## CI/CD

| Trigger        | Runs                                                                                            | Secrets                         |
| -------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| Pull request   | Check, test, build; no deploys                                                                  | None                            |
| Push to `main` | Deploy site and PWA; services to staging once it exists (M7)                                    | `web` environment               |
| Tag `v*`       | Sign APK, R2 and GitHub Releases, OTA bundle, Docker images, provenance; services to production | `release` environment, approval |

Environments over time (dev, production, previews, staging, beta) are in
[`roadmap.md`](roadmap.md#environments).

Protection: tag ruleset for `v*`, required reviewer on `release`, branch protection on `main`,
2FA, read-only default permissions, actions pinned to SHAs, secret scanning, offline keystore backup.

## Android notes

- Foreground service types `mediaPlayback` and `dataSync`; `POST_NOTIFICATIONS`,
  `REQUEST_INSTALL_PACKAGES`.
- Ask for a battery optimisation exemption on first download.
- Sideloaded apps need “Unknown sources” enabled in Android Auto's developer settings.
- Signing certificate uses `CN=Lelap`. Losing the keystore means users must reinstall.

## Policy

- First-party add-ons only for open sources and storage the user controls.
- No list, store or recommendations of third-party add-ons.
- No audio through Lelap infrastructure.
- Rights holders reach us at `copyright@lelap.app`; the landing page shows it.
- Moderate project channels; remove requests for and links to pirated content.

## Milestones

M0 to M8, their status, “done when” criteria and the Cloudflare resources each one needs are in
[`roadmap.md`](roadmap.md).

## v1.0 scope

- **Player:** background playback, call ducking, speed per book, smart rewind, chapters, bookmarks,
  sleep timer with fade and shake to extend.
- **Library:** local files, background downloads, airplane mode, tags, playlists, smart lists,
  Up Next, RSS with OPML, full export.
- **Add-ons:** protocol v1 (catalog, meta, stream, search), SDK, Catalog, LibriVox and WebDAV
  add-ons, Home rows, Discover, merged search.
- **Platform:** PWA, encrypted sync, APK updater and OTA, Docker compose, Android Auto browsing,
  landing page with terms, privacy and copyright contact.

## Later

Profiles for a household with optional PIN, avatars and a kids profile
([M9 in the roadmap](roadmap.md#m9-profiles-v11)), casting (Chromecast, Sonos), scrobbling
(Hardcover, gPodder, Goodreads CSV), Audiobookshelf and Jellyfin add-ons, artwork add-ons with
app-drawn rating badges, on-device recommendations, silence auto-chapters and Podcasting 2.0
transcripts, voice boost and intro trimming, widgets and Wear OS, stats, importers, sandboxed local
add-ons, add-on health and permissions, and the output device (Bluetooth headphones, car) named in
the Player.

## Web build (M6)

- **Database:** sql.js in memory, with the whole file written to OPFS about a second after each
  change and when the tab hides. expo-sqlite's web build needs cross-origin isolation, which blocks
  covers and audio from other sites and does not work in Safari.
- **Audio:** one `<audio>` element and Media Session. The sleep timer fades the element's volume;
  a Web Audio gain node would need CORS on every audio host.
- **Downloads:** fetch into OPFS while the tab is open, when the audio host allows CORS. No Wi-Fi
  or charging rules. Local library folders are Android only.
- **Feeds** go through `proxy.lelap.app` (XML only, 10 MB, never audio); plain-http covers too, and
  Podcasting 2.0 chapters files and transcripts (UTF-8 text only, 5 MB).

## Sync (M7)

- **Group:** devices that sync share a random 32-byte key. The server knows a random group ID and
  the SHA-256 of an auth token derived from the key (HKDF), never the key.
- **Oplog:** each sync pushes the rows changed since the last push as operations, sealed with
  XChaCha20-Poly1305 (`@noble/ciphers`: pure JavaScript, so the same code runs in Hermes, browsers
  and Workers; libsodium needs WebAssembly, which Hermes lacks). The newest change to a row wins.
  Deletions travel as tombstones. Books are named by what they are (location, or feed URL and
  episode guid), since row IDs differ per device.
- **Pairing:** a 12-character code (60 bits). Its scrypt output gives the server a lookup ID and a
  key that seals the group secret; the server keeps the blob ten minutes and hands it out once.
- **What syncs:** places, finished and speed, bookmarks, streamed books, podcast subscriptions and
  episode places, Up Next, playback settings, profiles. Not: local files, downloads, download
  rules, add-on lists.
- **Journal times:** the playback journal carries when the place last moved, not when it was
  written, so a stale place loaded on one device never outranks a newer one from another.

## Open questions

- License: AGPL-3.0 for app and services with MIT for the SDK, or something simpler.
- Google's developer verification for sideloaded apps: current requirements.
- F-Droid: a `foss` flavor without the Google Cast SDK; reproducible builds or F-Droid's own key.
