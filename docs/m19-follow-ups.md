# M19 follow-ups

What is left of [M19 Security and hardening](roadmap.md#m19-security-and-hardening). The findings
and the reasoning are in [`security-audit.md`](security-audit.md).

## 1. Checks on a phone

- **Playback controls from outside Lelap** (finding 5): with a release or debug build, play a book,
  then use the lock screen, the notification, Bluetooth headphones (play, pause, skip) and Android
  Auto (or the Desktop Head Unit). All should still work. The app's own sleep timer, Up Next and
  settings should too.
- **Updater** (finding 12): install an update from `beta.json` end to end; a wrong `size` in the
  release file should fail with “The download is larger than the release.”

## 2. Checks elsewhere

- **Docker web image:** build `docker/web.Dockerfile` and check that `curl -I` on port 8080 shows the
  Content-Security-Policy and the other headers (Docker was not running when this was written; the
  Caddy snippet is generated, `import headers.caddy` is relative to the Caddyfile).
- **Cloudflare Pages:** after the first deploy, `curl -I https://listen.lelap.app/` should show the
  headers from `_headers`.

## 3. Decisions for the maintainer

- **Rate limits** (4): Cloudflare rules for `sync.` and `proxy.`, or a Workers Rate Limiting
  binding; set `WEB_ORIGIN` in the `web` environment.
- **Secrets on the device** (6): the `SecretStore` design in the audit, and whether Android backups
  stay on.
- **Removing a lost device** (7): a “Reset sync” that makes a new group and key.
- **Separate Cloudflare tokens** (11) for the `web` and `release` environments.
- **Plain http on Android** (17): keep it off and explain, or allow it.
- **Idle groups** (18): expire sync groups with no push for a year, with the log compaction.
- **HSTS** for the zone in the Cloudflare dashboard.
