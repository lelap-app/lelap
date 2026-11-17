# M8 follow-ups

What is left of [M8 Release pipeline](milestones/m8.md). Nothing here has run on a
tag yet.

## 1. Setup before the first tag

In the `release` environment (tags only, required reviewer):

| Name                           | Kind     | What                                                           |
| ------------------------------ | -------- | -------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`      | secret   | `base64 -i release.keystore`; `CN=Lelap`, keep an offline copy |
| `ANDROID_KEYSTORE_PASSWORD`    | secret   | Keystore password                                              |
| `ANDROID_KEY_ALIAS`            | secret   | Key alias                                                      |
| `ANDROID_KEY_PASSWORD`         | secret   | Key password                                                   |
| `CLOUDFLARE_WORKERS_API_TOKEN` | secret   | Workers, D1 and R2 edit (separate from the Pages token)        |
| `CLOUDFLARE_ACCOUNT_ID`        | variable | Same as in `web`                                               |
| `DOWNLOADS_BASE`               | variable | `https://dl.lelap.app`                                         |
| `SYNC_DOMAIN`                  | variable | `sync.lelap.app`                                               |
| `LELAP_DOMAIN`                 | variable | Optional; `lelap.app` when unset                               |

Cloudflare: R2 bucket `lelap-downloads` public on `dl.lelap.app` (needs a payment method on the
account), D1 `lelap-sync` (see [M7 follow-ups](m7-follow-ups.md)).

GitHub: the `ghcr.io/lelap-app/*` packages appear on the first run; make them public.

## 2. Checks

| #   | Check                                                                             | Status                      |
| --- | --------------------------------------------------------------------------------- | --------------------------- |
| 1   | A release APK builds (JavaScript bundled, R8, signing plugin)                     | Pass locally (debug-signed) |
| 2   | Bundled Node servers for catalog, proxy and sync answer                           | Pass locally                |
| 3   | Docker images build                                                               | Not run (no Docker daemon)  |
| 4   | `v0.1.0-beta.1`: workflow publishes APK, `beta.json`, release, images             | Not run                     |
| 5   | Updater: an older build finds the beta, asks for the install permission, installs | Not run                     |
| 6   | **Done-when:** install from `lelap.app`, receive an update without help           | Not run                     |

The landing page links to the APK only once `site.released` is true (see `apps/site/AGENTS.md`).

## 3. Left out of this pass: OTA bundles

Done in M18; see [`m18-follow-ups.md`](m18-follow-ups.md).

`expo-updates` with a self-hosted server and code signing changes how release builds start, and
could not be tried on a phone, so it is not in this pass. The plan:

- CI exports the JavaScript bundle per runtime version, writes the manifest body (ID, runtime
  version, launch asset and assets on `dl.lelap.app/ota/…`) and signs it with an RSA key from
  the `release` environment; manifest and signature go to R2.
- Worker `lelap-updates` on `updates.lelap.app` answers the Expo Updates protocol from R2 (the
  multipart manifest with `expo-signature`), per channel (`production`, `beta`). It needs no
  secret: signing happens in CI.
- The app gets `expo-updates` with `updates.url`, `runtimeVersion` from the native fingerprint,
  and the code-signing certificate.

## 4. Known limits

- The APK is one universal build; per-ABI splits would make it smaller.
- Base images are pinned by digest; Dependabot's `docker` entry keeps them current.
- The updater trusts `latest.json` over HTTPS plus the SHA-256 in it; Android itself refuses an
  APK signed with another key.
