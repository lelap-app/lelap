#!/usr/bin/env bash
# Rebuilds the F-Droid APKs of a release from source and checks each against our signed one, the
# way F-Droid's build server does: a fresh checkout per CPU type, the recipe's commands
# (docs/fdroid/app.lelap.yml), then apksigcopier copies our signature onto the unsigned build and
# the result must verify. Needs Node 24, pnpm, JDK 21, the Android SDK and apksigcopier
# (`pip install apksigcopier`).
#   scripts/verify-fdroid-apk.sh v1.2.3 [SIGNED_APK ...]
# Without APKs it downloads both F-Droid APKs of the tag from GitHub Releases. An APK whose name
# ends in -armv7.apk is rebuilt for armeabi-v7a, any other for arm64-v8a. SOURCE (a git URL or
# path; default this repository's origin) and REF (a tag or branch; default the tag) rebuild from
# elsewhere, for example a branch signed locally before it is tagged.
set -euo pipefail

tag="${1:?usage: verify-fdroid-apk.sh TAG [SIGNED_APK ...]}"
shift
version="${tag#v}"
source="${SOURCE:-$(git config --get remote.origin.url)}"
ref="${REF:-$tag}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

signed=()
for apk in "$@"; do signed+=("$(cd "$(dirname "$apk")" && pwd)/$(basename "$apk")"); done
if [ ${#signed[@]} -eq 0 ]; then
  for name in "lelap-$version-fdroid.apk" "lelap-$version-fdroid-armv7.apk"; do
    gh release download "$tag" --repo "$source" --pattern "$name" --output "$work/$name"
    signed+=("$work/$name")
  done
fi

for apk in "${signed[@]}"; do
  case "$apk" in
    *-armv7.apk) abi=armeabi-v7a ;;
    *) abi=arm64-v8a ;;
  esac
  src="$work/src-$abi"
  git clone --quiet --depth 1 --branch "$ref" "$source" "$src"
  (
    cd "$src"
    corepack enable
    pnpm install --frozen-lockfile
    node scripts/release.mts stamp "$tag"
    export EXPO_PUBLIC_LELAP_DISTRIBUTION=fdroid LELAP_UNSIGNED=1
    pnpm --filter @lelap/app exec expo prebuild --platform android --no-install
    cd apps/app/android
    ./gradlew --no-daemon :app:assembleRelease "-PreactNativeArchitectures=$abi"
  )
  built="$src/apps/app/android/app/build/outputs/apk/release/app-release-unsigned.apk"
  apksigcopier compare "$apk" --unsigned "$built"
  echo "Reproducible ($abi): $(basename "$apk") matches a build of $ref from source."
done
