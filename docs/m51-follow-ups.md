# M51 follow-ups

What is left of [M51 Background accounting](milestones/m51.md): checks on a phone.

Covered by tests: `ListeningTally` and `AccountingLog` on the JVM
(`./gradlew :lelap-audio:testDebugUnitTest`): time while playing, speed, skips and seeks that add
nothing, the next file, buffering, progress every five minutes, another book taking over, the day
from the wall clock and the time from the elapsed clock (a clock change), records that stay as
they were once taken, acknowledgements, a session left open by process death, the log's JSON, the
cap after weeks unopened, and local days. `mergeServiceAccounting` in `packages/core` (Vitest):
stats and outbox from a batch, whole-book places, a batch merged twice, a new epoch, days,
unreadable records, no scrobblers, a book that is gone. Checked here: `pnpm check`, `pnpm test`,
`pnpm build`, the audio module compiles. Nothing ran on a phone.

## How it works

- **One counter on Android.** The playback service counts listening time and scrobble sessions
  (start, progress about every 5 min, pause) for everything it plays: with the app open or closed,
  Up Next, Android Auto, headphones, a sleep timer at night, and a receiver while casting. The app
  no longer counts on Android (`countsInService` in `@lelap/audio`), so nothing is counted twice.
  The web keeps counting in the app, since its player lives in the tab.
- **Time** is the elapsed-realtime clock between observations (every 10 s while playing, and at
  play, pause, seeks, file changes, book changes, casting hand-overs), never more than the
  position's advance divided by the speed. The wall clock only names the local day and stamps the
  events, so changing the clock moves no time.
- **Durable:** the log is in its own preferences file (`lelap_accounting`), written on every
  change, synchronously when the app is swiped away or the service stops. Process death loses at
  most the last 10 s, never doubles. A session left open by process death ends with a pause at its
  last place when the service next starts.
- **Exactly once:** the app takes a snapshot (records handed out are never changed again), merges
  it into `listening_log` and `scrobble_outbox` in one transaction together with the highest
  record number merged (`serviceAccountingMerged` in `sync_state`, never synced), then
  acknowledges. If the app stops in between, the same records come again and are skipped. Scrobble
  events are named after their record, so the outbox could not take one twice either. Finished
  books still come from the service's end-of-book log, as before.

## Checks on a phone

- Play a book for 20 minutes with the app swiped away, then open Stats: about 20 more minutes
  today, and the book in the most listened.
- With a scrobbler (Hardcover) installed, listen 15 minutes with the app closed and open it: the
  add-on receives start, progress and pause with the right places; nothing is sent twice after
  opening and closing the app a few times.
- Listen with the app open for 10 minutes, then close it and listen 10 more: Stats shows about 20,
  not 30 or 10.
- A night with a 30-minute sleep timer and the app closed: Stats shows about 30 minutes under the
  day it was heard, also past midnight.
- Up Next hands over to the next episode with the app closed: both episodes get their time.
- Cast to a speaker for 10 minutes with the app closed: the time counts.
- `adb shell am kill app.lelap` while playing in the background (the service restarts on Play):
  Stats loses at most a few seconds, and the add-on gets a pause for the killed session.
- Change the phone's clock by an hour while playing: Stats does not jump.

## Review findings left for later
