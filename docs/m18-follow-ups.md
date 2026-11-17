# M18 follow-ups

What is left of [M18 Updates over the air](roadmap.md#m18-updates-over-the-air): one-time setup
that needs the maintainer's accounts, and checks on a phone.

## How it works

- **App** (`apps/app/app.config.js`, `src/ota.ts`): `expo-updates` with `runtimeVersion` from the
  native fingerprint, `updates.url` = `https://updates.<EXPO_PUBLIC_LELAP_DOMAIN>/manifest`
  (`EXPO_PUBLIC_LELAP_UPDATES` overrides the base), and the code-signing certificate in
  `apps/app/certs/certificate.pem`. Without that file, updates are off: such a build never loads
  code from the network. The app checks on start and when it comes back after 30 minutes, downloads
  in the background and starts the new bundle on the next cold start. Settings → Updates →
  “Download updates automatically” turns this off; “Check” looks for an APK first, then a bundle.
  The channel is `beta` when “Beta versions” is on or the APK is a beta, else `production`.
- **Service** (`services/updates`, Worker `lelap-updates`): answers the Expo Updates protocol 1
  from the downloads bucket. It returns the signed manifest as `multipart/mixed` with the
  `expo-signature` header, or `204` when there is nothing newer. It holds no secret.
- **Release** (`release.yml`, job `ota`): exports the Android bundle, checks that its runtime
  version equals the APK's, writes and signs the manifest with `scripts/ota.mts`, and uploads to
  `lelap-downloads`: `ota/<runtime>/<id>/<md5>.<ext>` (immutable), then
  `ota/channels/<channel>/<runtime>.json`. Stable tags publish to `production` and `beta`, beta
  tags to `beta` only. Bundles are served from the downloads host (`DOWNLOADS_BASE`).

**Why a Worker and not static files on R2:** the protocol puts the signature in a header of the
manifest part, and the client sends its runtime version and channel as headers. A public bucket
can't choose a file by request header or set a per-part header, so a small Worker reads the record
from R2 and frames the response. The bundles themselves are static and go straight from R2.

## 1. Setup (once)

1. **Code-signing key pair.** Generate it on your own machine, with the private key outside the
   repository:

   ```sh
   cd apps/app
   npx expo-updates codesigning:generate \
     --key-output-directory ~/lelap-ota-keys \
     --certificate-output-directory certs \
     --certificate-validity-duration-years 10 \
     --certificate-common-name "Lelap"
   ```

   Commit `apps/app/certs/certificate.pem` (public). Keep `~/lelap-ota-keys/private-key.pem` in
   your password manager; `public-key.pem` is not needed. The certificate is part of the native
   fingerprint, so adding it starts a new runtime version: the first APK built with it is the first
   that takes bundles.

2. **CI secret** in the `release` environment:

   ```sh
   gh secret set OTA_SIGNING_KEY --env release < ~/lelap-ota-keys/private-key.pem
   ```

3. **Host for the Worker.** Add `UPDATES_DOMAIN` = `updates.lelap.app` as a variable in the `web`
   environment; the next push to `main` that touches `services/updates` (or a manual run of
   “Deploy services”) deploys `lelap-updates` with that custom domain, which also creates the DNS
   record. The Workers token needs R2 read on `lelap-downloads` (it already writes to it).

   ```sh
   gh variable set UPDATES_DOMAIN --env web --body updates.lelap.app
   ```

4. **Forks and self-hosters** generate their own pair, commit their own certificate, build with
   `EXPO_PUBLIC_LELAP_DOMAIN` (or `EXPO_PUBLIC_LELAP_UPDATES`), and either deploy the Worker or run
   the `updates` image (see [`docker/README.md`](../docker/README.md)).

If the key is lost or leaks: generate a new pair, commit the new certificate and release a new APK.
Devices only trust bundles signed for the certificate their APK was built with.

## 2. Checks on a phone

None of this has run on a device yet.

- **First bundle:** install a signed release APK from a tag built with the certificate. Tag a
  JavaScript-only change (for example a text in Settings) as the next version. Open the app, wait a
  minute, close it fully, open it: the change shows, and Settings → Updates says “Running update
  ….” A fresh install of the new APK should not download the same bundle again.
- **Resume:** with the app in the background for 30 minutes, publish another bundle; coming back
  downloads it; it starts on the next cold start, not while a book plays.
- **Switch off:** with “Download updates automatically” off, nothing downloads (check the Worker's
  logs); “Check” still does.
- **Beta:** turn on “Beta versions” on a stable APK, publish a beta tag with the same runtime; the
  beta bundle arrives. A later stable tag reaches it too.
- **Bad signature:** serve a record with a wrong signature (`wrangler r2 object put` a copy with one
  byte changed in `signature`): the app must refuse it and keep running the old bundle.
- **Native change:** a release that changes native code (a new module) gets a new runtime version;
  older APKs must not get its bundle (the Worker answers `204` for their runtime).
- **Crash recovery:** a bundle that throws on start makes expo-updates fall back to the previous
  one on the next launch.

## 3. Known limits

- A JavaScript-only release still builds a new APK, so the APK updater offers it as well; installing
  it is harmless but not needed. A later change could skip `latest.json` when the runtime version is
  unchanged.
- No bsdiff patches: every update downloads the whole bundle (about 6 MB) and only the assets it
  does not have yet.
- Old bundles stay in the bucket; nothing removes them yet.
