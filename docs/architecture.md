# Architecture

How Lelap fits together, on one page. Why things are this way is in [`brief.md`](brief.md); what
each milestone added is in [`milestones/`](milestones/).

## The big picture

Kept apart on purpose: the device, which does the work and holds the data;
services anyone can run, which only answer questions; and the sources audio comes from, reached
directly.

<img src="images/architecture-overview.svg" alt="The device does the work and keeps the data; add-ons and Lelap services answer questions; audio comes straight from open sources or your own storage, never through Lelap's services." width="100%">

- **The app does the work.** It plays, downloads, keeps the library and runs the logic on the
  device. Nothing needs an account.
- **Add-ons bring content.** Stateless HTTP services returning JSON ([protocol](../apps/site/src/pages/docs/protocol.astro),
  [SDK](../packages/sdk)); in-app add-ons run the same routes in a sandbox
  ([M38](milestones/m38.md)). The app stores only their URLs.
- **The user's own storage is built in, not an add-on:** local folders, WebDAV, S3, Jellyfin, Audiobookshelf.
  Logins stay sealed on the phone (see the decision in the brief).
- **Audio never touches our servers.** Services proxy feeds, covers, chapters and transcripts for
  the web app, which browsers can't fetch across origins; never audio.

## Where code lives

| Folder              | What                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/app`          | Expo app for Android and web: `app/` screens (Expo Router), `src/` hooks and platform glue               |
| `apps/site`         | Landing page and developer docs (Astro, static)                                                          |
| `packages/core`     | Domain model, Drizzle schema and migrations, library, add-on client, sync, stats, seek                   |
| `packages/sdk`      | Add-on protocol as zod schemas, `createAddon()`; MIT, on npm                                             |
| `modules/audio`     | Media3 playback service: queue of parts, speed, focus, sleep timer, sound effects                        |
| `modules/library`   | Folder access, tags and chapters for local files                                                         |
| `modules/download`  | WorkManager downloads with Wi-Fi and charging rules                                                      |
| `modules/cast`      | UPnP, an own Cast v2 client, FCast, and a LAN file server                                                |
| `modules/updater`   | In-app APK updates through PackageInstaller                                                              |
| `modules/widget`    | Home screen widget and Quick Settings tile                                                               |
| `modules/bluetooth` | Connected audio devices, their battery, car detection                                                    |
| `services/*`        | Hono services: `catalog` (Catalog, LibriVox, Hardcover, gPodder), `proxy`, `sync`, `updates`, `template` |
| `docker/`           | Node entries, Dockerfiles and compose for self-hosting                                                   |
| `examples/`         | Add-on samples in Node, Python and in-app JavaScript; tested in CI                                       |
| `scripts/`          | Release helpers for the tag workflow                                                                     |

### Layers inside the app

Each layer only talks to the one below it, so the same screens and logic run on Android and in the
browser, and native code stays behind small APIs.

<img src="images/architecture-layers.svg" alt="Layers inside the app: screens, app glue, core with the SDK beside it, platform adapters, then Android's Kotlin modules and the web's browser APIs." width="100%">

Platform differences live in sibling files: `foo.ts` for Android, `foo.web.ts` for the web.
Native modules have a JavaScript API in `modules/<name>/src`; the app reaches them through
`apps/app/src/platform/`.

## Data

- **One SQLite database per device**, schema in `packages/core/src/schema.ts`, migrations generated
  by `drizzle-kit` (never written by hand). Most tables are per profile.
- **Secrets** (server passwords, the sync key) are sealed with a key from the Android Keystore
  (`expo-secure-store`) and left out of backups.
- **Sync** pushes changed rows as operations sealed with XChaCha20-Poly1305; the server stores a
  group's log under a random ID and never sees the key. Details: [brief](brief.md#sync).
- **Downloads** are files in the app's storage, tracked in the database; the queue runs in
  WorkManager so it survives the app closing.

### What leaves the device

- **Sync** gets your library sealed with a key only your devices have; the server stores
  ciphertext.
- **Add-ons** get an ID or a search, never the library.
- **Scrobble add-ons** get listening events, only if you add one.
- **Logins and the sync key** never leave the device.

## Hosts

| Host                | What                                        | Runs on            |
| ------------------- | ------------------------------------------- | ------------------ |
| `lelap.app`         | Landing page and `/docs`                    | Cloudflare Pages   |
| `listen.lelap.app`  | The web app (PWA)                           | Cloudflare Pages   |
| `dl.lelap.app`      | APKs, `latest.json`, `beta.json`, OTA files | R2                 |
| `updates.lelap.app` | Over-the-air update manifests               | Worker + R2        |
| `catalog.lelap.app` | First-party add-ons                         | Worker + Cache API |
| `proxy.lelap.app`   | Feeds, covers, transcripts for the web app  | Worker + Cache API |
| `sync.lelap.app`    | Encrypted sync logs                         | Worker + D1        |

Every host comes from configuration (`LELAP_DOMAIN`), so a fork or a self-hoster changes no
source. The same services run in Docker (`ghcr.io/lelap-app/*`) with SQLite and disk instead of
D1 and R2.

## Pipelines

| Workflow       | When                                      | What                                                                                       |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ci.yml`       | Every pull request and push to `main`     | Format, lint, type-check, test, build; Kotlin unit tests when native code changes          |
| `site.yml`     | Push to `main` touching the site          | Builds and deploys `lelap.app`; variables `LELAP_BETA` and `LELAP_RELEASED` pick its state |
| `web.yml`      | Push to `main` touching the app           | Builds and deploys `listen.lelap.app`                                                      |
| `services.yml` | Push to `main` touching services          | Deploys the Workers; sync goes to staging                                                  |
| `sdk.yml`      | Push to `main` changing the SDK's version | Publishes `@lelap/sdk` to npm with provenance (environment `npm`)                          |
| `release.yml`  | Tag `v*`                                  | See below                                                                                  |

A release tag (`v1.2.3`, or `v1.2.3-beta.4` for a beta):

<img src="images/release-pipeline.svg" alt="A version tag runs the checks and builds unsigned APKs, waits for a maintainer to approve, signs the direct and F-Droid APKs in parallel, then publishes them, the over-the-air bundle and the Docker images." width="100%">

1. **Verify:** stamps the version into `app.json`, runs every check.
2. **Build:** four unsigned APKs in parallel, direct and F-Droid (no self-updates,
   reproducible), each for `arm64-v8a` and `armeabi-v7a` with its own versionCode. No secrets,
   so this job may read the pnpm and Gradle caches that runs on `main` saved
   (`.github/actions/unsigned-apk`) and nothing else writes. A pull request's or a tag's own
   caches are invisible to other runs.
3. **Approval:** jobs in the `release` environment wait for a maintainer; it holds the signing
   keys and only tags can use it.
4. **Sign:** the direct and the F-Droid APKs in parallel. Each APK's SHA-256 must match what the
   build job reported; `zipalign` checks the alignment, `apksigner` signs
   (`scripts/sign-apks.sh`), and each APK is attested. Signing only adds the signature block, so
   F-Droid's rebuild still matches.
5. **Publish:** APKs to R2 (`beta.apk`, and `latest.apk` for stable, each with an `-armv7`
   sibling) and a GitHub release with all four APKs and `SHA256SUMS`; `beta.json` or
   `latest.json` goes last, so it never points at a missing file.
6. **Over the air:** the JavaScript bundle for this native build, signed, for the `beta` (and
   `production`) channel.
7. **Images:** five multi-arch images on `ghcr.io`.
8. **Sync to production:** stable tags only.

Jobs that hold secrets use no caches and install no packages for the APKs; only the build job,
which holds none, reads caches ([M54](milestones/m54.md)). The SHA-256 check between build and
signing only proves the file was not swapped on the way: what keeps a poisoned cache out is that
only `main` writes the caches the build reads.

`beta.json` and `latest.json` list one APK per CPU type under `apks`; the top-level `url`,
`sha256`, `size` and `versionCode` are the arm64 APK's, which is all that apps from before M54
read. The updater takes the first of `Build.SUPPORTED_ABIS` the release has an APK for.

## How a change reaches people

- **JavaScript only:** merged to `main`, the web app has it within minutes; Android gets it with
  the next tag as an over-the-air update, applied on the next start.
- **Native code:** a new APK; the app's updater offers it from `latest.json` or `beta.json`.
- **Add-ons:** deploy on their own schedule; the app refreshes manifests on start.
