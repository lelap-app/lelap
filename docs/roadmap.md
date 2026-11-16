# Roadmap

Milestones in the order we build them, with what each one needs. Update the status line when a
milestone starts or finishes. Scope and architecture live in [`brief.md`](brief.md).

| Milestone                  | Status      |
| -------------------------- | ----------- |
| M0 Claim the name          | Done        |
| M1 Audio spike             | Next        |
| M2 Local library           | Not started |
| M3 Add-on protocol and SDK | Not started |
| M4 Downloads               | Not started |
| M5 Podcasts                | Not started |
| M6 Web build               | Not started |
| M7 Sync                    | Not started |
| M8 Release pipeline        | Not started |

v1.0 is M1 to M8 together; the feature list is in [the brief](brief.md#v10-scope).

## M0 Claim the name

**Status:** done.

- Domain `lelap.app` on Cloudflare with DNSSEC.
- Email Routing: `copyright@lelap.app` and `privacy@lelap.app` forward to the maintainer. SPF from
  Email Routing, DMARC `p=reject` with Cloudflare reporting.
- GitHub organisation `lelap-app`, public repository `lelap`: ruleset on `main` (pull requests,
  green CI, no force pushes), ruleset on `v*` tags (admins only), environments `web` (main only)
  and `release` (tags only, required reviewer), secret scanning, Dependabot, private vulnerability
  reporting, read-only workflow token.
- Landing page deployed by GitHub Actions to the Pages project `lelap-site` on `lelap.app`;
  `www.lelap.app` redirects permanently to `lelap.app` with a zone Redirect Rule.

## M1 Audio spike

**Status:** next. The riskiest requirement, so it comes before any UI.

A bare Expo app (dev client) in `apps/app` with a Kotlin Expo module in `modules/audio` around a
Media3 `MediaLibraryService`.

**Done when**, on a real Android phone:

- a book made of about 30 mp3 parts plays gaplessly;
- playback continues with the screen off and the app closed, with lock screen and headphone
  controls;
- speed changes keep pitch;
- a phone call and a VoIP call duck the volume instead of pausing (as a setting);
- a sleep timer fades the player's own volume out over the last 60 seconds.

**Needs:** Android Studio with the SDK, an Android phone with USB debugging, and an hour of
public-domain audio split into several files (a LibriVox book works).

## M2 Local library

SQLite schema through Drizzle, import of local files and folders, chapters from tags, progress,
bookmarks, and the Library and Player screens.

**Done when** you listen to your own files for a week in airplane mode without losing your place.

## M3 Add-on protocol and SDK

The protocol spec and SDK docs (served from `lelap.app/docs`), the TypeScript SDK in `packages/sdk`,
a Workers template, the Catalog and LibriVox add-ons, and the Home, Discover and Search screens.

**Done when** you can find a LibriVox book in the app and play it.

**Cloudflare:** Worker `lelap-catalog` on `catalog.lelap.app`, with the Podcast Index key and secret
as Worker secrets. Register the Podcast Index API key before starting.

## M4 Downloads

Background download service with Wi-Fi and charging rules, cover and metadata snapshots, and a
storage overview.

**Done when** a book downloads overnight with the screen off and plays in airplane mode.

## M5 Podcasts

RSS subscriptions, OPML import and export, auto-download rules per podcast, and the Up Next queue.

**Done when** the maintainer's own podcast subscriptions have moved over.

## M6 Web build

react-native-web build, OPFS storage, the web audio adapter, and the feed and cover proxy.

**Done when** the same library plays in a desktop browser at `listen.lelap.app`.

**Cloudflare:** Pages project `lelap-web` on `listen.lelap.app`; Worker `lelap-proxy` on
`proxy.lelap.app` with a rate limiting rule (the free plan includes one).

## M7 Sync

Pairing code, encrypted oplog, and the “continue on another device” prompt.

**Done when** you switch between phone and laptop in the middle of a chapter.

**Cloudflare:** D1 database `lelap-sync` and Worker `lelap-sync` on `sync.lelap.app`. This is the
first service with user data, so it introduces the staging environment (see Environments).

## M8 Release pipeline

Release workflow on `v*` tags: signed APK, upload to R2 and GitHub Releases, `latest.json`, signed
OTA bundles, multi-arch Docker images on `ghcr.io/lelap-app`, build provenance. In-app updater and
the beta channel.

**Done when** someone installs Lelap from `lelap.app` and receives an update without help.

**Cloudflare:** R2 bucket `lelap-downloads`, public on `dl.lelap.app`; Worker `lelap-updates` on
`updates.lelap.app`. R2 needs a payment method on the account even within the free tier. Create a
separate API token for Workers, D1 and R2 instead of widening the Pages token.

## Environments

| Environment | When     | What                                                                                                                                                    |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev   | Now      | `pnpm dev:site`; `wrangler dev` simulates D1, R2 and KV offline.                                                                                        |
| Production  | Now      | Merges to `main` deploy the site (and later the PWA).                                                                                                   |
| PR previews | Optional | Pages branch deploys at `<branch>.lelap-site.pages.dev`; only for branches in this repository, since forks get no secrets.                              |
| Staging     | From M7  | A `staging` environment in each service's `wrangler.toml` with its own D1 and R2. Merges to `main` deploy services to staging, `v*` tags to production. |
| Beta        | From M8  | expo-updates `beta` channel and pre-release tags (`v1.2.0-beta.1`) publishing `beta.json`; testers opt in from the app's settings.                      |

## Before the first public release

- Check Google's developer verification requirements for sideloaded apps.
- Decide on F-Droid: a `foss` build flavor without the Google Cast SDK, and reproducible builds or
  F-Droid's own signing key.
- Review the terms and privacy pages.
- Publish the add-on SDK under MIT.
