# Lelap

**From first chapter to fast asleep.**

Lelap is an open-source player for audiobooks and podcasts. The app plays, downloads, remembers
your place and syncs it; add-ons bring the catalogs, metadata and audio sources. It runs on Android
and on the web from one codebase, and every server piece can be self-hosted with Docker.

> **Status:** beta. The Android beta is on
> [GitHub Releases](https://github.com/lelap-app/lelap/releases) and updates itself; the first
> stable version follows a round of testing on phones. Decisions and architecture are in
> [`docs/brief.md`](docs/brief.md), progress in [`docs/roadmap.md`](docs/roadmap.md).

## What it does

- Plays audiobooks and podcasts in the background, with the screen off and through calls.
- Downloads for offline listening, and works fully in airplane mode.
- Remembers speed per book, rewinds smartly after pauses, and fades out with the sleep timer.
- Organises with tags, playlists, smart lists and one Up Next queue.
- Syncs progress between devices with a pairing code. No account, end-to-end encrypted.
- Plays from your own files and folders, your own WebDAV, S3-compatible, Jellyfin or
  Audiobookshelf server, and add-ons: LibriVox, Open Library, Podcast Index, RSS feeds, or add-ons you write yourself.
- Finds chapters at the long silences of a book without any (Android), and skips a podcast's
  intro and outro.
- Casts to Sonos, DLNA, Google Cast and FCast speakers without Google's SDK, with the lock screen,
  headphones and sleep timer controlling the speaker; works in Android Auto.
- Works with TalkBack and at the largest text size, and uses the width of tablets and laptops.
- Profiles for a household, and the app in English and Bahasa Melayu.

## Repository layout

| Path            | What                                                         |
| --------------- | ------------------------------------------------------------ |
| `apps/app`      | The app: Expo for Android and the web                        |
| `apps/site`     | Landing page and add-on docs for lelap.app (Astro, static)   |
| `packages/core` | Domain model, library, add-on client, sync                   |
| `packages/sdk`  | Add-on SDK and protocol types, on npm as `@lelap/sdk`        |
| `services/*`    | Catalog, proxy, sync and update services (Hono)              |
| `modules/*`     | Native Android modules: audio, library, downloads, casting … |
| `docker/`       | Images and compose file for self-hosting                     |
| `docs/`         | Brief, roadmap, one file per milestone, test lists           |

## Getting started

You need Node 24 (see `.nvmrc`) and pnpm through Corepack.

```bash
corepack enable
pnpm install
pnpm dev:app
```

`pnpm dev:app` starts the app's dev server; press `w` for the web app. For the Android app on a
phone, see [`apps/app/README.md`](apps/app/README.md).

Useful commands from the root:

| Command         | What it does                              |
| --------------- | ----------------------------------------- |
| `pnpm dev:app`  | Start the app's dev server                |
| `pnpm android`  | Build and run the app on a phone over USB |
| `pnpm dev:site` | Start the landing page on localhost:4321  |
| `pnpm build`    | Build every package                       |
| `pnpm check`    | Type-check every package                  |
| `pnpm test`     | Run every package's tests                 |
| `pnpm lint`     | Lint with ESLint                          |
| `pnpm format`   | Format the repository with Prettier       |

A pre-commit hook runs ESLint and Prettier on staged files. It is installed by `pnpm install`.

## Deployment

GitHub Actions deploys from `main`: the landing page and the web app to Cloudflare Pages, and the
catalog, proxy and updates services to Cloudflare Workers (sync to staging). A `v*` tag builds the
signed APKs, publishes them to GitHub Releases and the downloads host with an over-the-air bundle
and the Docker images, and deploys sync to production. Setup is in
[`apps/site/README.md`](apps/site/README.md) and [`services/README.md`](services/README.md);
self-hosting with Docker in [`docker/README.md`](docker/README.md).

## Contributing

Issues and pull requests are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md); the rules in
[`AGENTS.md`](AGENTS.md) apply to people as much as to coding agents. Report security issues as
described in [`SECURITY.md`](SECURITY.md).

Lelap only ships add-ons for open sources and for storage you control. We don't accept code,
add-ons, docs or examples aimed at finding or resolving pirated content, and we don't list
third-party add-ons.

## Rights holders

Lelap doesn't host, index or link to audio. To report copyright infringement on our sites, in this
repository or in one of our own add-ons, write to **copyright@lelap.app**.

## License

[GNU AGPL-3.0](LICENSE). If you run a modified Lelap service for others, you share your changes.
The add-on SDK, [`@lelap/sdk`](packages/sdk), is MIT, so anyone can build add-ons with it.
