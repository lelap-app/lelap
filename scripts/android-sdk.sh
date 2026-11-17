#!/usr/bin/env bash
# Installs the Android SDK parts the build needs before Gradle runs, with retries. Left to
# Gradle, a download that arrives broken fails the whole build halfway ("Archive is not a ZIP
# archive"). The versions come from React Native's own catalog, so they follow upgrades.
set -euo pipefail

rn="$(node -p "path.dirname(require.resolve('react-native/package.json', { paths: ['apps/app'] }))")"
toml="$rn/gradle/libs.versions.toml"
value() { sed -nE "s/^$1 = \"([^\"]+)\"/\1/p" "$toml"; }
compile="$(value compileSdk)"
build_tools="$(value buildTools)"
ndk="$(value ndkVersion)"
# Android 16 and later name platforms with a minor version (android-36.1, android-37.0).
[[ "$compile" == *.* ]] || compile="$compile.0"
packages=("platforms;android-$compile" "build-tools;$build_tools" "ndk;$ndk")

sdkmanager="${ANDROID_HOME:?ANDROID_HOME is not set}/cmdline-tools/latest/bin/sdkmanager"
# `yes` ends with SIGPIPE once the licenses are accepted; that is not a failure.
(yes || true) | "$sdkmanager" --licenses > /dev/null || true

for attempt in 1 2 3; do
  if "$sdkmanager" --install "${packages[@]}" > /dev/null; then
    echo "Android SDK ready: ${packages[*]}"
    exit 0
  fi
  echo "::warning::sdkmanager failed (attempt $attempt of 3); retrying"
  sleep $((attempt * 15))
done
echo "::error::Could not install ${packages[*]}"
exit 1
