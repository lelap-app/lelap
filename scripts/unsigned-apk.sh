#!/usr/bin/env bash
# Builds one unsigned release APK for one CPU type, with the same commands as F-Droid's recipe
# (docs/fdroid/app.lelap.yml), checks its versionCode and CPU type, and copies it to OUT_DIR
# under its release name. Run from the repository root after `pnpm install`; needs JDK 21 and
# the Android SDK. In GitHub Actions it also sets the step outputs `name`, `sha256` and, for the
# direct build, `runtime`.
#   scripts/unsigned-apk.sh direct|fdroid arm64-v8a|armeabi-v7a TAG OUT_DIR
set -euo pipefail

distribution="${1:?usage: unsigned-apk.sh direct|fdroid ABI TAG OUT_DIR}"
abi="${2:?usage: unsigned-apk.sh direct|fdroid ABI TAG OUT_DIR}"
tag="${3:?usage: unsigned-apk.sh direct|fdroid ABI TAG OUT_DIR}"
out="${4:?usage: unsigned-apk.sh direct|fdroid ABI TAG OUT_DIR}"
outputs="${GITHUB_OUTPUT:-/dev/null}"

# release.mts writes step outputs itself when GITHUB_OUTPUT is set; here it only prints.
release() { GITHUB_OUTPUT='' node scripts/release.mts "$@"; }

case "$distribution" in
  direct) unset EXPO_PUBLIC_LELAP_DISTRIBUTION; flavour='' ;;
  fdroid) export EXPO_PUBLIC_LELAP_DISTRIBUTION=fdroid; flavour=fdroid ;;
  *) echo "Unknown distribution: $distribution" >&2; exit 1 ;;
esac

apk_info="$(release apk "$tag" "$abi" ${flavour:+"$flavour"})"
name="$(sed -n 's/^name=//p' <<< "$apk_info")"
code="$(sed -n 's/^code=//p' <<< "$apk_info")"

release stamp "$tag" > /dev/null
pnpm --filter @lelap/app exec expo prebuild --platform android --no-install --clean

# The native fingerprint this APK is built with; the `ota` job publishes bundles for it.
if [ "$distribution" = direct ]; then
  runtime="$(pnpm --silent --filter @lelap/app exec expo-updates runtimeversion:resolve --platform android | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).runtimeVersion))')"
  echo "runtime=$runtime" >> "$outputs"
  echo "Runtime version: $runtime"
fi

(cd apps/app/android && LELAP_UNSIGNED=1 ./gradlew --no-daemon :app:assembleRelease \
  "-PreactNativeArchitectures=$abi")
built="apps/app/android/app/build/outputs/apk/release/app-release-unsigned.apk"

# A wrong versionCode or a second CPU type would reach phones that can't install it.
tools="${ANDROID_HOME:?ANDROID_HOME is not set}/build-tools/$(ls -1 "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)"
badging="$("$tools/aapt2" dump badging "$built")"
grep -q "versionCode='$code'" <<< "$badging" || {
  echo "::error::$name: versionCode is not $code" >&2
  exit 1
}
native="$(sed -n 's/^native-code: //p' <<< "$badging")"
[ "$native" = "'$abi'" ] || {
  echo "::error::$name: native code for $native, not '$abi'" >&2
  exit 1
}

mkdir -p "$out"
cp "$built" "$out/$name"
sha256="$( (cd "$out" && sha256sum -- "$name") | cut -d' ' -f1)"
{
  echo "name=$name"
  echo "sha256=$sha256"
} >> "$outputs"
echo "$sha256  $name"
