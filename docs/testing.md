# Phone tests

How to run a round of open checks on a phone, and a log of the rounds so far. The checks themselves
live in each milestone file under `## Open checks` in [`milestones/`](milestones/); this file
holds no list of its own.

## How to run a round

### Setup

- A signed release APK (debug builds don't bundle JavaScript), installed on the Pixel over USB.
- Wi-Fi on, and the `Audiobooks` folder chosen in the app.

### Which checks

Each open check is tagged: `(adb)` when an agent can run it with a USB phone and `adb` alone,
`(you)` when it needs the maintainer (calls, headphones, the car, speakers, listening by ear,
accounts and servers, a second device, browsers, a release tag).

```sh
pnpm checks --adb   # what an agent can run now
pnpm checks --you   # what needs the maintainer
pnpm checks         # everything, by milestone
```

Start with whether the release build starts and plays at all, then playback, downloads and
offline, the background engine, sync on one device, and UI features.

### Useful adb commands

- Install and start: `adb install -r <apk>`, `adb shell am start -n app.lelap/.MainActivity`,
  crashes in `adb logcat -b crash`.
- Screens: `adb exec-out screencap -p > shot.png`, labels with `adb shell uiautomator dump`.
- Media: `adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE` (also `_PLAY`, `_PAUSE`, `_NEXT`,
  `_PREVIOUS`); state and position in `adb shell dumpsys media_session`.
- Screen off: `adb shell input keyevent KEYCODE_SLEEP`, back on with `KEYCODE_WAKEUP`.
- App gone: swipe it from recents, or `adb shell am kill app.lelap` (process only) and
  `adb shell am force-stop app.lelap` (stops the service too).
- Network: `adb shell cmd connectivity airplane-mode enable|disable`,
  `adb shell svc wifi disable|enable`.
- Charger: `adb shell dumpsys battery unplug`, back with `adb shell dumpsys battery reset`.
- Files: `adb push <file> /sdcard/Download/` for imports, `adb shell mv` inside
  `/sdcard/Audiobooks`.

### Recording results

- A check that passes: tick it in its milestone file (`- [x]`) with the date and a short result
  if it helps (`21.7 s → 16.7 s after 2 min`), then run `pnpm roadmap` so the table's count
  follows.
- A check that fails: leave it open, fix the bug in its own pull request, and note the PR in the
  round's entry below.
- Add an entry for the round below. Dated entries stay as they were.

## Rounds

### Round 1 (2026-11-17)

- **Build:** release build from `main`, on a Pixel 10 Pro XL (Android 17).
- **Passed:** 19 checks, among them the release APK installing over the debug build, Home, Search
  and playback against the deployed catalog, media keys, the pause journal, smart rewind,
  bookmarks, a downloaded book in airplane mode, the Up Next hand-over with the app closed, the
  Player's icons and TalkBack names. One check passed on the emulator: ducking during a call.
- **Found and fixed** in [#64](https://github.com/lelap-app/lelap/pull/64) and
  [#66](https://github.com/lelap-app/lelap/pull/66): sleep timer as a list; Library title under
  the status bar; streaming books not dimmed offline; lists stale while playing; episode menu as a
  system dialog; “Book” for episodes; same-named add-ons in messages; search waiting for the
  slowest add-on; sheets hidden behind the keyboard; the speed button's spoken name.
- **Not bugs:** no battery prompt (Lelap was already exempt); “LibriVox did not answer” came from
  two leftover `localhost:8787` add-ons on the test phone.
