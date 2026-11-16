# Roadmap

Milestones in the order we build them, with what each one needs. Update the status line when a
milestone starts or finishes. Scope and architecture live in [`brief.md`](brief.md).

| Milestone                  | Status      |
| -------------------------- | ----------- |
| M0 Claim the name          | Done        |
| M1 Audio spike             | In progress |
| M2 Local library           | In progress |
| M3 Add-on protocol and SDK | In progress |
| M4 Downloads               | In progress |
| M5 Podcasts                | In progress |
| M6 Web build               | In progress |
| M7 Sync                    | Not started |
| M8 Release pipeline        | Not started |
| M9 Profiles (v1.1)         | Not started |

v1.0 is M1 to M8 together; the feature list is in [the brief](brief.md#v10-scope). M9 follows in
v1.1.

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

**Status:** in progress. The riskiest requirement, so it comes before any UI. Test checklist and
results: [`modules/audio/README.md`](../modules/audio/README.md).

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

**Status:** in progress. Design: [`superpowers/specs/2026-11-16-m2-local-library-design.md`](superpowers/specs/2026-11-16-m2-local-library-design.md). Built in PRs #8–#10; open checks and follow-ups: [`m2-follow-ups.md`](m2-follow-ups.md).

SQLite schema through Drizzle, import of local files and folders, chapters from tags, progress,
bookmarks, and the Library and Player screens.

**Done when** you listen to your own files for a week in airplane mode without losing your place.

**Prepares M9:** every user-specific table (library entries, progress, bookmarks, playlists, tags,
Up Next, settings) has a `profile_id` from the first schema, with a single default profile. Adding
it later means migrating every table and the sync format.

## M3 Add-on protocol and SDK

**Status:** in progress. Design:
[`superpowers/specs/2026-11-16-m3-addon-protocol-design.md`](superpowers/specs/2026-11-16-m3-addon-protocol-design.md).
Built in PR #12; open checks and follow-ups: [`m3-follow-ups.md`](m3-follow-ups.md).

The protocol spec and SDK docs (served from `lelap.app/docs`), the TypeScript SDK in `packages/sdk`,
a Workers template, the Catalog and LibriVox add-ons, and the Home, Discover and Search screens.

**Done when** you can find a LibriVox book in the app and play it.

**Cloudflare:** Worker `lelap-catalog` on `catalog.lelap.app`, with the Podcast Index key and secret
as Worker secrets. Register the Podcast Index API key before starting.

## M4 Downloads

**Status:** in progress. Design:
[`superpowers/specs/2026-11-16-m4-downloads-design.md`](superpowers/specs/2026-11-16-m4-downloads-design.md).
Built and unit-tested without a phone; the device checklist is in
[`apps/app/README.md`](../apps/app/README.md#m4-device-checklist).

Background download service with Wi-Fi and charging rules, cover and metadata snapshots, and a
storage overview.

**Done when** a book downloads overnight with the screen off and plays in airplane mode.

## M5 Podcasts

**Status:** in progress. Design:
[`superpowers/specs/2026-11-16-m5-podcasts-design.md`](superpowers/specs/2026-11-16-m5-podcasts-design.md).
Built and unit-tested without a phone; the device checklist is in
[`apps/app/README.md`](../apps/app/README.md#m5-device-checklist).

RSS subscriptions, OPML import and export, auto-download rules per podcast, and the Up Next queue.

**Done when** the maintainer's own podcast subscriptions have moved over.

## M6 Web build

**Status:** in progress. Design notes in [the brief](brief.md#web-build-m6). Streaming, saved
places across reloads and a podcast through the local proxy work in a desktop browser (Chrome,
`expo start --web`). Still to do: create the Pages project and the proxy's domain, then check
the deployed app at `listen.lelap.app` (see the checklist in
[`apps/app/README.md`](../apps/app/README.md#m6-web-checklist)).

react-native-web build, OPFS storage, the web audio adapter, and the feed and cover proxy.

**Done when** the same library plays in a desktop browser at `listen.lelap.app`.

**Cloudflare:** Pages project `lelap-web` on `listen.lelap.app`; Worker `lelap-proxy` on
`proxy.lelap.app` with a rate limiting rule (the free plan includes one).

## M7 Sync

Pairing code, encrypted oplog, and the “continue on another device” prompt.

**Done when** you switch between phone and laptop in the middle of a chapter.

**Cloudflare:** D1 database `lelap-sync` and Worker `lelap-sync` on `sync.lelap.app`. This is the
first service with user data, so it introduces the staging environment (see Environments).

**Prepares M9:** a sync group is a household. Its encrypted data carries profiles, and each device
remembers its active profile locally.

## M8 Release pipeline

Release workflow on `v*` tags: signed APK, upload to R2 and GitHub Releases, `latest.json`, signed
OTA bundles, multi-arch Docker images on `ghcr.io/lelap-app`, build provenance. In-app updater and
the beta channel.

**Done when** someone installs Lelap from `lelap.app` and receives an update without help.

**Cloudflare:** R2 bucket `lelap-downloads`, public on `dl.lelap.app`; Worker `lelap-updates` on
`updates.lelap.app`. R2 needs a payment method on the account even within the free tier. Create a
separate API token for Workers, D1 and R2 instead of widening the Pages token.

## M9 Profiles (v1.1)

Netflix-style profiles inside one household, with no accounts.

- **Picker:** “Who's listening?” on launch, shown only when there is more than one profile. The
  lock screen, notification and Android Auto follow the active profile.
- **Per profile:** progress, library state, playlists, tags, Up Next, speed per book, sleep timer
  settings, and scrobble add-ons.
- **Shared:** downloaded files (stored once) and catalog and source add-ons, unless a profile
  hides some.
- **PIN:** optional four-digit PIN, stored as a hash. It keeps others from opening a profile on this
  device; it does not encrypt anything, and the UI says so.
- **Avatars:** about 20 bundled SVG illustrations in Lelap's style (a night theme: owl, fox, moon,
  lantern, whale and so on, on amber, teal, rose and navy tiles). New profiles get a random unused
  one; tap to change. Fallback: a name-derived colour tile with the initial. Draw or commission
  them, so the licence is clean.
- **Kids profile:** a profile with restrictions: no add-on installs and a limited set of catalogs.

**Done when** two people in one household listen on the same phone and on their own devices,
each with their own progress, without signing in anywhere.

**Needs:** M2's `profile_id` columns and M7's household sync groups.

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
