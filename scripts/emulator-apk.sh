#!/usr/bin/env bash
# Builds an unsigned x86_64 release APK for the emulator smoke test (M94), and copies it to
# OUT_DIR/lelap-emulator.apk. Never shipped: releases are arm64 and armv7 only, built by
# unsigned-apk.sh. The x86_64 emulator can't use the arm64 APK: its native libraries stay inside
# the APK (M54), and SoLoader only looks there for the emulator's own CPU type.
# Run from the repository root after `pnpm install`; needs JDK 21 and the Android SDK.
#   scripts/emulator-apk.sh OUT_DIR
set -euo pipefail

out="${1:?usage: emulator-apk.sh OUT_DIR}"

pnpm --filter @lelap/app exec expo prebuild --platform android --no-install --clean
# Unsigned whatever the environment holds: withReleaseSigning signs when it sees a keystore.
unset LELAP_KEYSTORE_PATH
(cd apps/app/android && LELAP_UNSIGNED=1 ./gradlew --no-daemon :app:assembleRelease \
  -PreactNativeArchitectures=x86_64)

mkdir -p "$out"
cp apps/app/android/app/build/outputs/apk/release/app-release-unsigned.apk "$out/lelap-emulator.apk"
ls -l "$out/lelap-emulator.apk"
