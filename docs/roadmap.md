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
| M7 Sync                    | In progress |
| M8 Release pipeline        | In progress |
| M9 Profiles (v1.1)         | In progress |
| M10 Your own storage       | In progress |
| M11 Background engine      | In progress |
| M12 Look and feel          | In progress |
| M13 Landing page 2         | In progress |
| M14 Developer platform     | In progress |
| M15 Find any book          | In progress |
| M17 Car and offline web    | In progress |
| M18 Updates over the air   | In progress |
| M19 Security and hardening | In progress |
| M20 SDK on npm             | In progress |
| M32 Audnexus               | In progress |

v1.0 is M1 to M8 together; the feature list is in [the brief](brief.md#v10-scope). M9 follows in
v1.1. What comes next (v1.0 gaps, proposed M10–M19, smaller tasks): [`next.md`](next.md).

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
Built in PR #14; open checks and follow-ups: [`m4-follow-ups.md`](m4-follow-ups.md).

Background download service with Wi-Fi and charging rules, cover and metadata snapshots, and a
storage overview.

**Done when** a book downloads overnight with the screen off and plays in airplane mode.

## M5 Podcasts

**Status:** in progress. Design:
[`superpowers/specs/2026-11-16-m5-podcasts-design.md`](superpowers/specs/2026-11-16-m5-podcasts-design.md).
Built in PR #15; open checks and follow-ups: [`m5-follow-ups.md`](m5-follow-ups.md).

RSS subscriptions, OPML import and export, auto-download rules per podcast, and the Up Next queue.

**Done when** the maintainer's own podcast subscriptions have moved over.

## M6 Web build

**Status:** in progress. Design notes in [the brief](brief.md#web-build-m6). Built in PR #16;
setup, open checks and follow-ups: [`m6-follow-ups.md`](m6-follow-ups.md).

react-native-web build, OPFS storage, the web audio adapter, and the feed and cover proxy.

**Done when** the same library plays in a desktop browser at `listen.lelap.app`.

**Cloudflare:** Pages project `lelap-web` on `listen.lelap.app`; Worker `lelap-proxy` on
`proxy.lelap.app` with a rate limiting rule (the free plan includes one).

## M7 Sync

**Status:** in progress. Design notes in [the brief](brief.md#sync-m7). Open checks and setup:
[`m7-follow-ups.md`](m7-follow-ups.md).

Pairing code, encrypted oplog, and the “continue on another device” prompt.

**Done when** you switch between phone and laptop in the middle of a chapter.

**Cloudflare:** D1 database `lelap-sync` and Worker `lelap-sync` on `sync.lelap.app`. This is the
first service with user data, so it introduces the staging environment (see Environments).

**Prepares M9:** a sync group is a household. Its encrypted data carries profiles, and each device
remembers its active profile locally.

## M8 Release pipeline

**Status:** in progress. Built without a release run; setup, open checks and what is left
(OTA bundles): [`m8-follow-ups.md`](m8-follow-ups.md).

Release workflow on `v*` tags: signed APK, upload to R2 and GitHub Releases, `latest.json`, signed
OTA bundles, multi-arch Docker images on `ghcr.io/lelap-app`, build provenance. In-app updater and
the beta channel.

**Done when** someone installs Lelap from `lelap.app` and receives an update without help.

**Cloudflare:** R2 bucket `lelap-downloads`, public on `dl.lelap.app`; Worker `lelap-updates` on
`updates.lelap.app`. R2 needs a payment method on the account even within the free tier. Create a
separate API token for Workers, D1 and R2 instead of widening the Pages token.

## M9 Profiles (v1.1)

**Status:** in progress. Open checks and follow-ups: [`m9-follow-ups.md`](m9-follow-ups.md).

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

## M10 Your own storage

**Status:** in progress (from [`next.md`](next.md#m10-your-own-storage)). WebDAV servers and
S3-compatible buckets are library roots next to the phone's folder, built into the app; open
checks and what is left: [`m10-follow-ups.md`](m10-follow-ups.md).

**Done when** a Nextcloud folder of audiobooks plays on the phone, downloads, and keeps its place.

## M11 Background engine

**Status:** in progress (from [`next.md`](next.md#proposed-milestones)). Up Next hands over in the
playback service with the app closed; feeds, auto-downloads and sync run in the background about
once an hour. Phone checks are in [`apps/app/README.md`](../apps/app/README.md#m11-checks).

**Done when** a queued episode starts after the previous one with the phone locked and the app
swiped away, and a new episode of an auto-download podcast is on the phone the next morning.

## M12 Look and feel

**Status:** in progress (from [`next.md`](next.md#proposed-milestones)). One SVG icon set
(`apps/app/src/components/Icon.tsx`) replaces the text glyphs; the Player follows the design
sketch (skip-30 icons, bookmark button by the title, book progress under the scrubber, a tool row
for speed, sleep, chapters and bookmarks). Home shows the add-on count and a “Ready for offline”
card, Search says how many add-ons answered, Library shows a banner when offline. Alerts go
through `showAlert`, which draws an in-app dialog on the web. Covers fade in, the mini player
slides up, the play button gives under the finger; nothing moves with reduced motion. Phone checks
are in [`m12-follow-ups.md`](m12-follow-ups.md).

**Done when** every screen matches the sketch's look on a phone and on the web.

## M13 Landing page 2

**Status:** in progress (from [`next.md`](next.md#proposed-milestones)). The site's “Get it”
section lists the Android channels (direct APK from the downloads host, GitHub Releases,
Obtainium, F-Droid later) with a SHA-256 note, all in a “coming with v1.0” state until
`PUBLIC_LELAP_RELEASED` is set. Sections fade in on scroll through a small inline script; without
JavaScript or with reduced motion nothing moves and nothing is hidden. Stable releases also upload
`latest.apk` so the site's download button has a fixed address.

**Done when** the released build's download buttons fetch the current APK on a phone, and the page
reads well on a phone and a desktop with and without reduced motion.

## M14 Developer platform

**Status:** in progress (from [`next.md`](next.md#m14-developer-platform)). `lelap.app/docs` is a
developer section: overview, protocol reference, data model samples, SDK guide, samples, hosting
and a manifest builder that checks manifests in the browser. Samples in Hono
([`services/template`](../services/template)), plain Node and Python, and an add-on with
hard-coded seasonal catalogs, are in [`examples/`](../examples) and tested in CI.

**Done when** someone outside the project builds an add-on from the docs alone and adds it in the
app. Not yet checked: the samples' Dockerfiles have not been built, and none of the samples has
been added to the app on a phone.

## M15 Find any book

**Status:** in progress (from [`next.md`](next.md#m15-find-any-book)). The item page asks every
add-on with a `stream` resource for the work, by its own ID or one of its `externalIds`, lists each
source with its add-on, length and parts, and remembers the choice per book and profile. A work
without audio gets a page of its own with description, tags and a link to its source. Device
checks in [`m15-follow-ups.md`](m15-follow-ups.md).

**Done when** the device checks pass.

## M17 Car and offline web

**Status:** in progress (from [`next.md`](next.md#proposed-milestones)). Android Auto browses
Continue listening, On this phone, Podcasts and Up Next from a snapshot the app hands the playback
service, so the car works with the app closed. A service worker keeps the web app's shell so
`listen.` starts offline. Car and phone checks in [`m17-follow-ups.md`](m17-follow-ups.md).

**Done when** the car checks pass on a head unit or the Desktop Head Unit.

## M18 Updates over the air

**Status:** in progress (from [`next.md`](next.md#proposed-milestones)). `expo-updates` with code
signing and a fingerprint runtime version, the `lelap-updates` Worker (and a Docker image) serving
the Expo Updates protocol from R2, and a release job that signs and uploads each tag's bundle to
the `production` or `beta` channel. Setup and phone checks: [`m18-follow-ups.md`](m18-follow-ups.md).

**Done when** a JavaScript-only release reaches a phone over the air on both channels and a badly
signed manifest is refused. Not yet checked: none of it has run on a phone.

## M19 Security and hardening

**Status:** in progress (from [`next.md`](next.md#proposed-milestones)). The audit, its fixes and
the decisions left for the maintainer are in [`security-audit.md`](security-audit.md); phone and
dashboard checks in [`m19-follow-ups.md`](m19-follow-ups.md).

**Done when** the audit's decisions are made and its follow-up checks pass.

## M20 SDK on npm

**Status:** in progress (from [`next.md`](next.md#m20-sdk-on-npm)). `@lelap/sdk` builds to ESM and
type declarations with `tsc`, Changesets versions it, and the `SDK` workflow publishes it with
provenance from the `npm` environment. How to release: [`packages/sdk`](../packages/sdk/README.md#releasing).
The samples' docs install it from npm. What the maintainer sets up on npm and GitHub:
[`m20-follow-ups.md`](m20-follow-ups.md).

**Done when** `npm install @lelap/sdk` gets a published version with a provenance statement, and a
copy of `services/template` outside the repository builds against it.

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
