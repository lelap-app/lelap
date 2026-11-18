#!/usr/bin/env bash
# Smoke test of a release APK on a running emulator (M94): signs it with a throwaway key, installs
# it, starts the app, skips the first-start welcome and checks that it opens Home and the Library
# without a crash. Then (M110) it pushes a short book, chooses its folder through the system folder
# picker, waits for the scan and plays it until the player says so in logcat. Logs and the last
# screen go to OUT_DIR either way; on a failure the end of logcat is printed too.
#   scripts/emulator-smoke.sh APK OUT_DIR
# Needs adb on PATH, apksigner and keytool (Android build-tools and a JDK), and python3.
set -euo pipefail

apk="${1:?usage: emulator-smoke.sh APK OUT_DIR}"
out="${2:?usage: emulator-smoke.sh APK OUT_DIR}"
package='app.lelap'
mkdir -p "$out"
work="$(mktemp -d)"

# The newest release of the build tools, not a preview.
tools="${ANDROID_HOME:?ANDROID_HOME is not set}/build-tools/$(ls -1 "$ANDROID_HOME/build-tools" | grep -E '^[0-9.]+$' | sort -V | tail -n 1)"

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
  # The CI log shows why without downloading the artifact.
  if [ "$status" != 0 ]; then
    echo '::group::Last screen (text)'
    screen 2>/dev/null | grep -o 'text="[^"]\+"' | head -60 || true
    echo '::endgroup::'
    echo '::group::Logcat (last 150 lines)'
    tail -n 150 "$out/logcat.txt" || true
    echo '::endgroup::'
  fi
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
# The same device for every later call, even if a phone is plugged in meanwhile.
ANDROID_SERIAL="${ANDROID_SERIAL:-$(adb get-serialno)}"
export ANDROID_SERIAL
# Built for the emulator's own CPU type (emulator-apk.sh): ARM translation can't load native
# libraries that stay inside the APK.
abi="$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
native="$("$tools/aapt2" dump badging "$apk" | sed -n 's/^native-code: //p')"
if ! grep -q "'$abi'" <<< "$native"; then
  echo "::error::The APK has native code for $native, the emulator runs $abi." >&2
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
  # Never an earlier screen: a failed dump may leave the last file in place.
  adb shell rm -f /sdcard/window.xml > /dev/null 2>&1 || true
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
  grep -Eq 'System UI isn.{1,6}t responding' <<< "$xml" || return 0
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

# Logs are read whole before grep: with pipefail, grep -q leaving early would fail the pipe.
crashed() {
  local log
  log="$(adb logcat -d -b crash)"
  if grep -q "Process: $package" <<< "$log"; then
    echo "::error::The app crashed; see crash.txt" >&2
    return 0
  fi
  log="$(adb logcat -d -s ReactNativeJS:E)"
  if grep -qi 'fatal' <<< "$log"; then
    echo "::error::A fatal JavaScript error; see logcat.txt" >&2
    return 0
  fi
  return 1
}

# Taps the first element in [xml] whose [attribute] matches [pattern] whole, ignoring case.
tap_in() {
  local xml="$1" attribute="$2" pattern="$3" bounds
  bounds="$(grep -oiE "$attribute=\"($pattern)\"[^>]*bounds=\"[^\"]*\"" <<< "$xml" | head -1 | grep -o '\[[0-9,]*\]\[[0-9,]*\]' || true)"
  [ -n "$bounds" ] || return 1
  read -r x1 y1 x2 y2 <<< "$(tr '[],' '   ' <<< "$bounds")"
  adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}

# Taps the first element whose text is exactly [text].
tap_text() {
  tap_in "$(screen || true)" text "$1"
}

# Waits up to [seconds] for [text] in logcat under [tag], failing early if the app died.
wait_for_log() {
  local tag="$1" text="$2" seconds="$3" log
  local deadline=$((SECONDS + seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    log="$(adb logcat -d -s "$tag:I")"
    if grep -q -- "$text" <<< "$log"; then return 0; fi
    if ! alive; then
      echo "::error::The app stopped while waiting for “$tag: $text” in logcat" >&2
      return 1
    fi
    sleep 1
  done
  echo "::error::“$tag: $text” did not appear in logcat within $seconds s" >&2
  return 1
}

adb shell am start -W -n "$package/.MainActivity"
# A fresh install opens on the first-start welcome (M82); skipping it leads to the tabs.
wait_for_text 'text="Welcome to Lelap"' 120
tap_text 'Skip' || {
  echo "::error::No Skip on the welcome screen" >&2
  exit 1
}
# The tab bar's labels: Home is up once the first screen has drawn.
wait_for_text 'text="Home"' 60
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

# Scan and play (M110). A book of one short tone, in a folder below Download: the picker refuses
# Download itself and the storage root, never a folder inside them.
folder='LelapSmoke'
book='SmokeBook'
python3 -I -c '
import math, struct, sys, wave
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(8000)
    w.writeframes(b"".join(struct.pack("<h", int(3000 * math.sin(i / 8000 * 2 * math.pi * 440))) for i in range(8000 * 60)))
' "$work/part.wav"
adb shell rm -rf "/sdcard/Download/$folder"
adb shell mkdir -p "/sdcard/Download/$folder/$book"
adb push "$work/part.wav" "/sdcard/Download/$folder/$book/01.wav" > /dev/null

# The release build has no other way in, so the system folder picker is driven by its text. Its
# start place and its labels' case vary by Android version; each pass takes the next step from
# what is on screen: allow, use this folder, open ours, open Download, or open the list of places.
choose_folder() {
  local deadline=$((SECONDS + 120)) xml allowed=''
  while [ "$SECONDS" -lt "$deadline" ]; do
    xml="$(screen || true)"
    dismiss_system_anr "$xml"
    if grep -q 'package="app.lelap"' <<< "$xml" && ! grep -q 'package="com.android.documentsui"\|package="com.google.android.documentsui"' <<< "$xml"; then
      # Back in Lelap: done once “Allow” was tapped, else the picker is still opening.
      [ -z "$allowed" ] || return 0
    elif tap_in "$xml" text 'Allow'; then
      echo 'Folder picker: allowed.'
      allowed=1
    elif grep -q "text=\"$book\"" <<< "$xml" && tap_in "$xml" text 'Use this folder'; then
      echo "Folder picker: using $folder."
    elif tap_in "$xml" text "$folder"; then
      echo "Folder picker: opening $folder."
    elif tap_in "$xml" text 'Downloads?'; then
      echo 'Folder picker: opening Download.'
    elif tap_in "$xml" content-desc 'Show roots'; then
      echo 'Folder picker: opening the list of places.'
      sleep 1
      xml="$(screen || true)"
      # The phone's own storage, named after the device; Download is a folder there.
      tap_in "$xml" text '(sdk_gphone|Android SDK|Internal storage)[^"]*' || tap_in "$xml" text 'Downloads?' || true
    fi
    sleep 2
  done
  echo '::error::Could not choose the folder in the system folder picker' >&2
  screen > "$out/window.xml" || true
  return 1
}

tap_text 'Choose your audiobooks folder' || {
  echo '::error::No “Choose your audiobooks folder” in the empty Library' >&2
  exit 1
}
choose_folder
# The scan finds the book; its title is the folder's name, since the file has no tags.
wait_for_text "text=\"$book\"" 120
tap_text "$book" || {
  echo "::error::Could not tap “$book” in the Library" >&2
  exit 1
}
wait_for_log LelapPlayback 'Playing' 60
sleep 5
alive || {
  echo "::error::The app stopped while playing" >&2
  exit 1
}
if crashed; then exit 1; fi
echo 'The app scanned a folder and played a book from it.'
