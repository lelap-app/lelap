# M3 Add-on protocol and SDK: design

Status: approved approach, details are the builder's calls. Milestone:
[M3 in the roadmap](../../roadmap.md#m3-add-on-protocol-and-sdk).

## Intent

Lelap's catalogs and online sources come from add-ons: small stateless HTTP services that answer
JSON. M3 defines that protocol (v1), ships an SDK so anyone can write an add-on in a few lines,
runs the two first-party add-ons (Catalog and LibriVox) on one Cloudflare Worker, and gives the
app Home, Discover and Search screens that browse them.

**Done when** you can find a LibriVox book in the app and play it.

## Goals

- Protocol v1 as zod schemas in `@lelap/sdk`, the single source of truth for the SDK, the app's
  client and the published JSON Schema.
- `@lelap/sdk`: types, schemas and `createAddon()`, which turns handlers into a standard
  `fetch(request) => Response` handler (Workers, Node, Deno and Bun all accept it). CORS on
  every response.
- A Workers template in `services/template` that a third party copies to start an add-on.
- `services/catalog` (Worker `lelap-catalog`): the Catalog add-on at `/manifest.json` and the
  LibriVox add-on at `/librivox/manifest.json`, with the Cache API in front of upstream calls.
- In the app: add-ons stored in SQLite, the first-party ones installed on first start from
  configuration, others added by pasting a manifest URL; Home rows, Discover, merged Search, an
  item page and playback of streamed books.
- A streamed book joins the Library on Play (the maintainer's pick, option A) and keeps its place,
  bookmarks and speed exactly like a local book.
- Protocol and SDK docs at `lelap.app/docs`.

## Non-goals

- Downloads (M4); a streamed book needs the network. Podcasts in the app (M5): the Catalog add-on
  already answers podcast catalogs and meta from Podcast Index, but the app only shows the
  `audiobook` type until M5.
- `/scrobble`, add-on configuration pages beyond following `/configure` in the browser.
- Audnexus metadata (it needs ASINs, which no M3 source provides). It comes when a source does.
- The `/resolve/…` redirect-and-retry flow on 403/410: archive.org links do not expire. The
  protocol documents it; the player gains the retry when a source needs it.
- Docker images for the services (M8). The Worker code keeps platform calls behind small
  interfaces so the Node entry is a thin file later.
- `@cloudflare/vitest-pool-workers`: the services are tested with plain Vitest by injecting
  `fetch` and the cache.

## Anti-goals

- Audio through our servers. The Worker only answers JSON; stream URLs point to archive.org.
- Losing the place in a streamed book, or a rescan of the local folder touching streamed books.
- An add-on directory or recommendations of third-party add-ons.
- Hard-coded hosts: the app reads the default add-on URLs from configuration.

## Approaches

**What happens on Play** (the maintainer's pick): (A) the book joins the Library automatically,
tagged "Streaming", with its place kept; (B) an explicit "Add to Library"; (C) play without
saving. **Chosen: A.**

**Where LibriVox data comes from** (builder's call). The LibriVox API's title search only matches
from the start of the title (`title=^…`) and has no newest-first order. archive.org hosts every
LibriVox recording in the `librivoxaudio` collection, with full-text search, sorting, subjects
and per-file durations, and its item metadata carries the LibriVox project number
(`call_number`). **Chosen: archive.org's search and metadata APIs**, IDs `librivox:<archive
identifier>`.

**Where the add-ons run** (builder's call). The roadmap provisions one Worker. Both add-ons share
it: Catalog at the root, LibriVox under `/librivox/`. Each has its own manifest and ID, so they
could move to separate Workers without the app noticing.

## Protocol v1

All responses are JSON with `Access-Control-Allow-Origin: *`. `{extra}` is a URL-encoded query
string (`search=dune&skip=20`); without extras the path is `/catalog/{type}/{id}.json`.

```
GET /manifest.json
GET /catalog/{type}/{id}.json | /catalog/{type}/{id}/{extra}.json   → { metas: MetaPreview[] }
GET /meta/{type}/{id}.json                                          → { meta: Meta }
GET /stream/{type}/{id}.json                                        → { streams: Stream[] }
```

- **Manifest:** `id` (reverse DNS), `version` (semver), `protocol: 1`, `name`, `description`,
  `logo?`, `types`, `resources` (names, or `{ name, types?, idPrefixes? }`), `idPrefixes?`,
  `catalogs: { type, id, name, extra?: { name, isRequired?, options? }[] }[]`,
  `configurable?`. `search`, `genre` and `skip` are the extras the app understands.
- **Types:** `audiobook`, `podcast`, `episode`.
- **IDs:** `prefix:value`. The app only asks an add-on for `meta`/`stream` of IDs whose prefix it
  declares. Known prefixes: `ol:` (Open Library work, canonical for books), `librivox:`,
  `podcast:` (podcast GUID).
- **MetaPreview:** `id`, `type`, `name`, `author?`, `cover?`, `description?`, `year?`,
  `durationMs?`. **Meta** adds `narrators?`, `language?`, `genres?`, `chapters?`,
  `externalIds?` (record of prefix → value), `episodes?` (for podcasts), `link?`.
- **Stream:** `sourceKey` (stable for this source), `name`, `title?`, `mime?`, `bitrate?`,
  `size?`, `downloadable?`, and either `url` (+ `chapters?`) or `parts: { url, title?,
durationMs, size? }[]`. Times are milliseconds.
- `cacheMaxAge?` on any response, in seconds.

The SDK exports these as zod schemas and types, a `protocol.schema.json` generated with
`z.toJSONSchema` (instead of `@hono/zod-openapi`; `brief.md` is updated), and `createAddon()`
which validates handler output (on by default, `validate: false` turns it off) and returns 404
JSON for unknown routes.

## First-party add-ons

**LibriVox** (`app.lelap.librivox`, `/librivox/manifest.json`), type `audiobook`:

- Catalogs: "New on LibriVox" (sorted by `publicdate`), "Most listened" (by `downloads`), with
  `genre` (archive.org subjects such as `poetry`, `children`, `mystery`) and `skip`; search.
- Meta and stream for `librivox:` IDs from `archive.org/metadata/<id>`: parts are the
  `64Kbps MP3` files (fallback `VBR MP3`, then `128Kbps MP3`), ordered by track number, then
  natural file name, with durations parsed from `length` (`808.54` or `13:28`); covers from
  `archive.org/services/img/<id>`; `externalIds.librivox` from `call_number`.
- Stream for `ol:` IDs: look up the work's title and author on Open Library, then search the
  collection; every matching recording is one stream ("LibriVox · read by …").

**Catalog** (`app.lelap.catalog`, `/manifest.json`):

- Open Library: `audiobook` search catalog and meta for `ol:` IDs (title, authors, description,
  subjects, cover).
- Podcast Index (when `PODCASTINDEX_KEY` and `PODCASTINDEX_SECRET` are set): `podcast` trending
  and search catalogs and meta for `podcast:` IDs with episodes. Without the secrets these
  catalogs are left out of the manifest.

Upstream responses go through the Cache API (6 h for catalogs, 1 day for meta and streams).

## App

### Data

Migration `0002_addons`:

- `addons` (shared; M9 lets a profile hide some): `id` (UUIDv7), `url` (manifest URL, unique),
  `manifest` (JSON), `position`, `enabled`, `builtin`, `installed_at`, `updated_at`.
- `books`: `root_id` becomes nullable; new `source` (`local` | `addon`, default `local`),
  `cover_url`, `addon_meta` (JSON: add-on URL, type, ID). Streamed books have `location`
  `addon:<type>:<id>`.
- `book_files`: `root_id` becomes nullable. A streamed part's `location` is
  `stream:<sourceKey>:<part index>`, `uri` its URL. The scan only touches files and books of its
  own root, so streamed books are never marked missing.

`addStreamedBook(db, { meta, stream, addonUrl })` upserts the book, its parts and chapters (one per
part, or the stream's chapters) and returns the book ID. Everything that already works on books
(progress, journal, bookmarks, speed, finished) then works unchanged. Removing a streamed book
deletes it with its place (confirmed in the UI); local books cannot be removed.

### Add-on client (`packages/core/src/addons`)

Pure TypeScript with an injected `fetch`: fetch and validate a manifest, list Home catalogs
(no required extras), search catalogs, catalog pages with `skip`, meta from the first add-on that
declares the ID prefix, and streams from every add-on that declares it (merged, in add-on order).
10 s timeout per request; one failing add-on never fails a merged result. The app wraps it in
TanStack Query (already in the brief's stack).

Default add-ons come from `EXPO_PUBLIC_LELAP_ADDONS` (comma-separated manifest URLs) or, if unset,
`https://catalog.<EXPO_PUBLIC_LELAP_DOMAIN ?? lelap.app>/manifest.json` and `…/librivox/manifest.json`.
They are installed once on first start; removing one is remembered.

### Screens

Bottom tabs (Expo Router `Tabs`): **Home**, **Discover**, **Search**, **Library**; the mini player
sits above the tab bar.

```
Home                               ⚙      Discover                    Search
[Continue listening card]                [LibriVox ▾][New ▾]         [ search…        ]
New on LibriVox              →           [genre chips…]               LibriVox
[cv][cv][cv][cv]                         [cv][cv][cv]                 [cv] Title · Author
Most listened                →           [cv][cv][cv]   (infinite)    Catalog
[cv][cv][cv][cv]                                                       [cv] Title · Author
```

Item page (`app/item.tsx?type=&id=&addon=`): cover, title, author, narrators, duration,
description, the parts or chapters, and **Play** (or **Continue · 45 %** when in the Library).
Play picks the first stream, adds the book, plays it and opens the Player. More than one stream
shows a "Recording" picker.

Settings gains **Add-ons**: the list with remove, a field to add a manifest URL, and each add-on's
`/configure` link when declared.

## Services and deploy

- `services/catalog`: Hono, Wrangler, Vitest with recorded fixtures. Secrets via
  `wrangler secret put`. No routes in `wrangler.toml`: deploys pass the custom domain from the
  `CATALOG_DOMAIN` environment variable (`--domain`), so forks deploy to their own.
- `.github/workflows/services.yml`: on pushes to `main` touching `services/catalog` or
  `packages/sdk`, test and `wrangler deploy` in the `web` environment with a
  `CLOUDFLARE_WORKERS_API_TOKEN` secret (Workers scope, separate from the Pages token).
- `services/template`: the smallest add-on (one catalog, one meta, one stream) with a README.

## Docs

`apps/site/src/pages/docs/`: an index, the protocol reference (from the zod schemas, by hand) and
an SDK guide. `protocol.schema.json` is copied into the site's public folder at build time.

## Tests

- SDK: route parsing (extras, encoded IDs), CORS, 404s, schema validation.
- Services: catalog, meta and stream mapping against recorded archive.org, Open Library and
  Podcast Index fixtures; duration parsing; the Podcast Index auth header.
- Core: the migration keeps existing data; `addStreamedBook` upserts and replaces parts while the
  place follows its part; a local rescan leaves streamed books alone; the add-on client merges,
  routes by prefix, and survives a failing add-on.

## Left to the builder

Component structure, list virtualisation, exact package versions within the 7-day rule, how a
default add-on removal is remembered, and copy.
