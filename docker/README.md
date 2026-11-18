# Self-hosting

Lelap's services run in Docker as well as on Cloudflare: the same Hono apps, with Node entries in
[`server/`](server/) (Node's HTTP server, an in-memory cache, and Node's built-in SQLite for sync
instead of D1).

| Image                       | Port | Admin page | What                                                    |
| --------------------------- | ---- | ---------- | ------------------------------------------------------- |
| `ghcr.io/lelap-app/web`     | 8080 |            | The web app (static files behind Caddy)                 |
| `ghcr.io/lelap-app/catalog` | 8787 | 9787       | Catalog, LibriVox, Internet Archive, Hardcover, gPodder |
| `ghcr.io/lelap-app/proxy`   | 8788 | 9788       | RSS, covers, transcripts for the web app; never audio   |
| `ghcr.io/lelap-app/sync`    | 8789 | 9789       | Encrypted sync; data in the `/data` volume              |
| `ghcr.io/lelap-app/updates` | 8790 | 9790       | Signed app bundles (over the air); `/data`              |

Images are multi-arch (amd64, arm64) and published with build provenance on every release tag:
`latest` and `1.2` for stable releases, `beta` for betas.

## Run

From a checkout of this repository, on a server with Docker:

```sh
cd docker
cp .env.example .env   # optional: set LELAP_DOMAIN and anything else you need
docker compose up -d
```

That one command:

- builds the web app for `LELAP_DOMAIN` (default `localhost`) and starts it with `catalog`,
  `proxy` and `sync`, on the ports above;
- pulls the service images for `LELAP_TAG` (default `latest`), or builds them here when that tag
  is not published yet;
- makes an admin token and the catalog's `CONFIG_SECRET` on first start and keeps them in the
  `secrets` volume, so they stay the same across restarts and upgrades;
- checks each service's health every 30 s; `docker compose ps` shows it.

The app finds its services by domain: `listen.`, `catalog.`, `proxy.` and `sync.<LELAP_DOMAIN>`,
over HTTPS. With those four names in DNS, `docker compose --profile https up -d` adds Caddy in
front with certificates from Let's Encrypt; or put your own reverse proxy in front. Both are in
[`reverse-proxy/`](reverse-proxy/README.md). Android builds for your domain need
`EXPO_PUBLIC_LELAP_DOMAIN` set when they are built.

Upgrade with `git pull`, then `docker compose pull && docker compose up -d`; the web app is
rebuilt whenever the checkout changed, which takes a few minutes. Every setting is in
[`.env.example`](.env.example).

The admin pages, generated secrets and health checks came after `v0.1.0-beta.8`. Until a release
has them, build the images from your checkout: `docker compose build && docker compose up -d`.

## Admin page

Each service has a small admin page on a port of its own (9787 to 9790): its version, how long it
has run, whether its health checks pass and which optional settings are on. The sync page adds
the database's size and the sync groups, largest first: the first 8 characters of each group's
random ID, its size, message count, and when it was created and last synced. The page never
shows what is inside a group (it is sealed, and the server has no keys), tokens, secret values
or listeners' addresses, and it sends no requests anywhere.

It is protected two ways:

1. **A token.** Every page except `/health` needs `ADMIN_TOKEN`: the browser asks for it (any user
   name, the token as password), or send `Authorization: Bearer <token>`. Without a token of 16
   characters or more, the page is off; a wrong token waits half a second before it is refused.
   Read the generated one with `docker compose exec sync cat /secrets/admin_token`.
2. **Local addresses only.** The compose file publishes the admin ports on `127.0.0.1`
   (`ADMIN_BIND`), so only the server itself reaches them. The pages also refuse callers outside
   loopback and private networks unless `ADMIN_ALLOW_REMOTE=true`. The reverse proxy examples
   never forward the admin ports.

The token is the real boundary: other containers and machines on your private network count as
local, so they need it too. The loopback binding is what keeps the pages off the internet; keep
`ADMIN_BIND=127.0.0.1`. The address check inside the page is a second line only. It sees the
caller's real address only where Docker keeps it (IPv4 on a Linux server with the default setup);
behind Docker Desktop, IPv6 on a dual-stack host, rootless Docker, Podman or any port forwarder,
every outside caller looks local. The page speaks plain HTTP, so send the token only over
loopback or an SSH tunnel, never across a network.

From your own computer, use an SSH tunnel:

```sh
ssh -L 9789:127.0.0.1:9789 you@your-server   # then open http://localhost:9789
curl -u admin:"$TOKEN" http://127.0.0.1:9789/status.json   # the same as JSON, on the server
```

`/health` answers `{"status":"ok"}` or `503` without the token and without details. It runs only
quick checks (the service's own port, and for sync one query), so calling it often costs little;
Docker's health check uses it. The image's health check needs `ADMIN_PORT`, which the images set.

On Cloudflare (lelap.app) there is no admin page: it lives in the Node entries only, never in the
Workers, and Cloudflare's dashboard shows the same.

## Back up

Back up the `sync-data` and `secrets` volumes. Sync holds encrypted messages only, but losing it
means devices pair again; losing `CONFIG_SECRET` means listeners set up Hardcover and gPodder
again. How, with a tested restore: [backup.md](backup.md).

## Settings

The proxy refuses addresses on private networks (loopback, `10.x`, `192.168.x`, link-local and so
on), also after DNS and redirects, so strangers can't use it to reach the services next to it. If
your own feeds are on your network, set `PROXY_ALLOW_PRIVATE=true` and keep the proxy off the
internet. The `web` image sends a Content-Security-Policy built for `LELAP_DOMAIN`; the services
send no-sniff and sandbox headers. Rate limits belong in your reverse proxy; the nginx and Traefik
examples have them, Caddy needs a plugin for them.

`updates` is only for Android builds of your own, so it starts only with
`--profile updates`. It serves the signed bundles that `scripts/ota.mts` writes into its `/data`
volume (`ota/channels/…` and `ota/<runtime>/…`), at `updates.<LELAP_DOMAIN>`. Pass
`https://updates.<LELAP_DOMAIN>` as the script's base URL so the bundles come from the same place.
Builds need your own code-signing certificate; see [M18 setup](../docs/milestones/m18.md#setup).

`sync` keeps every group until you say otherwise. Set `SYNC_IDLE_EXPIRY_DAYS` (for example `730`
for 2 years, as lelap.app does) and it deletes groups no device has sent changes to for that many
days, checked at start and once a day. Empty or `0` means never. The devices keep their data and
can pair again. The log itself stays small without a setting: devices replace old messages with
a sealed snapshot.
