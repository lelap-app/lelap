# M19 follow-ups

What is left of [M19 Security and hardening](milestones/m19.md). The findings
and the reasoning are in [`security-audit.md`](security-audit.md).

## 1. Checks on a phone

- **Playback controls from outside Lelap** (finding 5): with a release or debug build, play a book,
  then use the lock screen, the notification, Bluetooth headphones (play, pause, skip) and Android
  Auto (or the Desktop Head Unit). All should still work. The app's own sleep timer, Up Next and
  settings should too.
- **Remove a lost device** (finding 7): pair a phone and the web app, reset on one, check the other
  shows “Another device reset sync” within a minute and can join again with a new code.
- **Sealed secrets** (finding 6): update a phone that already syncs and has a WebDAV server; sync
  and playback keep working, and `adb shell run-as app.lelap sqlite3` shows `sec1:` values. Then
  `adb shell bmgr backupnow app.lelap`, reinstall, restore: the library and places come back, the
  Sync screen asks to pair again, and the server shows “Log in”.
- **Updater** (finding 12): install an update from `beta.json` end to end; a wrong `size` in the
  release file should fail with “The download is larger than the release.”

## 2. Checks elsewhere

- **Docker web image:** build `docker/web.Dockerfile` and check that `curl -I` on port 8080 shows the
  Content-Security-Policy and the other headers (Docker was not running when this was written; the
  Caddy snippet is generated, `import headers.caddy` is relative to the Caddyfile).
- **Cloudflare Pages:** after the first deploy, `curl -I https://listen.lelap.app/` should show the
  headers from `_headers`.

## 3. Decisions for the maintainer

- **`WEB_ORIGIN`** (4): set it in the `web` environment (rate limits are already on Cloudflare).
- **Separate Cloudflare tokens** (11) for the `web` and `release` environments.
- **Plain http on Android** (17): keep it off and explain, or allow it.
- **Idle groups** (18): decided and built in [M52](milestones/m52.md): no push for 2 years on
  lelap.app, a setting (`SYNC_IDLE_EXPIRY_DAYS`) that is off by default when self-hosted.
- **HSTS** for the zone in the Cloudflare dashboard.
