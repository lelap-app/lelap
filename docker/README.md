# Self-hosting

Lelap's services run in Docker as well as on Cloudflare: the same Hono apps, with Node entries in
[`server/`](server/) (Node's HTTP server, an in-memory cache, and Node's built-in SQLite for sync
instead of D1).

| Image                       | Port | What                                                    |
| --------------------------- | ---- | ------------------------------------------------------- |
| `ghcr.io/lelap-app/web`     | 8080 | The web app (static files behind Caddy)                 |
| `ghcr.io/lelap-app/catalog` | 8787 | Catalog, LibriVox, Internet Archive, Hardcover, gPodder |
| `ghcr.io/lelap-app/proxy`   | 8788 | RSS, covers, transcripts for the web app; never audio   |
| `ghcr.io/lelap-app/sync`    | 8789 | Encrypted sync; data in the `/data` volume              |
| `ghcr.io/lelap-app/updates` | 8790 | Signed app bundles (over the air); `/data`              |

Images are multi-arch (amd64, arm64) and published with build provenance on every release tag:
`latest` and `1.2` for stable releases, `beta` for betas.

## Run

```sh
cd docker
LELAP_DOMAIN=example.org docker compose up -d --build web
docker compose up -d catalog proxy sync
```

The app finds its services by domain: `listen.`, `catalog.`, `proxy.` and `sync.<LELAP_DOMAIN>`.
Put the four ports behind HTTPS with those names (any reverse proxy). The published `web` image is
built for `lelap.app`, so build your own with `LELAP_DOMAIN`; the other images need no domain.
Android builds for your domain need `EXPO_PUBLIC_LELAP_DOMAIN` set when they are built.

The proxy refuses addresses on private networks (loopback, `10.x`, `192.168.x`, link-local and so
on), also after DNS and redirects, so strangers can't use it to reach the services next to it. If
your own feeds are on your network, set `PROXY_ALLOW_PRIVATE=true` and keep the proxy off the
internet. The `web` image sends a Content-Security-Policy built for `LELAP_DOMAIN`; the services
send no-sniff and sandbox headers. Rate limits belong in your reverse proxy.

`updates` is only for Android builds of your own: it serves the signed bundles that
`scripts/ota.mts` writes into its `/data` volume (`ota/channels/…` and `ota/<runtime>/…`), at
`updates.<LELAP_DOMAIN>`. Pass `https://updates.<LELAP_DOMAIN>` as the script's base URL so the
bundles come from the same place. Builds need your own code-signing certificate; see
[M18 setup](../docs/milestones/m18.md#setup).

Back up the `sync-data` volume: it holds encrypted messages only, but losing it means devices
pair again.

`sync` keeps every group until you say otherwise. Set `SYNC_IDLE_EXPIRY_DAYS` (for example `730`
for 2 years, as lelap.app does) and it deletes groups no device has sent changes to for that many
days, checked at start and once a day. Empty or `0` means never. The devices keep their data and
can pair again. The log itself stays small without a setting: devices replace old messages with
a sealed snapshot.
