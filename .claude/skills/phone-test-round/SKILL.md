---
name: phone-test-round
description: Use when running Lelap's open checks on a real Android phone over adb, when the user says a phone is connected or asks for a test round, or when results from a phone test need recording in the milestone files and docs/testing.md.
---

# A phone test round

Open checks live in each milestone file, `docs/milestones/mN.md`, under `## Open checks`, as task
items tagged `(adb)` (an agent with a USB phone and `adb` can run it) or `(you)` (needs the user:
calls, headphones, a car, speakers, accounts, a second device, browsers, days of use).
`pnpm checks` lists them by milestone; `--adb` and `--you` filter by tag. `docs/testing.md` says
how to run a round and logs each one. A round runs the `(adb)` checks, hands the `(you)` checks
to the user, and records every result in the milestone files.

## Set up

1. `adb devices` shows exactly one phone. If not, ask the user to connect it and allow USB
   debugging; don't go on with the emulator unless they say so.
2. Use a **release** build: debug builds load JavaScript from Metro and hide bundling bugs. Take
   the newest beta (`gh release list --limit 3`, then
   `gh release download <tag> --pattern 'lelap-*[0-9].apk'` into the scratchpad) unless the user
   wants a build of a branch.
3. `adb install -r <apk>`; if the signature differs from what is installed, ask before
   uninstalling, since that deletes the phone's library and places.
4. `pnpm checks --adb` into the scratchpad: that is the round's list.

## Run the `(adb)` checks

Start with whether the release build starts and plays at all, then playback, downloads and
offline, the background engine, sync on one device, and UI features; a failure in the first
group stops the round.

For each check:

- Do it with the commands in `docs/testing.md` (media keys, `dumpsys media_session`, airplane
  mode, battery, `screencap`, `uiautomator dump`). Take a screenshot for anything visual and look
  at it.
- **Pass:** tick it in its milestone file (`- [x]`) and add `Passed YYYY-MM-DD` plus a few words
  of evidence (`21.7 s → 16.7 s after 2 min`).
- **Fail:** leave it unticked, add `Failed YYYY-MM-DD:` with what happened, and collect it for
  the round's entry with the logcat lines (`adb logcat -b crash`, `adb logcat -d | grep -i lelap`).
- **Can't run** over adb after all: change its tag to `(you)` with a note; don't guess.

Never mark a check passed from reading code or from the web preview. A check that turned out
obsolete is removed from the milestone file with the reason in the round's entry.

## Hand over the `(you)` checks

Give the user `pnpm checks --you`, grouped by what they need (one phone, headphones, a car,
speakers, a second device, a browser), each with the exact steps and what should happen. Record
their answers the same way.

## Close the round

1. Run `pnpm roadmap`: ticking a check changes the roadmap table's count, and
   `pnpm roadmap --check` fails in CI until it is regenerated.
2. Add an entry under “Rounds” in `docs/testing.md`: date, build (tag or commit) and phone, how
   many checks passed, bugs found with their fix pull requests, and what turned out not to be a
   bug.
3. For each failure: fix it in a small pull request per area (or ask the user first if the fix is
   a design choice). Name the round in the pull request.
4. Commit the doc changes: `Docs: phone test round N results`.

## Common mistakes

| Mistake                                      | Instead                                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| Keeping a list of checks in `testing.md`     | Checks live in the milestone files; `testing.md` is a log.    |
| Ticking a check without `pnpm roadmap`       | Regenerate the table; CI checks the counts.                   |
| Testing a debug build                        | Release build from GitHub Releases or the downloads host.     |
| Uninstalling to get around a signature error | Ask: it deletes the user's library and places.                |
| “Looks fine” as evidence                     | A number, a screenshot or a `dumpsys` line.                   |
| Fixing failures inside the round's commit    | Results in one docs commit; fixes in their own pull requests. |
