# Behind a reverse proxy

The app reaches a self-hosted Lelap at four HTTPS names on your domain:

| Name                    | Service | Port |
| ----------------------- | ------- | ---- |
| `listen.<your domain>`  | web     | 8080 |
| `catalog.<your domain>` | catalog | 8787 |
| `proxy.<your domain>`   | proxy   | 8788 |
| `sync.<your domain>`    | sync    | 8789 |

Add `updates.<your domain>` (port 8790) only for Android builds of your own. Point all four names at
the server in DNS (four A or AAAA records, or a wildcard), then pick one of the three below. Each
example does the same: HTTPS with Let's Encrypt, HTTP sent on to HTTPS, request bodies up to 16 MB
(a full sync push is about 13 MB), and the services' own ports and nothing else. Never forward
the admin ports (9787 to 9790); [use an SSH tunnel](../README.md#admin-page) for those.

Audio never passes through any of this. The app plays it straight from where it lives; the
proxy refuses audio and only carries feeds, covers and transcripts.

## Caddy, from the compose file

The simplest: Caddy runs next to the services and gets certificates by itself.

```sh
cd docker
echo LELAP_DOMAIN=example.org >> .env
docker compose --profile https up -d
```

It uses [`Caddyfile`](Caddyfile) as it is, and keeps its certificates in the `caddy-data` volume.
Ports 80 and 443 must be free and reachable from the internet. To keep the profile on for every
`docker compose` command, add `COMPOSE_PROFILES=https` to `.env`.

## Caddy, already on the server

Import the same [`Caddyfile`](Caddyfile) from yours and tell it where the services listen:

```sh
LELAP_DOMAIN=example.org WEB_UPSTREAM=127.0.0.1:8080 CATALOG_UPSTREAM=127.0.0.1:8787 \
  PROXY_UPSTREAM=127.0.0.1:8788 SYNC_UPSTREAM=127.0.0.1:8789 caddy run --config Caddyfile
```

With systemd, put those variables in the unit's `Environment=` lines.

## nginx

Copy [`nginx.conf`](nginx.conf) to `/etc/nginx/conf.d/lelap.conf`, replace `example.org`, get a
certificate for the four names, and reload:

```sh
sudo certbot certonly --nginx -d listen.example.org -d catalog.example.org \
  -d proxy.example.org -d sync.example.org --cert-name example.org
sudo nginx -t && sudo systemctl reload nginx
```

It also limits each address to 20 requests a second (bursts of 40) and streams large pushes
instead of buffering them.

## Traefik

[`traefik/traefik.yml`](traefik/traefik.yml) is the static configuration (entry points, Let's
Encrypt) and [`traefik/lelap.yml`](traefik/lelap.yml) the routes. Replace `example.org` and the
email address, then run Traefik with both, for example:

```sh
docker run -d --name traefik --network host \
  -v "$PWD/traefik/traefik.yml:/etc/traefik/traefik.yml:ro" \
  -v "$PWD/traefik/lelap.yml:/etc/traefik/lelap.yml:ro" \
  -v traefik-acme:/etc/traefik/acme traefik:v3.6
```

If Traefik runs in the same compose project instead, change the `127.0.0.1` addresses in
`lelap.yml` to the service names (`http://web:8080`, `http://catalog:8787` and so on).

## After the proxy is up

- Set `WEB_ORIGIN=https://listen.<your domain>` in `.env`, so only your web app may use the proxy
  from a browser, and run `docker compose up -d` again.
- If the reverse proxy reaches the services over `127.0.0.1`, you can publish their ports on
  `127.0.0.1` only (`'127.0.0.1:8787:8787'` in `compose.yml`), so nobody skips the proxy.
- Check: `curl -I https://catalog.<your domain>/manifest.json` answers 200, and
  `https://listen.<your domain>` opens the app.
