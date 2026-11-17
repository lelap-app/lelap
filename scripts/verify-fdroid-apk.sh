#!/usr/bin/env bash
# Rebuilds the F-Droid APK of a release from source and checks it against the signed one on
# GitHub Releases, the way F-Droid's build server does. Needs Node 24, pnpm, JDK 21, the Android
# SDK and apksigcopier (`pip install apksigcopier`).
#   scripts/verify-fdroid-apk.sh v1.2.3 [path/to/lelap-1.2.3-fdroid.apk]
set -euo pipefail

tag="${1:?usage: verify-fdroid-apk.sh TAG [SIGNED_APK]}"
version="${tag#v}"
repo="$(git config --get remote.origin.url)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

signed="${2:-}"
if [ -z "$signed" ]; then
  signed="$work/signed.apk"
  gh release download "$tag" --repo "$repo" --pattern "lelap-$version-fdroid.apk" --output "$signed"
fi

git clone --quiet --depth 1 --branch "$tag" "$repo" "$work/src"
cd "$work/src"
corepack enable
pnpm install --frozen-lockfile
node scripts/release.mts stamp "$tag"
export EXPO_PUBLIC_LELAP_DISTRIBUTION=fdroid LELAP_UNSIGNED=1
pnpm --filter @lelap/app exec expo prebuild --platform android --no-install
(cd apps/app/android && ./gradlew --no-daemon :app:assembleRelease)
built="apps/app/android/app/build/outputs/apk/release/app-release-unsigned.apk"

apksigcopier compare "$signed" --unsigned "$built"
echo "Reproducible: the signed APK matches a build of $tag from source."
