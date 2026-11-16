# M3 Add-on protocol and SDK Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find a LibriVox book in the app and play it, through a documented add-on protocol.

**Spec:** [`docs/superpowers/specs/2026-11-16-m3-addon-protocol-design.md`](../specs/2026-11-16-m3-addon-protocol-design.md)

**Tech stack:** zod 4 (`z.toJSONSchema`), Hono on Workers with Wrangler, Vitest, Drizzle, TanStack
Query, Expo Router `Tabs`, Astro.

## Global constraints

- Everything in `AGENTS.md`: strict TypeScript, no `any`, named exports, English, no hard-coded
  hosts, nothing that names or targets piracy services, no add-on directory.
- New dependencies resolve to versions at least 7 days old; never weaken the supply-chain settings.
- Run commands with Node 24 (`.nvmrc`).
- Times in milliseconds. IDs in the protocol are `prefix:value`.
- Audio never goes through the Worker; it only returns JSON.

## Tasks

### 1. `@lelap/sdk`: protocol and `createAddon`

- [ ] `packages/sdk` (`type: module`, exports `./src/index.ts`; `check`, `test`, `build` that
      writes `dist/protocol.schema.json`).
- [ ] `protocol.ts`: zod schemas `Manifest`, `MetaPreview`, `Meta`, `Stream`, `CatalogResponse`,
      `MetaResponse`, `StreamResponse`, constants `PROTOCOL_VERSION = 1`, `CONTENT_TYPES`.
- [ ] `paths.ts`: `catalogPath(type, id, extra)`, `metaPath`, `streamPath`, `parseExtra`,
      `encodeExtra`, `parseRoute(pathname)`.
- [ ] `addon.ts`: `createAddon({ manifest, catalog?, meta?, stream? })` → `{ fetch(request) }`;
      CORS (`*`, `OPTIONS`), `Cache-Control` from `cacheMaxAge`, JSON 404/500, base-path aware
      (`/librivox/manifest.json`).
- [ ] Tests: routes with encoded IDs and extras, CORS, unknown route, handler error, validation.

### 2. `services/catalog` and `services/template`

- [ ] Hono app with `/` → Catalog add-on and `/librivox/*` → LibriVox add-on; `wrangler.toml`
      (`name = "lelap-catalog"`, no routes); cache helper over the Cache API.
- [ ] LibriVox: archive.org search (catalogs, genre, skip, search), metadata → meta and stream,
      `ol:` streams via Open Library work lookup; duration parsing; fixtures.
- [ ] Catalog: Open Library search and work meta; Podcast Index trending, search and podcast meta
      with episodes when secrets exist; auth header; fixtures.
- [ ] `services/template`: the smallest add-on with README.
- [ ] `.github/workflows/services.yml`: test and deploy on `main`, environment `web`.

### 3. Core: streamed books and add-on client

- [ ] Schema: `addons` table; `books.root_id` and `book_files.root_id` nullable; `books.source`,
      `cover_url`, `addon_meta`. Generate `0002_addons` with drizzle-kit; extend `migrations.js`.
- [ ] `addStreamedBook`, `removeBook` (streamed only), `findStreamedBook(type, id)`;
      `LibraryBook` gains `source` and `coverUrl`.
- [ ] Add-on repository: `listAddons`, `installAddon`, `removeAddon`, `installDefaultAddons`.
- [ ] Client: `fetchManifest`, `homeCatalogs`, `searchCatalogs`, `fetchCatalog`, `fetchMeta`,
      `fetchStreams` with injected fetch, timeout and per-add-on failure isolation.
- [ ] Tests for all of it, including "a rescan leaves streamed books alone" and "the migration keeps
      M2 data".

### 4. App screens

- [ ] TanStack Query provider; `src/config.ts` with default add-on URLs from env.
- [ ] Tabs: Home, Discover, Search, Library; Library moves into the tab group; mini player above
      the tab bar.
- [ ] `app/item.tsx`, `src/addons.ts` (play an item: streams → `addStreamedBook` → `playBook`).
- [ ] Settings → Add-ons screen.
- [ ] Covers from URLs; "Streaming" tag and remove in the Library.
- [ ] Keep the M1 LibriVox dev loader until M1's call checks pass (it goes with the spike screen).

### 5. Docs and roadmap

- [ ] `apps/site/src/pages/docs/{index,protocol,sdk}.astro`; copy the JSON Schema into the site.
- [ ] `brief.md` (JSON Schema instead of zod-openapi), `roadmap.md` (M3 in progress),
      `AGENTS.md` repo map, `services/README.md`, `packages/README.md`.

### 6. Verify

- [ ] `pnpm format:check && pnpm lint && pnpm check && pnpm test && pnpm build`.
- [ ] Run the Worker locally (`wrangler dev`) and query it; open the app on the web or a device
      if available.
