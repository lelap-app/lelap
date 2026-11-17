# Self-hosting

Lelap's services run in Docker as well as on Cloudflare: the same Hono apps, with Node entries in
[`server/`](server/) (Node's HTTP server, an in-memory cache, and Node's built-in SQLite for sync
instead of D1).

| Image                       | Port | What                                        |
| --------------------------- | ---- | ------------------------------------------- |
| `ghcr.io/lelap-app/web`     | 8080 | The web app (static files behind Caddy)     |
| `ghcr.io/lelap-app/catalog` | 8787 | Catalog and LibriVox add-ons                |
| `ghcr.io/lelap-app/proxy`   | 8788 | RSS and covers for the web app; never audio |
| `ghcr.io/lelap-app/sync`    | 8789 | Encrypted sync; data in the `/data` volume  |

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

Back up the `sync-data` volume: it holds encrypted messages only, but losing it means devices
pair again.
