#!/usr/bin/env bash
# Signs the unsigned APKs the build job made, after checking they are the files it hashed.
# EXPECTED lists `sha256  name` per APK, as the build job reported them; IN_DIR must hold exactly
# those files. Signing only adds the APK signing block, so the result is the unsigned APK plus
# our signature: what F-Droid's server checks when it rebuilds the APK from source. Each signed
# APK must carry the one certificate in AllowedAPKSigningKeys (docs/fdroid/app.lelap.yml). Needs
# the keystore in LELAP_KEYSTORE_PATH, LELAP_KEYSTORE_PASSWORD, LELAP_KEY_ALIAS and
# LELAP_KEY_PASSWORD, and the pinned build-tools below, which `--install-tools` installs before
# any secret is around.
#   scripts/sign-apks.sh --install-tools
#   scripts/sign-apks.sh EXPECTED IN_DIR OUT_DIR
set -euo pipefail

# Pinned, so a runner image update never changes the tools that sign. Raise it on purpose.
build_tools=37.0.0
tools="${ANDROID_HOME:?ANDROID_HOME is not set}/build-tools/$build_tools"
root="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = --install-tools ]; then
  if [ -x "$tools/apksigner" ]; then
    echo "build-tools $build_tools already installed"
    exit 0
  fi
  sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  # `yes` ends with SIGPIPE once the licenses are accepted; that is not a failure.
  (yes || true) | "$sdkmanager" --licenses > /dev/null || true
  for attempt in 1 2 3; do
    if "$sdkmanager" --install "build-tools;$build_tools" > /dev/null; then
      echo "build-tools $build_tools installed"
      exit 0
    fi
    echo "::warning::sdkmanager failed (attempt $attempt of 3); retrying"
    sleep $((attempt * 15))
  done
  echo "::error::Could not install build-tools $build_tools"
  exit 1
fi

expected="$(cd "$(dirname "${1:?usage: sign-apks.sh EXPECTED IN_DIR OUT_DIR}")" && pwd)/$(basename "$1")"
in="${2:?usage: sign-apks.sh EXPECTED IN_DIR OUT_DIR}"
out="${3:?usage: sign-apks.sh EXPECTED IN_DIR OUT_DIR}"
: "${LELAP_KEYSTORE_PATH:?}" "${LELAP_KEYSTORE_PASSWORD:?}" "${LELAP_KEY_ALIAS:?}" "${LELAP_KEY_PASSWORD:?}"
[ -x "$tools/apksigner" ] || {
  echo "::error::build-tools $build_tools is missing; run scripts/sign-apks.sh --install-tools" >&2
  exit 1
}
allowed="$(sed -nE 's/^AllowedAPKSigningKeys: *([0-9a-f]{64}) *$/\1/p' "$root/docs/fdroid/app.lelap.yml")"
[ -n "$allowed" ] || {
  echo "::error::No AllowedAPKSigningKeys in docs/fdroid/app.lelap.yml" >&2
  exit 1
}

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
  # One certificate, the one F-Droid expects: another key would ship APKs that neither F-Droid
  # nor installed apps accept. apksigner prints a line per signer and scheme (`V2 Signer: …`).
  certs="$("$tools/apksigner" verify --print-certs "$out/$name" |
    sed -nE 's/.*certificate SHA-256 digest: ([0-9a-f]{64})$/\1/p' | sort -u)"
  if [ "$certs" != "$allowed" ]; then
    rm -f "$out/$name"
    echo "::error::$name is signed with '${certs//$'\n'/, }', not the certificate in AllowedAPKSigningKeys ($allowed)" >&2
    exit 1
  fi
  echo "Signed $name with certificate SHA-256 $certs"
done < "$expected"
