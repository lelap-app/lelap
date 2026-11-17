---
name: phone-test-round
description: Use when running Lelap's open checks on a real Android phone over adb, when the user says a phone is connected or asks for a test round, or when results from a phone test need recording in docs/testing.md and the follow-ups files.
---

# A phone test round

`docs/testing.md` is the one list of open checks, gathered from the `docs/mN-follow-ups.md` files.
Section **A** is what an agent can do over `adb`; section **B** needs the user (calls, headphones,
a car, speakers, a second device, days of use). A round runs A, hands B to the user, and records
every result in both places.

## Set up

1. `adb devices` shows exactly one phone. If not, ask the user to connect it and allow USB
   debugging; don't go on with the emulator unless they say so.
2. Use a **release** build: debug builds load JavaScript from Metro and hide bundling bugs. Take
   the newest beta (`gh release list --limit 3`, then
   `gh release download <tag> --pattern 'lelap-*[0-9].apk'` into the scratchpad) unless the user
   wants a build of a branch.
3. `adb install -r <apk>`; if the signature differs from what is installed, ask before
   uninstalling, since that deletes the phone's library and places.
4. Start a new section in `docs/testing.md` above section A:
   `## Round N (YYYY-MM-DD)` with the build (tag or commit) and the phone model.

## Run section A

Go through A1 to A6 in order; they are ordered by risk, so a failure in A1 stops the round.

For each check:

- Do it with the commands at the top of section A (media keys, `dumpsys media_session`, airplane
  mode, battery, `screencap`, `uiautomator dump`). Take a screenshot for anything visual and look
  at it.
- **Pass:** tick it (`- [x]`) and add `**Passed YYYY-MM-DD**` plus a few words of evidence
  (`21.7 s → 16.7 s after 2 min`). Make the same change in the follow-ups file the check links
  to (tick it, or set its row in a status table to Pass).
- **Fail:** leave it unticked, add `**Failed YYYY-MM-DD**:` with what happened, and collect it
  for the round summary with the logcat lines (`adb logcat -b crash`, `adb logcat -d | grep -i lelap`).
- **Can't run** (needs hardware or a human): move it to section B with a note, don't guess.

Never mark a check passed from reading code or from the web preview. Section C is for checks that
are obsolete or covered elsewhere; move a check there only with the reason.

## Hand over section B

Give the user the B items grouped by what they need (one phone, headphones, a car, speakers, a
second device), each with the exact steps and what should happen. Record their answers the same
way as A.

## Close the round

1. Under the round heading: one paragraph with what passed, what failed with links to fix pull
   requests, and what turned out not to be a bug.
2. For each failure: fix it in a small pull request per area (or ask the user first if the fix is
   a design choice). Name the round in the pull request.
3. A milestone whose follow-ups have no open checks left: set its status line to `done` (see the
   `milestone` skill).
4. Commit the doc changes: `Docs: phone test round N results`.

## Common mistakes

| Mistake                                      | Instead                                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| Ticking only `testing.md`                    | Tick the linked follow-ups file too; both are read.           |
| Testing a debug build                        | Release build from GitHub Releases or the downloads host.     |
| Uninstalling to get around a signature error | Ask: it deletes the user's library and places.                |
| “Looks fine” as evidence                     | A number, a screenshot or a `dumpsys` line.                   |
| Fixing failures inside the round's commit    | Results in one docs commit; fixes in their own pull requests. |
