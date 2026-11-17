# services

Small Hono services that run on Cloudflare Workers and, for self-hosters, in Docker. See
[`docs/brief.md`](../docs/brief.md).

## `sync`

Encrypted sync (Worker `lelap-sync`, D1 `lelap-sync`). It stores sealed messages per group in
arrival order and hands out pairing blobs once; it never sees keys or plaintext. A group is a
random ID plus the SHA-256 of its auth token. Limits: 50 messages of 256 KB per push, 50 MB per
group, pairings 4 KB for ten minutes.

| Route                                | What                                  |
| ------------------------------------ | ------------------------------------- |
| `PUT /v1/groups/:id`                 | Create a group with its auth hash     |
| `POST /v1/groups/:id/messages`       | Append sealed messages (Bearer token) |
| `GET /v1/groups/:id/messages?after=` | Read messages after a sequence number |
| `DELETE /v1/groups/:id`              | Delete the group and its messages     |
| `PUT /v1/pairings/:lookup`           | Leave a sealed group secret           |
| `POST /v1/pairings/:lookup`          | Take it (deletes it)                  |

```sh
pnpm --filter @lelap/sync dev    # applies migrations locally, wrangler dev on :8789
pnpm --filter @lelap/sync test   # the routes, and the app's real sync engine against them
```

Environments: `main` deploys to staging (`--env staging`, D1 `lelap-sync-staging`); `v*` tags
deploy production from the release workflow (M8). Create both databases once and put their IDs in
`wrangler.toml` (see the comments there). Set `SYNC_STAGING_DOMAIN` (`sync-staging.lelap.app`) in
the `web` environment.

## `proxy`

RSS feeds and cover images for the web app (Worker `lelap-proxy`), because browsers can't read
most feeds across origins. It never passes audio: `/feed?url=` only answers XML up to 10 MB,
`/cover?url=` only raster images up to 5 MB; media types and non-XML bodies are refused. Feeds are
cached for 15 minutes, covers for a day; `ETag` and `Last-Modified` pass through for conditional
requests.

```sh
pnpm --filter @lelap/proxy dev   # wrangler dev on http://localhost:8788
pnpm --filter @lelap/proxy test
```

Deploys with the catalog from `services.yml` (job `deploy-proxy`). Set `PROXY_DOMAIN`
(`proxy.lelap.app`) and `WEB_ORIGIN` (`https://listen.lelap.app`) in the `web` environment, and add
the free plan's rate limiting rule for the proxy's hostname in the Cloudflare dashboard.

## `catalog`

The first-party add-ons, on one Worker (`lelap-catalog`):

| Path                      | Add-on                          | Sources                                     |
| ------------------------- | ------------------------------- | ------------------------------------------- |
| `/manifest.json`          | Catalog (`app.lelap.catalog`)   | Open Library; Podcast Index when configured |
| `/librivox/manifest.json` | LibriVox (`app.lelap.librivox`) | archive.org's `librivoxaudio` collection    |
| `/`                       | JSON listing both manifests     |                                             |

- **LibriVox**: "New on LibriVox" and "Most listened" (with `genre` and `skip`), search, meta and
  streams for `librivox:` IDs, and streams for Open Library works (`ol:` IDs) found by title and
  author. Audio URLs point straight at archive.org; the Worker never touches audio.
- **Catalog**: Open Library search and meta for `ol:` IDs. With both Podcast Index secrets set it
  also lists trending podcasts, podcast search and meta for `podcast:` IDs with episodes; without
  them those catalogs are left out of the manifest.

Upstream JSON goes through the Cache API (6 h for catalogs, 1 day for meta and streams). Requests
upstream carry `User-Agent: Lelap/1 (+<SOURCE_URL>)`, with `SOURCE_URL` set in `wrangler.toml`.

```sh
cp .dev.vars.example .dev.vars   # optional: Podcast Index keys for local runs
pnpm --filter @lelap/catalog dev   # wrangler dev on http://localhost:8787
pnpm --filter @lelap/catalog test  # Vitest against recorded fixtures in test/fixtures
```

### Secrets

Both are optional. Get free keys at [api.podcastindex.org](https://api.podcastindex.org), then:

```sh
cd services/catalog
pnpm exec wrangler secret put PODCASTINDEX_KEY
pnpm exec wrangler secret put PODCASTINDEX_SECRET
```

### Deploy

`.github/workflows/services.yml` tests and deploys on pushes to `main` that touch
`services/catalog`, `packages/sdk` or the lockfile, in the `web` environment. It needs:

- the `CLOUDFLARE_WORKERS_API_TOKEN` secret: a token from the **Edit Cloudflare Workers** template,
  limited to the account and the zone, separate from the Pages token;
- the `CLOUDFLARE_ACCOUNT_ID` variable;
- the `CATALOG_DOMAIN` variable in the `web` environment (`catalog.lelap.app` for lelap.app). Every
  deploy passes it as `--domain`, which creates the custom domain and its DNS record. Leave it
  unset to use only the `workers.dev` URL.

`wrangler.toml` has no routes, so forks and self-hosters deploy to their own domain. To deploy by
hand: `pnpm --filter @lelap/catalog run deploy -- --domain catalog.<domain>` (`run` matters:
`pnpm deploy` is a pnpm command).

## `updates`

Over-the-air JavaScript updates for the Android app (Worker `lelap-updates`, M18). It answers the
[Expo Updates protocol](https://docs.expo.dev/technical-specs/expo-updates-1/) version 1 from the
downloads bucket: `GET /manifest` with the `expo-runtime-version` and `expo-channel-name`
(`production` or `beta`) headers returns the signed manifest the release workflow uploaded, or
`204` when there is nothing newer. Signing happens in CI, so the Worker holds no secret. Bundles are
served from the downloads host; `GET /ota/…` serves them too, for self-hosting without a bucket.
Never audio.

```sh
pnpm --filter @lelap/updates dev    # wrangler dev, with a local R2 bucket
pnpm --filter @lelap/updates test
```

Deploys from `services.yml` (job `deploy-updates`); set `UPDATES_DOMAIN` (`updates.lelap.app`) in
the `web` environment. Setup: [`docs/m18-follow-ups.md`](../docs/m18-follow-ups.md).

## `template`

The smallest third-party add-on: one catalog, meta and streams for two LibriVox recordings, with a
README on copying it, running `wrangler dev`, adding it in Lelap and deploying. CI type-checks,
tests and bundles it.

## Planned

- `proxy`: RSS feeds and cover images for the web app. Never audio.
- `sync`: encrypted sync blobs and oplogs.
