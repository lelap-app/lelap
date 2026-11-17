# M3 follow-ups

What is left of [M3 Add-on protocol and SDK](milestones/m3.md) after PR #12,
to pick up later. The done-when (find a LibriVox book in the app and play it) passed on the device.

## 1. Device checks

The checklist with steps is in [`apps/app/README.md`](../apps/app/README.md#m3-device-checklist).
Status on the Pixel 10 Pro XL (Android 17), 2026-11-16, against `wrangler dev` on the laptop:

| #   | Check                       | Status                                      |
| --- | --------------------------- | ------------------------------------------- |
| 1   | Home rows                   | Pass                                        |
| 2   | Search                      | Pass: 4 LibriVox, 30 Open Library           |
| 3   | Play a LibriVox book        | Pass: streams, shows as Streaming           |
| 4   | Place kept                  | Pass: force-stopped in ch. 3, resumed there |
| 5   | Open Library item           | Pass: 4 recordings, Continue · 5 %          |
| 6   | Remove and re-add an add-on | Not run                                     |
| 7   | Airplane mode               | Not run                                     |
| 8   | Remove a streamed book      | Not run                                     |

Also worth repeating once against the deployed `catalog.lelap.app` instead of `wrangler dev`.

## 2. Cleanup on the test phone

The phone has the `localhost:8787` add-ons installed from the test run. Remove them in Settings →
Add-ons; the deployed ones install on the next start of a build without `EXPO_PUBLIC_LELAP_ADDONS`.

## 3. Not verified

- **Podcast Index:** the Catalog add-on's podcast catalogs and meta are tested only against
  hand-written fixtures. Set `PODCASTINDEX_KEY` and `PODCASTINDEX_SECRET` with `wrangler secret put`
  and try `trending` and a search before M5 relies on them.
- **First deploy from CI:** the `web` environment has `CLOUDFLARE_WORKERS_API_TOKEN` and
  `CATALOG_DOMAIN`; the first run on `main` is the first use of that token.

## 4. Protocol and SDK notes

- Publishing `@lelap/sdk` to npm needs a build step: it exports TypeScript source with
  extensionless imports, which plain Node can't load.
- The published JSON Schema rejects unknown fields while the app drops them; decide which one
  the protocol promises before third parties build on it.
- Streams for `episode` items are specified loosely; settle the episode ID convention in M5.
