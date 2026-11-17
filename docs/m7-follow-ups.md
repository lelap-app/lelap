# M7 follow-ups

What is left of [M7 Sync](milestones/m7.md). Design notes are in [the brief](brief.md#sync-m7).

## 1. Setup before it is live

- Done 2026-11-16: D1 `lelap-sync` and `lelap-sync-staging` created (EEUR); their IDs are in
  `services/sync/wrangler.toml`.
- Custom domains: `sync-staging.lelap.app` through `SYNC_STAGING_DOMAIN` in the `web` environment;
  `sync.lelap.app` for production comes with the M8 release workflow.
- A rate limiting rule on the sync hostnames, mainly for `POST /v1/pairings/*` (a code has 60 bits,
  and each one lives ten minutes, but guessing should still be slowed).

## 2. Checks

Verified on 2026-11-16 in Chrome with two origins as two devices (`localhost` and `127.0.0.1`)
against `wrangler dev` with local D1:

| #   | Check                                                                     | Status       |
| --- | ------------------------------------------------------------------------- | ------------ |
| 1   | Start syncing, show a code, join from the other device with sloppy typing | Pass locally |
| 2   | A streamed book and its place arrive on the other device                  | Pass locally |
| 3   | “Continue from Browser?” appears and Continue plays from that place       | Pass locally |
| 4   | A second tab of the web app refuses to open the library                   | Pass locally |
| 5   | **Done-when:** phone and laptop, switching in the middle of a chapter     | Not run      |
| 6   | Android: journal times after the change to “when the place moved”         | Not run      |
| 7   | Podcasts and Up Next across a phone and the web                           | Not run      |
| 8   | Staging deploy against real D1                                            | Needs setup  |

## 3. Bugs found and fixed while testing

- The web player wrote its journal before a book had loaded, so a failed load saved place 0.
- Two tabs of the web app each kept their own database copy and overwrote each other's file.
- The playback journal (web and Android) was dated when written, so loading an old place on one
  device could outrank a newer place from another. It now carries when the place last moved, and
  core never re-dates an unchanged place.

## 4. Known limits

- Sync runs while the app is open (on start, every minute, on return, after a pause). A phone that
  is only played from the lock screen syncs when the app next opens.
- The group key is stored in the app's SQLite without the Android Keystore.
- The log is never compacted; a group grows until its 50 MB limit. Compaction (a sealed snapshot
  that replaces older messages) is a follow-up.
- Leaving a group forgets it on this device only; the group and its messages stay on the server.
- Last writer wins by each device's clock; a phone with a wrong clock can win or lose wrongly.
