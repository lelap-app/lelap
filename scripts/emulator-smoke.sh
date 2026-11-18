#!/usr/bin/env bash
# Smoke test of a release APK on a running emulator (M94): signs it with a throwaway key, installs
# it, starts the app and checks that it opens Home and the Library without a crash. Logs and the
# last screen go to OUT_DIR either way.
#   scripts/emulator-smoke.sh APK OUT_DIR
# Needs adb on PATH, and apksigner and keytool (Android build-tools and a JDK).
set -euo pipefail

apk="${1:?usage: emulator-smoke.sh APK OUT_DIR}"
out="${2:?usage: emulator-smoke.sh APK OUT_DIR}"
package='app.lelap'
mkdir -p "$out"
work="$(mktemp -d)"

tools="${ANDROID_HOME:?ANDROID_HOME is not set}/build-tools/$(ls -1 "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)"

# An unsigned APK won't install. This key exists for one run and signs nothing that ships.
keytool -genkeypair -keystore "$work/smoke.jks" -storepass smoke-test -keypass smoke-test \
  -alias smoke -keyalg RSA -keysize 2048 -validity 1 -dname 'CN=Lelap smoke test' > /dev/null 2>&1
"$tools/apksigner" sign --ks "$work/smoke.jks" --ks-pass pass:smoke-test \
  --out "$work/smoke.apk" "$apk"

retry() {
  local tries="$1"
  shift
  for i in $(seq 1 "$tries"); do
    if "$@"; then return 0; fi
    echo "Attempt $i of $tries failed: $*" >&2
    sleep 5
  done
  return 1
}

finish() {
  local status=$?
  adb logcat -d > "$out/logcat.txt" 2>&1 || true
  adb logcat -d -b crash > "$out/crash.txt" 2>&1 || true
  adb exec-out screencap -p > "$out/screen.png" 2>/dev/null || true
  rm -rf "$work"
  exit "$status"
}
trap finish EXIT

adb wait-for-device
# It uninstalls Lelap first, which would wipe a real phone's library.
if [ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ] &&
  [ "$(adb shell getprop ro.boot.qemu | tr -d '\r')" != 1 ]; then
  echo '::error::Not an emulator. With a phone attached too, set ANDROID_SERIAL.' >&2
  exit 1
fi
# Until the package manager answers, an install fails at random on a fresh emulator.
retry 30 adb shell pm path android > /dev/null
adb uninstall "$package" > /dev/null 2>&1 || true
# -g grants runtime permissions, so the notification prompt doesn't cover the screen.
retry 3 adb install -r -g "$work/smoke.apk"

adb logcat -c

# The screen's text, as the accessibility tree has it.
screen() {
  adb shell uiautomator dump /sdcard/window.xml > /dev/null 2>&1 &&
    adb shell cat /sdcard/window.xml 2>/dev/null
}

alive() {
  [ -n "$(adb shell pidof "$package" | tr -d '\r')" ]
}

# A busy emulator often shows “System UI isn't responding” over everything; “Wait” dismisses it.
# Lelap's own “isn't responding” dialog is left alone, so the test fails on it.
dismiss_system_anr() {
  local xml="$1" bounds
  grep -q "System UI isn.t responding" <<< "$xml" || return 0
  bounds="$(grep -o 'text="Wait"[^>]*bounds="[^"]*"' <<< "$xml" | grep -o '\[[0-9,]*\]\[[0-9,]*\]' || true)"
  [ -n "$bounds" ] || return 0
  read -r x1 y1 x2 y2 <<< "$(tr '[],' '   ' <<< "$bounds")"
  echo 'Dismissing “System UI isn'\''t responding”.'
  adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}

# Waits up to [seconds] for [text] on screen, failing early if the app died.
wait_for_text() {
  local text="$1" seconds="$2" xml
  local deadline=$((SECONDS + seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    xml="$(screen || true)"
    if grep -q -- "$text" <<< "$xml"; then return 0; fi
    dismiss_system_anr "$xml"
    if ! alive; then
      echo "::error::The app stopped while waiting for “$text”" >&2
      return 1
    fi
    sleep 1
  done
  echo "::error::“$text” did not appear within $seconds s" >&2
  screen > "$out/window.xml" || true
  return 1
}

crashed() {
  if adb logcat -d -b crash | grep -q "Process: $package"; then
    echo "::error::The app crashed; see crash.txt" >&2
    return 0
  fi
  if adb logcat -d -s ReactNativeJS:E | grep -qi 'fatal'; then
    echo "::error::A fatal JavaScript error; see logcat.txt" >&2
    return 0
  fi
  return 1
}

adb shell am start -W -n "$package/.MainActivity"
# The tab bar's labels: Home is up once the first screen has drawn.
wait_for_text 'text="Home"' 120
wait_for_text 'text="Library"' 10

adb shell am start -W -a android.intent.action.VIEW -d 'lelap://library' "$package"
# An empty library asks for a folder.
wait_for_text 'Choose your audiobooks folder' 60

# A crash a few seconds in still counts.
sleep 5
alive || {
  echo "::error::The app is no longer running" >&2
  exit 1
}
if crashed; then exit 1; fi
echo 'The app started and opened the Library.'
