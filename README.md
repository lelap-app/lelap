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

- Plays audiobooks and podcasts in the background, with the screen off. On Android a call pauses
  it or lowers the volume to a level you choose.
- Downloads for offline listening, and works fully in airplane mode.
- Remembers speed per book, rewinds smartly after pauses, and fades out with the sleep timer. On
  Android a bedtime routine can turn the volume down, and after the timer the player offers to go
  back to when you last used it.
- Boosts voices, skips silence (showing the time saved) and keeps loudness even, per book or per
  show. In the browser, skip silence works on constant-bitrate MP3 files such as LibriVox's, and on M4B, Opus, Ogg and FLAC files.
- Opens the library in three groups: in progress, not started and finished.
- Shows your listening: time today, this week and this year, streaks, finished books and a year
  in sound to share as an image.
- Organises with tags, playlists, smart lists and one Up Next queue, and plays a list from start
  to end. Hides what you don't want in the library, and points out files that look like music.
- Lists each series in reading order, with the numbers you're missing and the next book at the end
  of one.
- Rates books in half stars, and marks new podcast episodes.
- Plays a show's smallest file on mobile data when its feed offers several, and on Android checks
  a download against the hash the feed gives.
- Syncs progress between devices with a pairing code. No account, end-to-end encrypted.
- Plays from your own files and folders; your own WebDAV, S3-compatible, Jellyfin, Emby, Plex,
  Navidrome (or other Subsonic) or Audiobookshelf server; an OPDS catalog such as Calibre's
  content server; SMB and SFTP shares on Android; and
  add-ons: LibriVox, Open Library, Podcast Index, RSS feeds, the Internet Archive, or add-ons you
  write yourself.
- Takes covers from the tags or from an image beside the audio, such as `cover.jpg`.
- Shows Hardcover's trending books and your Hardcover lists as catalog rows, once you sign in to
  Hardcover or paste your own token, and keeps your Hardcover shelves and ratings and a gPodder
  server up to date as you listen. Both are offered in Settings → Add-ons.
- Downloads to an SD card if you like (Android), and lists your own copy first on a book's
  catalog page.
- Finds chapters at the long silences of a book without any (Android), and skips a podcast's
  intro and outro. You can edit any book's chapters.
- Shares a place, a bookmark or the last 30 seconds as a link; whoever opens it plays their own
  copy. Shows a podcast's chapter pictures and soundbites.
- Casts to Sonos, DLNA, Google Cast and FCast speakers without Google's SDK, to one speaker or
  several at once, with the lock screen, headphones and sleep timer controlling them.
- Has a car mode with a large cover and big buttons, upright or sideways in a holder, and works in
  Android Auto with the covers on your phone.
- Comes in five themes (Night, Dusk, Day, Sepia and High contrast) with six accent colours, or
  follows the phone's light or dark setting.
- Works with TalkBack and at the largest text size, and uses the width of tablets, foldables and laptops.
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
signed APKs, publishes them to GitHub Releases and the downloads host with an over-the-air bundle,
an SBOM and the Docker images, and deploys sync to production. Setup is in
[`apps/site/README.md`](apps/site/README.md) and [`services/README.md`](services/README.md);
self-hosting with Docker in [`docker/README.md`](docker/README.md).

## Contributing

Issues and pull requests are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md); the rules in
[`AGENTS.md`](AGENTS.md) apply to people as much as to coding agents. Report security issues as
described in [`SECURITY.md`](SECURITY.md).

Lelap only ships add-ons for open sources and for storage you control; they may also read
metadata, such as covers and descriptions, from official public APIs, with credit, never audio. We
don't accept code, add-ons, docs or examples aimed at finding or resolving pirated content, and we
don't list third-party add-ons.

## Rights holders

Lelap doesn't host, index or link to audio. To report copyright infringement on our sites, in this
repository or in one of our own add-ons, write to **copyright@lelap.app**.

## License

[GNU AGPL-3.0](LICENSE). If you run a modified Lelap service for others, you share your changes.
The add-on SDK, [`@lelap/sdk`](packages/sdk), is MIT, so anyone can build add-ons with it.
