# Lelap

**From first chapter to fast asleep.**

Lelap is an open-source player for audiobooks and podcasts. The app plays, downloads, remembers
your place and syncs it; add-ons bring the catalogs, metadata and audio sources. It runs on Android
and on the web from one codebase, and every server piece can be self-hosted with Docker.

> **Status:** early development. There is nothing to install yet. The landing page lives in
> [`apps/site`](apps/site); the plan is in [`docs/brief.md`](docs/brief.md) and progress in
> [`docs/roadmap.md`](docs/roadmap.md).

## What it will do

- Play audiobooks and podcasts in the background, with the screen off and through calls.
- Download for offline listening, and work fully in airplane mode.
- Remember speed per book, rewind smartly after pauses, and fade out with **Lull**, the sleep timer.
- Organise with tags, playlists, smart lists and one Up Next queue.
- Sync progress between devices with a pairing code. No account, end-to-end encrypted.
- Get content from add-ons: LibriVox, Open Library, Podcast Index, RSS feeds, your own files, your
  own WebDAV server, or add-ons you write yourself.

## Repository layout

| Path            | What                                              | Status  |
| --------------- | ------------------------------------------------- | ------- |
| `apps/site`     | Landing page for lelap.app (Astro, static)        | Started |
| `apps/app`      | The app: Expo for Android and the web             | Planned |
| `packages/core` | Domain model, add-on client, sync, ID graph       | Planned |
| `packages/sdk`  | Add-on SDK and protocol types, published to npm   | Planned |
| `services/*`    | Catalog, proxy, sync and update services (Hono)   | Planned |
| `modules/*`     | Native Android modules: audio, downloads, casting | Planned |
| `docs/`         | Project brief and, later, the add-on protocol     | Started |

## Getting started

You need Node 24 (see `.nvmrc`) and pnpm through Corepack.

```bash
corepack enable
pnpm install
pnpm dev:site
```

The site runs on http://localhost:4321.

Useful commands from the root:

| Command         | What it does                        |
| --------------- | ----------------------------------- |
| `pnpm dev:site` | Start the landing page locally      |
| `pnpm build`    | Build every package                 |
| `pnpm check`    | Type-check every package            |
| `pnpm lint`     | Lint with ESLint                    |
| `pnpm format`   | Format the repository with Prettier |

A pre-commit hook runs ESLint and Prettier on staged files. It is installed by `pnpm install`.

## Deployment

The landing page deploys to Cloudflare Pages from GitHub Actions on every push to `main` that
touches it. See [`apps/site/README.md`](apps/site/README.md) for the one-time setup.

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
The add-on SDK will be published under MIT, so anyone can build add-ons with it.
