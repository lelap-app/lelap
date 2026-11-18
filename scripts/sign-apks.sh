#!/usr/bin/env bash
# Signs the unsigned APKs the build job made, after checking they are the files it hashed.
# EXPECTED lists `sha256  name` per APK, as the build job reported them; IN_DIR must hold exactly
# those files. Signing only adds the APK signing block, so the result is the unsigned APK plus
# our signature: what F-Droid's server checks when it rebuilds the APK from source. Needs the
# Android SDK's build-tools and the keystore in LELAP_KEYSTORE_PATH, LELAP_KEYSTORE_PASSWORD,
# LELAP_KEY_ALIAS and LELAP_KEY_PASSWORD.
#   scripts/sign-apks.sh EXPECTED IN_DIR OUT_DIR
set -euo pipefail

expected="$(cd "$(dirname "${1:?usage: sign-apks.sh EXPECTED IN_DIR OUT_DIR}")" && pwd)/$(basename "$1")"
in="${2:?usage: sign-apks.sh EXPECTED IN_DIR OUT_DIR}"
out="${3:?usage: sign-apks.sh EXPECTED IN_DIR OUT_DIR}"
: "${LELAP_KEYSTORE_PATH:?}" "${LELAP_KEYSTORE_PASSWORD:?}" "${LELAP_KEY_ALIAS:?}" "${LELAP_KEY_PASSWORD:?}"
tools="${ANDROID_HOME:?ANDROID_HOME is not set}/build-tools/$(ls -1 "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)"

# Each line a hash and a plain file name, so nothing else reaches the commands below.
if grep -Evxq '[0-9a-f]{64}  lelap-[0-9A-Za-z.-]+\.apk' "$expected"; then
  echo "::error::Unexpected line in $expected" >&2
  exit 1
fi
if [ "$(ls -1 "$in" | sort)" != "$(cut -c 67- "$expected" | sort)" ]; then
  echo "::error::$in does not hold exactly the APKs the build job reported" >&2
  exit 1
fi
(cd "$in" && sha256sum --strict --check "$expected")

mkdir -p "$out"
while read -r _ name; do
  # Gradle already aligned the APK (4 bytes, native libraries to 16 KB pages). Only check it:
  # rewriting it would change the bytes F-Droid compares with its own build.
  "$tools/zipalign" -c -P 16 4 "$in/$name"
  # No v4 signature: it is a separate .idsig file that only `adb install --incremental` uses.
  "$tools/apksigner" sign --alignment-preserved --v4-signing-enabled false \
    --ks "$LELAP_KEYSTORE_PATH" --ks-key-alias "$LELAP_KEY_ALIAS" \
    --ks-pass env:LELAP_KEYSTORE_PASSWORD --key-pass env:LELAP_KEY_PASSWORD \
    --out "$out/$name" "$in/$name"
  "$tools/apksigner" verify --print-certs "$out/$name" | grep -i 'SHA-256'
  echo "Signed $name"
done < "$expected"
