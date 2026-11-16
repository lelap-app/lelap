# services

Small Hono services that run on Cloudflare Workers and, for self-hosters, in Docker. See
[`docs/brief.md`](../docs/brief.md).

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

## `template`

The smallest third-party add-on: one catalog, meta and streams for two LibriVox recordings, with a
README on copying it, running `wrangler dev`, adding it in Lelap and deploying. CI type-checks,
tests and bundles it.

## Planned

- `proxy`: RSS feeds and cover images for the web app. Never audio.
- `sync`: encrypted sync blobs and oplogs.
- `updates`: expo-updates manifests and `latest.json` for the APK updater.
