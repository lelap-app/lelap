# M43 follow-ups

Covered by tests: `src/bigLibrary.test.ts` in `packages/core` checks the Library, continue
listening, podcast counts, car episodes and list counts on a copy of the test library, that
continue listening, a book's episode, a book's details and the podcast queries never read a
whole table, and that Remove takes away every made-up row. The scan tests cover the rescan that
skips unchanged rows. Timings: `pnpm --filter @lelap/core bench`, numbers in
[the milestone](milestones/m43.md#measurements).

Checked in the web preview: Settings → Developer → Test library adds 11,000 books (10,000 and
1,000 played episodes) and 20,000 episodes; the Library shows them with list counts and tags,
and holds about 40 book rows in the page out of 10,000. The production build was timed against
the one before M43 on the same 49 MB database (see the milestone).

Open on a phone:

- <a id="cold-start"></a>**Cold start with 10,000 books, under two seconds on a mid-range phone.**
  On a debug build, Settings → Developer → Test library → Add. Then install a release build over
  it, which keeps the data (Expo signs local release builds with the debug key):
  `pnpm --filter @lelap/app exec expo run:android --variant release`. For each run:
  `adb shell am force-stop app.lelap`, start
  `adb shell screenrecord --bit-rate 8000000 /sdcard/start.mp4` in a second shell, then
  `adb shell am start -W -n app.lelap/.MainActivity` and tap Library as soon as the tab bar
  shows; stop the recording after the rows appear and `adb pull /sdcard/start.mp4`. Count from
  the first frame that changes to the first frame with book rows (60 fps, so frames ÷ 60). Five
  runs, the median under 2 s. Note `TotalTime` from `am start -W` too, and the phone's model.
  Remove the test library afterwards.
- Scroll the Library from top to bottom quickly with 10,000 books: no blank gaps that stay, no
  stutter over a second; memory in `adb shell dumpsys meminfo app.lelap` stays under 300 MB.
- A real folder of a few hundred books: the second scan (pull down in the Library) finishes
  noticeably faster than before M43, and no book loses its place, bookmarks or chapters.
- With 500 test podcasts, the Podcasts tab opens at once, and starting the app or pulling down
  there sends no request for a test feed (none to `feeds.invalid` or the proxy in `adb logcat`).
- Android Auto (Desktop Head Unit) with the test library: the browse tree opens without delay.

## Decisions to confirm

- **No fixed row heights.** Book rows grow with the system font size since M42, so the lists
  keep measuring rows instead of `getItemLayout`, with a smaller render window.
- **zod's locales are left out by a Metro rule.** Lelap only uses English messages from zod; a
  zod update that moves its locale list would make the rule do nothing (the bundle grows again,
  nothing breaks).
- **The test library is in debug builds only** and its books have no files, so they never play;
  their podcasts point at `feeds.invalid` (a reserved host, RFC 2606). Feeds on `.invalid` hosts
  are never fetched, auto-downloaded or synced, and nothing of the test library leaves the
  device through sync; it has no covers to load.

## Review notes (minor)

- Chapters of an unchanged book are no longer rebuilt on each rescan, so a later change to how
  chapters are built reaches existing books only when their files change (or through a
  migration). The scan code says so.
- A book with a file that stays missing is still rebuilt on every scan, as before M43.
- Continue listening breaks exact ties on when it was played and added, not on title; only a
  kids profile with ties across 50 started books could notice.
- The zod rule covers zod's ES module build only; if Metro ever picks its CommonJS build or
  `zod/mini`, the bundle grows again and nothing breaks.

## Left for later

- **The web app writes its whole database after every change.** With 10,000 books that is a
  49 MB export about a second after each save, also every 10 s while playing. A web database
  that writes only the changed pages (OPFS with SQLite's own VFS) would fix it; it is bigger
  than this milestone.
- **The first scan of a big folder** still writes each file and book in its own statement
  (3 s for 10,000 books on a Mac, more on a phone, after the tags are read, which takes far
  longer). Batching the inserts would roughly halve it.
- The Library list re-reads and re-sorts every book on each refresh (34 ms on a Mac); a list
  that only re-reads what changed would need a change signal per book.
