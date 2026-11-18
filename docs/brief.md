# Lelap project brief

Decisions, principles and architecture. Change it in the same pull request as any change that makes
it untrue. What gets built when is in [`roadmap.md`](roadmap.md).

## Decisions

| Topic                | Decision                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                 | **Lelap**, Indonesian for deep, peaceful sleep                                                                                                                  | Short, ownable, neutral to English speakers; matching domain, GitHub and F-Droid names.                                                                                                                                                                                                                                               |
| Slogan               | “From first chapter to fast asleep.”                                                                                                                            | Descriptor underneath: “The open player for audiobooks and podcasts.”                                                                                                                                                                                                                                                                 |
| Sleep timer          | Called “Sleep timer”, no brand name                                                                                                                             | Plain words beat a coined name; it was “Lull” until M1.                                                                                                                                                                                                                                                                               |
| Mascot               | **Lori**, a slow loris, asleep with headphones on                                                                                                               | Nocturnal like the night theme and, like the name, from Indonesia. Drawn as a wild animal at night, never as a pet: lorises are endangered and hurt by the pet trade. Fen (fennec fox) and Ollie (sea otter) are profile pictures.                                                                                                    |
| GitHub               | Organisation `lelap-app`, repository `lelap`; images on `ghcr.io/lelap-app`                                                                                     | `lelap` was taken.                                                                                                                                                                                                                                                                                                                    |
| Domain               | `lelap.app` only; developer docs at `lelap.app/docs`                                                                                                            | Registered through Cloudflare Registrar, WHOIS redacted.                                                                                                                                                                                                                                                                              |
| Web app              | `listen.lelap.app`                                                                                                                                              | Avoids `app.lelap.app`.                                                                                                                                                                                                                                                                                                               |
| Platforms            | Android app and web/PWA from one codebase; no iOS app                                                                                                           | iPhone users get the web app.                                                                                                                                                                                                                                                                                                         |
| Distribution         | APK outside Google Play: R2 download, GitHub Releases, Obtainium                                                                                                | No store review. In-app updater for APKs, OTA for JavaScript changes.                                                                                                                                                                                                                                                                 |
| Releases             | Signed in CI on `v*` tags, behind an environment approval                                                                                                       | No manual signing.                                                                                                                                                                                                                                                                                                                    |
| Accounts             | None. Optional sync with a pairing code, end-to-end encrypted                                                                                                   | The server only sees ciphertext, including add-on URLs.                                                                                                                                                                                                                                                                               |
| License              | AGPL-3.0 for the app and services, MIT for the add-on SDK                                                                                                       | Changes to a hosted Lelap service stay open; add-on authors can use the SDK anywhere.                                                                                                                                                                                                                                                 |
| Content              | Neutral core; content comes from add-ons                                                                                                                        | See Policy.                                                                                                                                                                                                                                                                                                                           |
| Own storage          | WebDAV, S3, Jellyfin and Audiobookshelf built in; new sources as in-app add-ons                                                                                 | Logins stay sealed on the phone; home servers are only reachable from it; Media3 sends login headers, which only in-app add-ons may ask for, to their own hosts; audio never goes through our servers. Built-in types are modules in `packages/core/src/remote/`, bundled add-ons files in `packages/core/src/addons/bundled/`.       |
| Audiobookshelf login | API key only (Audiobookshelf 2.26 and later); no password sign-in                                                                                               | Keys don't expire unless the user sets an end date, so there is nothing to renew, and the password never reaches Lelap. Older servers are not supported.                                                                                                                                                                              |
| Casting              | Open protocols only: UPnP for Sonos and DLNA, FCast, and an own client for Google Cast speakers                                                                 | One build works for F-Droid too; no Google Cast SDK. Every receiver fetches the audio itself; files on the phone are served from the phone on the LAN.                                                                                                                                                                                |
| Google Play services | Not used, also for Wear OS and car mode                                                                                                                         | Wear OS controls come from the media session, without a watch app that needs the Wearable Data Layer.                                                                                                                                                                                                                                 |
| Chapters             | From tags, feeds and Audnexus; for books with none, found on the device from long silences                                                                      | Silence chapters are a fallback for books that have no marks at all (M45). Android only, decoded in a background worker that stops on a low battery; a browser decodes a whole file into memory at once, gigabytes for a long book, so the web leaves it out. Found chapters stay on the device that found them and are never synced. |
| Recommendations      | Worked out on the device per profile, only from catalog pages Home already loads                                                                                | No request carries listening history, finished titles or the library (M46). Suggestion tiles ask add-ons for no artwork or sources; what they send is in [M46](milestones/m46.md#requests).                                                                                                                                           |
| Intro and outro      | Seconds to skip per show, per profile, synced with the subscription                                                                                             | Set once for a podcast (M45) and applied by the player itself, so episodes that Up Next or the car starts with the app closed skip them too.                                                                                                                                                                                          |
| Idle sync groups     | Expire after a set time without a push: 2 years on lelap.app, never by default when self-hosted                                                                 | A group nobody uses should not stay on our server forever (security audit, finding 18). It is the sync service's `SYNC_IDLE_EXPIRY_DAYS` setting, so self-hosters choose; devices keep their data and can pair again (M52).                                                                                                           |
| Internet Archive     | Serves items with a Creative Commons licence (NC and ND included) or public-domain tool, items archive.org marks `NOT_IN_COPYRIGHT`, and LibriVox; nothing else | archive.org's own rights fields are the source; the add-on doesn't judge copyright itself. Audio streams from archive.org, never through Lelap (M60).                                                                                                                                                                                 |

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
Kotlin modules                        Media3 MediaLibraryService, downloads, casting, updater
Storage                               SQLite (Android), SQLite WASM on OPFS (web)
```

The repository layout is in [`AGENTS.md`](../AGENTS.md#repository-map).

### Web

- **Database:** sql.js in memory, with the whole file written to OPFS about a second after each
  change and when the tab hides. expo-sqlite's web build needs cross-origin isolation, which blocks
  covers and audio from other sites and does not work in Safari.
- **Audio:** one `<audio>` element and Media Session. The sleep timer fades the element's volume;
  a Web Audio gain node would need CORS on every audio host. Media keys reach it through Media
  Session; the app's own shortcuts (Space or K, ← and →, < and >, / and ?) are listed under ?.
- **Downloads:** fetch into OPFS while the tab is open, when the audio host allows CORS. No Wi-Fi
  or charging rules. Local library folders are Android only.
- **Feeds** go through `proxy.lelap.app` (XML only, 10 MB, never audio); plain-http covers too, and
  Podcasting 2.0 chapters files and transcripts (UTF-8 text only, 5 MB).

### Sync

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
  episode places, Up Next, playback settings, profiles, and which library books are which add-on
  works (keyed on the book's location). Not: local files, downloads, download
  rules, add-on lists.
- **Snapshots:** once a group's messages older than 30 days reach 1 MB, a device folds them,
  with the previous snapshot, into a sealed snapshot (the newest change per row) and the server
  drops the messages it covers. New devices start from the snapshot. Messages younger than 30
  days stay, so an app from before snapshots that syncs monthly keeps working; one further behind
  is stopped with “Update Lelap” rather than missing changes (M52).
- **Idle groups:** the sync service deletes groups no device has pushed to for
  `SYNC_IDLE_EXPIRY_DAYS` days, when set (see Decisions).
- **Journal times:** the playback journal carries when the place last moved, not when it was
  written, so a stale place loaded on one device never outranks a newer one from another.

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

First-party add-ons: Catalog (Open Library, Audnexus, Podcast Index), LibriVox, Internet Archive
(old-time radio, lectures and readings that are public domain or Creative Commons; added by its
manifest URL, not by default), and the Hardcover and gPodder scrobblers. RSS, local files and the
user's own storage (WebDAV, S3, Jellyfin, Audiobookshelf) are built into the app; see Decisions.

## Infrastructure

| Host                | What                                  | Runs on            |
| ------------------- | ------------------------------------- | ------------------ |
| `lelap.app`         | Landing page, `/docs`, terms, privacy | Pages              |
| `listen.lelap.app`  | The PWA                               | Pages              |
| `dl.lelap.app`      | APKs, `latest.json`, OTA bundles      | R2                 |
| `updates.lelap.app` | expo-updates manifests                | Worker + R2        |
| `catalog.lelap.app` | Catalog add-on                        | Worker + Cache API |
| `proxy.lelap.app`   | RSS, covers, transcripts; never audio | Worker + Cache API |
| `sync.lelap.app`    | Encrypted blobs and oplogs            | Worker + D1        |

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
- No list, store or recommendations of third-party add-ons. Anyone can host an add-on that speaks
  the protocol and share its manifest URL; Lelap never needs to know about it.
- No audio through Lelap infrastructure.
- Moderate project channels; remove requests for and links to pirated content.
