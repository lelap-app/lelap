# M54 follow-ups

What is left of [M54 Faster builds, smaller APKs](milestones/m54.md).

Checked on a Mac (JDK 25 from Android Studio, warm Gradle cache), end to end with a throwaway
keystore made for the run: `scripts/unsigned-apk.sh` built the four unsigned APKs in a fresh
clone (direct and F-Droid, arm64 and 32-bit; 2.5 to 3 minutes each), `scripts/sign-apks.sh` checked
their SHA-256s and alignment and signed them, an APK changed after the build was refused, and
`scripts/release.mts info` wrote a release file listing both. Then
`scripts/verify-fdroid-apk.sh` rebuilt each F-Droid APK in its own fresh clone with the recipe's
commands, and `apksigcopier compare` matched both signed APKs: signing after the build gives the
bytes F-Droid's server checks. `aapt2` shows each APK with one CPU type and its own versionCode
(100052 for arm64, 100051 for 32-bit at 0.1.0-beta.5). Sizes: 37.5 MB for arm64 and 29.5 MB for 32-bit (0.1.0-beta.3, with four CPU types, was 109 MB).

`actionlint` passes on both workflows; every new action is pinned to a full SHA. Covered by tests:
per-CPU versionCodes above every earlier release, file names, old release files still read, the
fields apps from before M54 read pointing at the arm64 APK, each phone offered its own APK and not
the same version twice, nothing for a CPU the release lacks (core, Vitest); the choice from
`Build.SUPPORTED_ABIS` (`:lelap-updater:testDebugUnitTest`).

## How it works

- **Build** (`release.yml`, job `build`): a matrix of distribution × CPU type, no environment, no
  secrets. `.github/actions/unsigned-apk` restores the pnpm store and Gradle's downloaded
  dependencies (never build outputs) and runs `scripts/unsigned-apk.sh`, which stamps the
  version, prebuilds, runs Gradle with `-PreactNativeArchitectures=<abi>` and `LELAP_UNSIGNED=1`,
  and refuses an APK whose versionCode, CPU type or alignment is wrong. Each leg reports
  `<sha256>  <name>` as its own job output.
- **Caches:** only the `apk` job in `ci.yml` saves them, and only on pushes to `main`. On pull
  requests that touch native code the same job builds the arm64 APK as a check, reading the cache.
- **Sign** (`apk`, `apk-fdroid`, in `release`): download the two unsigned APKs, then
  `scripts/sign-apks.sh`: the files must be exactly the reported ones with the reported hashes;
  `zipalign -c -P 16 4` checks the alignment Gradle made (rewriting would change the bytes F-Droid
  compares); `apksigner sign --alignment-preserved`. These jobs install no packages and read no
  cache.
- **versionCode:** `versionCode()` times ten plus 1 (32-bit) or 2 (arm64), computed in Gradle from
  `app.json`'s code and the CPU type (`plugins/withArchitectures.js`) and checked against
  `release.mts apk` in the build. 64-bit is higher, so a phone that runs both prefers it.
- **Release file:** `apks` lists both; the top-level fields are the arm64 APK's.
- **Reproducible in another folder:** the first rebuild in a different folder did not match. Only
  the build IDs of the C++ libraries that library modules compile (Reanimated, Screens, Expo
  modules) differed: their debug info held this machine's paths, and the path mapping applied
  only to the app's own native code. `plugins/withReproducibleBuild.js` now maps the paths in
  every library module too. CI builds in `/home/runner/work/…` and F-Droid in its own folder, so
  this mattered before M54 as well.
- **F-Droid:** two `Builds` entries per version, each with its versionCode, `-PreactNativeArchitectures`
  and `binary:` URL; `VercodeOperation` makes both from the base code.

## With a tag

- The first tag after M54: the four build legs pass, the signing jobs' SHA-256 check passes (it
  relies on GitHub combining the per-leg outputs of a matrix job; if they don't combine it fails
  closed with “Unexpected line”). The GitHub release has four APKs, `SHA256SUMS` and
  `release.json`; `beta.json` lists both APKs; `beta.apk` and `beta-armv7.apk` download.
- Time: a tag with a warm cache and no native changes should have signed APKs within ten minutes
  of the tag (the milestone's goal). The local builds took 2.5 to 3 minutes each with a warm
  dependency cache; GitHub's runners are slower, and the four legs run in parallel.
- `scripts/verify-fdroid-apk.sh v<version>` on Linux against the release's two F-Droid APKs.
- The landing page's 32-bit link (`beta-armv7.apk`, `latest-armv7.apk`) exists only after the
  first M54 release of that channel. Set `LELAP_RELEASED` only after a stable M54 release.

## On a phone

- A 64-bit phone on 0.1.0-beta.4 or older finds the first M54 release in the app and installs the
  arm64 APK; the next release reaches it again.
- With an M54 build: a 64-bit phone is offered the arm64 APK; a 32-bit-only phone (Android Go)
  the `-armv7` one, and after installing it is not offered the same version again.
- `adb shell dumpsys package app.lelap | grep -E 'primaryCpuAbi|versionCode'` shows one CPU type
  and a versionCode ending in 2 (arm64) or 1 (32-bit).
- The direct APK and the F-Droid APK of the same CPU type install over each other.

## Known limits

- **Apps from before M54 on 32-bit-only phones** read only the top-level fields, so they download
  the arm64 APK, which Android refuses to install (`INSTALL_FAILED_NO_MATCHING_ABIS`), and are
  offered it again on every start. They need the `-armv7` APK installed by hand once. Few such
  phones run the beta; the release notes of the first M54 release should say so.
- The Gradle cache key comes from `pnpm-lock.yaml` only. A Gradle dependency change without a
  lockfile change keeps the old cache until the lockfile changes (slower, not wrong).
- F-Droid's automatic updates need the base versionCode from the source at the tag, which
  `app.json` doesn't hold (it is stamped in CI). Until `UpdateCheckData` points at something that
  has it, the two Builds entries per release are added by hand.

## Minor review findings left

- The build-tools version used for signing is the newest on the runner, not pinned; the printed
  certificate SHA-256 is not compared with `AllowedAPKSigningKeys`.
- Both direct legs set the `runtime` output; they are identical, and the `ota` job checks it again.
- `verify-fdroid-apk.sh` downloads with `--repo "$SOURCE"`, so a local path as `SOURCE` works only
  with APKs given on the command line.
- The `apk` job in `ci.yml` cancels with the rest of CI when `main` moves fast, so a save can be
  skipped; the next push saves it.
