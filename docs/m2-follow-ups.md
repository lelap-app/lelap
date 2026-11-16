# M2 follow-ups

What is left of [M2 Local library](roadmap.md#m2-local-library) after PRs #8, #9 and #10, to pick up
later. M2 stays “In progress” until the device checks and the week in airplane mode pass.

## 1. Device checks

The checklist with steps is in [`apps/app/README.md`](../apps/app/README.md#m2-device-checklist).
Status on the Pixel 10 Pro XL (Android 17), 2026-11-16:

| #    | Check                    | Status                                                                                                                           |
| ---- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Folder scan              | Pass: 111 files, 29 books, durations for all                                                                                     |
| 2    | Rescan reads nothing     | Not run                                                                                                                          |
| 3    | Episodes as chapters     | Pass                                                                                                                             |
| 4    | Deep resume (2 h in)     | Nearly: paused at 2:07:07.97, journal 2:07:06.28 (see 2. below); still to confirm the Player shows the place after reopening     |
| 5    | Swipe away while playing | Mostly: kept playing, journal written every 10 s with the app gone, app picked up the place; stop from the notification untested |
| 6–13 | Reboot to airplane mode  | Not run                                                                                                                          |

Also on the device: seeking is fast; the playhead can now be dragged (added after the first test).

Then the week of daily listening in airplane mode.

## 2. Known issue from testing

- **Pause is recorded about 1.7 s early.** On pause the service journals the position before it
  settles (lock screen showed 2:07:07.97, journal 2:07:06.28). Safe direction (you re-hear 1.7 s,
  never skip ahead). Fix: journal again about 500 ms after a pause.

## 3. Deferred review findings (minor)

Each PR had a fresh review. Critical and important findings were fixed; these were left.

**Core (`packages/core`)**

- Every scan rewrites `updated_at` on all rows and recreates chapter IDs: noise for M7 sync.
- `getSettings` checks keys with `in`, which matches inherited names; use `Object.hasOwn`.
- `resumePoint` returns location `''` for a book with no files on disk; callers must handle it.

**Playback (`modules/audio`)**

- The journal's speed goes stale after a speed change, so resumption restores the speed from load.
- Resumption measures the pause from `savedAt`, not from the pause itself; store `pausedAt`.
- Rewinds can stack when Play is pressed repeatedly during a long call with ducking off.
- Errors from custom session commands (for example a rejected book) don't reach JavaScript.
- `PlayerState.partTitle` now shows the chapter title (the M1 spike screen displays it).
- Changing the skip interval doesn't notify connected controllers.
- The whole playlist is rewritten to the journal on every tick; store it once per load.

**Library (`modules/library`)**

- Text tags and duration are lost when chapter parsing or saving the cover throws.
- ID3 unsynchronisation and v2.4 files with non-synchsafe frame sizes misparse silently.
- QuickTime chapter titles are always decoded as UTF-8 (UTF-16 with a BOM garbles).
- `TreeWalk` has no visited set (a provider reporting a directory cycle would loop), and its comment
  says depth-first though it is breadth-first.
- `pickFolder` never releases old persisted grants (Android caps them at 512).

**App (`apps/app`)**

- The journal is folded in after the first render, not before.
- The paused load at startup bumps `lastPlayedAt`, which shortens the next smart rewind.
- The M1 spike screen ships in release builds; gate it on `__DEV__`, or remove it once M1's call
  checks pass.
- Unhandled rejections in startup, Settings → Rescan and the folder picker.
- Skip buttons always say 30 although the interval can be 10–60 s.
- After a rescan regroups the loaded book, the Player says “Nothing is playing” until it reloads.
- `let listed` in `src/scan.ts` is an implicit `any`.
- Babel's cache hides edits to existing `.sql` migrations (`expo start --clear`).
- The pull-to-refresh spinner shows even when a scan reads nothing.
- Books appear only when a scan ends; the Continue card has no chapter; no rescan button in the
  header; reaching the end of a book doesn't mark it finished.
- `.claude/launch.json` assumes `~/.nvm/nvm.sh`.
