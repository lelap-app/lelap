# Security audit (M19)

A review of the services, sync crypto, CI, the Android app and the web build, made on 17 November
2026 against `main` at `8ee0bc0`. Each finding has a severity, where it is, what it is, and either
the fix in this change or a decision for the maintainer. Open device and dashboard checks are in
[`m19-follow-ups.md`](m19-follow-ups.md).

**Severity:** High (exploitable now, real harm), Medium (exploitable with conditions, or a missing
layer that matters), Low (hardening), Info (checked and fine, or by design).

## Summary

| #   | Severity | Area            | Finding                                                                 | Status   |
| --- | -------- | --------------- | ----------------------------------------------------------------------- | -------- |
| 1   | High     | Docker proxy    | Fetches private and loopback addresses (SSRF), also through redirects   | Fixed    |
| 2   | Medium   | Proxy           | Any XML or image is served from the proxy's origin and could run there  | Fixed    |
| 3   | Medium   | Sync server     | Request bodies read in full before size checks (memory on Node)         | Fixed    |
| 4   | Medium   | Sync, proxy     | No rate limits in code: groups, pairings and proxy fetches              | In place |
| 5   | Medium   | Android audio   | Any app could send Lelap's custom playback commands                     | Fixed    |
| 6   | Medium   | Android, web    | Sync group key and server passwords in plain SQLite; in Android backups | Fixed    |
| 7   | Medium   | Sync crypto     | No way to remove a lost device: the group key never changes             | Fixed    |
| 8   | Medium   | Web app         | No Content-Security-Policy or security headers                          | Fixed    |
| 9   | Medium   | GitHub Actions  | Release jobs with secrets restored shared caches                        | Fixed    |
| 10  | Medium   | GitHub Actions  | Docker images and `latest` published without the release approval       | Fixed    |
| 11  | Medium   | Cloudflare      | One Workers token name in both `web` and `release` environments         | Decision |
| 12  | Low      | Android updater | APK download had no size cap                                            | Fixed    |
| 13  | Low      | GitHub Actions  | Keystore file left on the runner when the build failed                  | Fixed    |
| 14  | Low      | Sync server     | Odd `after` values could fail with 500; answers had no `no-store`       | Fixed    |
| 15  | Low      | Sync pairing    | Opened pairing content was trusted without checks                       | Fixed    |
| 16  | Low      | Catalog, sync   | JSON answers had no CSP or referrer policy                              | Fixed    |
| 17  | Low      | Android         | Release builds refuse plain-http feeds, audio and LAN servers           | Decision |
| 18  | Low      | Sync server     | Group size check and append can race; idle groups never expire          | Decision |
| 19  | Low      | Dependencies    | Two moderate advisories, both in build tools                            | Decision |
| 20  | Info     | Sync crypto     | Cipher, nonces, HKDF labels and scrypt cost are sound                   | Checked  |
| 21  | Info     | Android updater | https on every hop, SHA-256 and size, package name pinned               | Checked  |
| 22  | Info     | GitHub Actions  | Pinned SHAs, read-only defaults, no `pull_request_target`, tag rules    | Checked  |

## 1. Services

### 1. Docker proxy fetched private addresses (High, fixed)

**Where:** `services/proxy/src/app.ts`, `docker/server/src/proxy.ts`.
**What:** The proxy fetches any `http(s)` URL with `redirect: 'follow'`. Workers can't reach
private networks, but the Node build runs next to the other containers and often a home network.
Anyone could ask it for `http://sync:8789/…`, a router page, `169.254.169.254` (cloud metadata) or
an S3-compatible store such as MinIO, whose answers are XML and pass the feed check. A public name
can also resolve to a private address, or redirect to one.
**Fix:** The app follows redirects itself (at most five, each checked to be `http(s)`), so every
hop goes through the platform's `fetch`. The Node build's `fetch` (`docker/server/src/guardedFetch.ts`)
checks the address when the socket connects, after DNS, against loopback, private, link-local,
shared, multicast, reserved and IPv4-mapped ranges, and checks literal addresses before
connecting. Refusals answer 403. `PROXY_ALLOW_PRIVATE=true` turns it off for people whose feeds are
on their own network. Tests run a local server and a resolver that lies.

### 2. Proxied XML could run as a page on the proxy's origin (Medium, fixed)

**Where:** `services/proxy/src/app.ts`.
**What:** A feed is served as `application/xml`. An XML document with an XHTML namespace runs
script when opened directly, so `proxy.lelap.app/feed?url=<attacker>` would run the attacker's
script on a `lelap.app` subdomain (cookie tossing, same-site requests).
**Fix:** Every proxy answer carries `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'; sandbox`, `X-Content-Type-Options: nosniff` and `Referrer-Policy:
no-referrer`. `fetch()` and `<img>` ignore these; a browser tab gets a script-less sandbox.

### 3. Sync bodies read in full before checks (Medium, fixed)

**Where:** `services/sync/src/app.ts`.
**What:** `c.req.json()` buffers the whole body; the 50 × 256 KB checks run after parsing. Workers
cap requests at 100 MB, but the Node build has no cap, so one large request could use all memory.
**Fix:** `hono/body-limit` refuses pushes over 50 × 256 KB plus 64 KB and other `PUT` bodies over
8 KB with 413, while the body arrives. Tested, including that a full push of maximum-size messages
still fits.

### 4. Rate limits (Medium, in place)

**Where:** `services/sync`, `services/proxy`, Cloudflare dashboard.
**What:** Anyone can create sync groups (up to 50 MB each), store 4 KB pairings and use the proxy to
fetch any feed or image, and nothing in the code limits how often. Pairing codes are safe from
guessing (see 20); the risk is storage and bandwidth abuse.
**Status:** Cloudflare rate limiting rules already cover the hosted services. For Docker, the README
now says rate limits belong in the reverse proxy. Also set the `WEB_ORIGIN` variable in the `web`
environment, so the proxy only answers the web app's origin in browsers (it does not stop scripts
outside browsers).

### 14. Sync cursor parsing and caching (Low, fixed)

**Where:** `services/sync/src/app.ts`.
**What:** `?after=1e400` became `Infinity` and reached the database; answers had no
`Cache-Control`.
**Fix:** `after` and `limit` must be whole numbers (400 otherwise). Every answer carries
`Cache-Control: no-store`, a `default-src 'none'` CSP and `Referrer-Policy: no-referrer`.

### 16. Catalog answers without CSP (Low, fixed)

**Where:** `services/catalog/src/app.ts`.
**Fix:** `nosniff`, `default-src 'none'; frame-ancestors 'none'` and `no-referrer` on every answer.
The SDK's CORS headers are unchanged. Add-ons built with the SDK that serve a `/configure` page set
their own headers.

### 18. Group size race and idle groups (Low, decision)

**Where:** `services/sync/src/app.ts`, `d1.ts`, `sqliteStore.ts`.
**What:** The 50 MB check reads `bytes` before appending, so two parallel pushes can pass it
together and overshoot by one push (12.8 MB at most). Groups no device uses stay forever.
**Decision:** Accept the overshoot. Expire groups with no push for a set time, as a scheduled
job: built in [M52 Sync upkeep](milestones/m52.md) with a `last_push_at` column and the
`SYNC_IDLE_EXPIRY_DAYS` setting, 2 years on lelap.app and never by default when self-hosted.

### Checked and fine

- **Auth:** group IDs are 128 random bits; the server keeps SHA-256 of a 256-bit token and compares
  in constant time. A plain hash is right for a random token. Wrong tokens and unknown groups both
  answer 403.
- **Pairing:** single use (`DELETE … RETURNING` on D1 and SQLite), ten-minute expiry checked on
  read, expired rows removed on each new pairing, 4 KB blobs, 64-hex lookups.
- **Validation:** IDs, device IDs, base64url messages, counts and sizes are checked before storage.
- **CORS:** `*` on sync is right: bearer tokens, no cookies. The proxy's origin is configurable.
- **Errors:** generic messages; no stack traces, upstream bodies or internal URLs. The proxy names
  only the upstream status code.
- **Proxy:** never audio (media types and non-XML refused), SVG refused for covers, size limits
  checked while reading, 15 s timeout across all hops.
- **Docker:** images run as `node`, pinned by digest; sync data in a volume.

## 2. Sync crypto and pairing

### 20. The primitives are sound (Info, checked)

**Where:** `packages/core/src/sync/crypto.ts`, `engine.ts`.

- **Cipher:** XChaCha20-Poly1305 from `@noble/ciphers` with a random 24-byte nonce per message,
  from `expo-crypto` on Android and `crypto.getRandomValues` on the web. Random nonces are safe at
  this size. The group ID is bound as associated data, so a message can't be moved between groups.
- **Keys:** the 32-byte group key goes through HKDF-SHA-256 with two distinct labels
  (`lelap sync ops v1` and `lelap sync auth v1`). No salt is needed for a uniformly random key.
  The auth token can't be turned back into the encryption key.
- **Pairing codes:** 12 Crockford base32 characters from `b & 31` of random bytes (uniform, since
  256 is a multiple of 32): 60 bits. scrypt with N = 2^15, r = 8, p = 1 (about 32 MB and 0.1 s on
  a phone) makes the lookup ID and the sealing key. Someone who keeps a blob, the server included,
  needs about 2^59 scrypt runs on average to open it: hundreds of thousands of GPU-years. Online
  guessing is pointless, since the lookup is 256 bits and a wrong one changes nothing.
- **What the server learns:** a random group ID, how many devices push (random device IDs), when
  and how much (message sizes show roughly how many changes), and IP addresses. Not names, books,
  places or settings. The pairing salt is a constant, so one precomputation would cover every
  pairing; at 2^60 scrypt runs that is not practical, and adding the server's host would change
  the protocol for no real gain.
- **Replays:** the server can drop, reorder or replay sealed messages of a group. Newest-wins by
  time inside the sealed operations makes an old replay lose; dropping messages is a denial of
  service it can always do.

### 15. Pairing content trusted as is (Low, fixed)

**Where:** `packages/core/src/sync/engine.ts` (`joinWithCode`).
**What:** After opening the pairing, the group ID and key were used without checks. Only someone
with the code can seal a pairing, so this is robustness more than attack surface.
**Fix:** The group ID must be 32 hex digits and the key 32 bytes, or the join fails with “That
pairing is damaged”. Tested.

### 7. No device removal (Medium, fixed)

**Where:** `packages/core/src/sync/engine.ts`, `apps/app/app/sync.tsx`.
**What:** Every device kept the group key for good. A lost or sold phone could read everything the
group synced later, as long as it reached the server with the token. “Stop syncing” only forgets
the key on that device.
**Fix:** Settings → Sync → “Remove a lost device” (`resetSync`) makes a new group and key on this
device, deletes the old group on the server (`DELETE /v1/groups/:id`; already gone counts as done)
and pushes everything to the new group on the next sync. Devices still in the old group get 403 on
their next pull, stop syncing, keep their data, and the Sync screen says another device reset sync
and to join again with a code. The lost device's old key now opens nothing new. Tested end to end
against the fake server: reset, the old device drops out, a re-paired device gets the data.

## 3. GitHub Actions

### 9. Shared caches in jobs with release secrets (Medium, fixed)

**Where:** `.github/workflows/release.yml` (`apk`, `publish`, `sync`).
**What:** These jobs restored the pnpm store and the Gradle cache that other workflows write. A
poisoned cache entry would run inside the job that holds the keystore, the R2 and D1 token, or
`contents: write`.
**Fix:** No dependency caches in those three jobs (`package-manager-cache: false`, no `cache:
pnpm`, `cache-disabled: true` for Gradle). Releases build a few minutes slower.

### 10. Images published without approval (Medium, fixed)

**Where:** `release.yml` (`images`).
**What:** The image job had no environment, so on a `v*` tag it pushed to `ghcr.io`, including
`latest`, before anyone approved the release.
**Fix:** `images` now needs `apk`, which runs in the `release` environment, so images wait for the
same approval and are not published when the APK build fails. The job still gets no environment
secrets.

### 13. Keystore left on failure (Low, fixed)

**Where:** `release.yml` (`apk`, “Build and sign”).
**What:** `rm -f` ran only after a successful Gradle build. Hosted runners are thrown away, so the
risk is small.
**Fix:** A `trap` removes the file however the step ends, and it is written with `umask 077`. The
APK version moved from an inline expression into an environment variable (the value is already
parsed from the tag, so this is hygiene).

### 11. Token scope across environments (Medium, decision)

**Where:** GitHub environments `web` and `release`, Cloudflare API tokens.
**What:** Both environments hold a secret named `CLOUDFLARE_WORKERS_API_TOKEN`. If it is the same
token, anything that runs in a `main` deploy job (a compromised dependency of `wrangler`, say) can
write the `lelap-downloads` bucket and `latest.json`, and deploy production sync.
**Decision:** Use separate tokens: in `web`, Workers scripts and the staging D1 only; in
`release`, R2 on `lelap-downloads`, production D1 and Workers. Android's signature check still
refuses an update not signed with the release key, which limits the damage to denial of service
and a changed release note.

### 22. Checked and fine (Info)

- Every third-party action is pinned to a full commit SHA with its version in a comment.
- Every workflow has `permissions: contents: read`; jobs widen only what they need (`id-token`,
  `attestations`, `packages`, `contents: write` for the GitHub release, `pull-requests: read` for
  the path filter).
- No `pull_request_target`; checkouts use `persist-credentials: false`.
- `web` allows only `main`; `release` allows only `v*` tags and needs a reviewer. A tag ruleset
  lets only organisation admins create, move or delete `v*` tags. `main` requires a pull request
  and the CI check. Default workflow token permissions are read-only, and Actions can't approve
  pull requests.
- Artifacts: the web build (public anyway), the signed APK (published anyway) and Android test
  reports on failure. No secrets in artifacts.
- `scripts/release.mts` parses the tag before using it, so a crafted tag name can't reach a shell.

## 4. Android app

### 5. Custom playback commands from any app (Medium, fixed)

**Where:** `modules/audio/android/.../PlaybackService.kt` (`onConnect`).
**What:** The playback service is exported (system UI, Bluetooth and Android Auto need that) and
gave every controller Lelap's custom commands. Any installed app could load a book from any URL,
replace Up Next or change settings.
**Fix:** Only controllers from Lelap's own package get the custom commands; others get the standard
session, library and player commands. Media buttons, the notification (Lelap's own package) and
Android Auto use standard commands. Device check listed in the follow-ups.

### 6. Secrets in plain SQLite and in backups (Medium, fixed on Android)

**Where:** `sync_state.value` (group key), `library_roots.remote` (WebDAV passwords, S3 secret
keys), WorkManager job data (the WebDAV header for queued downloads), `android:allowBackup="true"`
in the generated manifest.
**What:** App-private storage keeps other apps out, but Android's cloud and device-to-device
backups copied the database, so the keys and passwords travelled with every backup. On the web they
sit in the OPFS database, readable by any script that runs on the origin (the CSP in 8 is the
defence).
**Fix (Android):**

- A random 32-byte key lives in `expo-secure-store` (encrypted with an Android Keystore key, which
  can't be exported). `packages/core/src/secrets.ts` seals the group key and the server's password
  or secret key with it (XChaCha20-Poly1305, `sec1:` prefix) before they are written; the rest of
  the row stays readable. Sealing is in `getMembership`/`saveMembership` and
  `listRoots`/`addRemoteRoot`/`updateRemoteRoot`, so callers are unchanged.
- On the first start after the update, `sealStoredSecrets` seals values stored in plain text.
- Backups (`plugins/withBackupRules.js`) keep the library, places and settings but leave out the
  key store and WorkManager's database. expo-secure-store's own backup rules are off: they back up
  only shared preferences, which would have dropped the database from backups altogether.
- Restored on a new phone, the key is missing, so a new one is made. Sync stops and the Sync screen
  says to pair again; a server shows “Password needed” in Settings and “Log in” enters it again
  without losing its books or places.
- If the key store can't be read, sealed secrets stay unread for that run and nothing is cleaned
  up.

**Web (decision):** browsers have no store a page's own scripts can't read. A non-extractable
WebCrypto key would only stop someone copying the browser profile, and its async API would make
every secret read async in core. The web build keeps secrets as they are; the CSP is its defence.

### 12. Updater download without a size cap (Low, fixed)

**Where:** `modules/updater/.../UpdaterModule.kt`, `Checksum.kt`.
**What:** The APK was copied until the server stopped, then hashed. A wrong or hostile server could
fill the disk before the size check.
**Fix:** `Checksum.copyLimited` stops past the size in `latest.json` and deletes the partial file.
JVM test added.

### 17. Plain http in release builds (Low, decision)

**Where:** generated `AndroidManifest.xml`.
**What:** Release builds target a current SDK and do not set `usesCleartextTraffic`, so Android
refuses plain-http connections. Debug builds allow them (`src/debug/AndroidManifest.xml`), so
testing on a debug build hides this. Podcast feeds and audio still on `http://`, and WebDAV servers
on a home network without TLS, will fail in release.
**Decision:** Keeping cleartext off is the safer default and matches the web build (browsers block
mixed content). A network security config can only allow cleartext for hosts known at build time,
so for user-added hosts the choice is all or nothing. Either keep it off and say “This server
needs https” where an `http://` address is added, or allow cleartext (`expo-build-properties`)
and accept that feeds, audio and WebDAV logins can then travel unencrypted.

### 21. Updater and the rest (Info, checked)

- **Updater:** `https` is required on every redirect hop; SHA-256 and size are checked before the
  install; `setAppPackageName` pins the session to Lelap; `USER_ACTION_NOT_REQUIRED` only works for
  updates of the installer itself; the result receiver is not exported; Android rejects updates
  signed with another key and lower version codes.
- **Exported components:** `PlaybackService` (needed, see 5), `MediaButtonReceiver` (needed for
  headphones), `MainActivity` (launcher). `InstallResultReceiver` is not exported.
- **Downloads:** WebDAV logins go only to the original host and scheme, never to a redirect
  target. S3 objects use pre-signed links (seven days), stored with the job.
- **WebView:** none in the app or its dependencies.

## 5. Web app

### 8. No CSP or security headers (Medium, fixed)

**Where:** `apps/app/scripts/fix-web-export.mjs`, `docker/web.Dockerfile`, `docker/Caddyfile`.
**What:** The web app keeps the sync key and server passwords in its database, so script injection
would expose them. Pages served no CSP and no other security headers.
**Fix:** The post-export step writes `dist-web/_headers` for Cloudflare Pages, built from the same
`src/config.ts` as the app. The Docker image gets the same headers as a Caddy snippet. Policy:

- `script-src 'self' 'wasm-unsafe-eval'`: the export's own files and sql.js's WebAssembly; no inline
  script, no `eval`.
- `style-src 'self' 'unsafe-inline'`: react-native-web inserts `<style>` elements at run time.
- `connect-src 'self'`, the configured proxy, sync, downloads and add-on hosts, and `https:`.
- `img-src` and `media-src` allow `https:`, `blob:` (OPFS downloads) and `data:` for images.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` (camera, microphone, geolocation, payment, USB, topics off),
  `Cross-Origin-Opener-Policy: same-origin`.

**Decision included:** `connect-src`, `img-src` and `media-src` can't be narrowed to the configured
hosts: add-ons, WebDAV servers, S3 buckets, covers and audio live on hosts the user chooses. The
policy's value is in what may run, not where data may go. HSTS is left to Cloudflare's dashboard
(“Always use HTTPS” and HSTS on the zone), since it affects every subdomain.

**Checked:** the export has no inline scripts. The build was served with `wrangler pages dev` (new
launch configuration `web-dist`, with `proxy`, `sync` and `catalog`): Home and a book page load,
covers show, a LibriVox book plays, a feed loads through the proxy, sync starts, syncs and shows a
pairing code, with no CSP violations; a request to an unlisted plain-http host is blocked.

## 6. Dependencies

### 19. Two moderate advisories in build tools (Low, decision)

`pnpm audit` on 17 November 2026:

- **esbuild ≤ 0.24.2** (GHSA-67mh-4wv8-2f99): the dev server answers any website. It comes in
  through `drizzle-kit` → `@esbuild-kit/*`, used only to generate migrations, never as a server.
  Not reachable; goes away when `drizzle-kit` drops `@esbuild-kit`.
- **minimatch 7–11.0.0** (GHSA-g3hv-75wg-m249): denial of service with crafted glob patterns, via
  `@expo/fingerprint` and other build tools. Patterns come from the repository, not from users.

Neither ships in the app, the services or the images. No action beyond Dependabot.
