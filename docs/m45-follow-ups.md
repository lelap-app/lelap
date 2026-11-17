# M45 follow-ups

Covered by tests: in `packages/core`, `library/silence.test.ts` checks the detection rules
(minimum silence, minimum chapter length, the longest silences first, silences of later files on
the whole-book timeline); `library/queries.test.ts` that found chapters are stored only for a
book without any and that removing them leaves other chapters alone; `podcasts/trim.test.ts` and
`podcasts.test.ts` the intro and outro rules and that they are kept per profile;
`sync/sync.test.ts` that they reach a second device with the subscription. On the JVM,
`SilenceScannerTest` (`lelap-library`) checks the 50 ms level windows on mono, stereo and float
audio, a scan resumed part way, and the job and progress files; `SeekRulesTest` and
`PositionJournalTest` (`lelap-audio`) the start past the intro, smart rewind stopping at it, the
outro's place and that the values survive the journal and Up Next.

Not checked in the web preview: the preview could not read a feed through the proxy from
`localhost`, so the podcast page's “Skip intro” and “Skip outro” rows are unseen. The web does not
offer chapters from silences (see `docs/brief.md`, “Chapters”), so there is nothing to see there.

## Open on a phone

- <a id="silences"></a>A single-file book from the library folder with no chapter tags: Player →
  Chapters → Find chapters. A notification shows “Finding chapters”; when it is gone, the sheet
  lists “Part 1”, “Part 2”, … at the book's real chapter breaks, with “Found from long silences on
  this phone.” Check a few breaks by ear; tune `SILENCE_RULES` in `packages/core` if they miss or
  split chapters.
- The same with a downloaded add-on book that has no chapters, and with an MP3 and an M4B file.
- Remove: the found chapters go, the sheet offers Find chapters again; a book with chapter tags
  never shows Find chapters.
- With the battery under 15 % (`adb shell dumpsys battery set level 10`), a scan waits (“Waiting
  for enough battery.”); lowering it during a scan stops the scan; raising it again goes on from
  where it stopped, not from the start.
- A ten-hour book: the scan finishes, also when it started with the app in the background (then
  without a foreground notification, in ten-minute slices).
- <a id="intro-outro"></a>A subscribed show with Skip intro 30 s and Skip outro 30 s: a new
  episode starts at 0:30; playing into the last 30 s marks it played and the next in Up Next
  starts. Paused for more than an hour at 0:40 and played again: it starts at 0:30, not earlier.
- The same with the app closed: an episode that Up Next starts by itself, and one picked in
  Android Auto, skip their intro and outro.
- Seek back into the intro and play: it plays. Seek into the outro: it plays to the end.
- Change the intro while an episode of the show is loaded: the outro takes the new value at once
  on Android; the web player takes it the next time the episode is loaded while paused.
- Two devices: the show's skip values reach the other device with the next sync.

## Deferred review findings

- A device still on a version before M45 that applies a subscription change drops the skip values
  but keeps the change's time, so after it updates it shows 0 for that show until the listener
  changes the values on some device again.
- Stop followed at once by Find chapters: the stopped worker may still write its progress into
  the new scan's folder. A run token in `job.json` would keep them apart.
- When the scan worker starts with the app in the background, Android 12 and later refuse its
  foreground notification; it then runs in ten-minute slices and resumes from its checkpoint.
- Found chapters reach a book that is playing only at its next load (the lock screen title and a
  chapter sleep timer keep the old list until then).
- A streamed book whose parts change but whose add-on brings no chapters keeps its found
  chapters, which may then be off.
- A place saved inside the intro (the listener went back to it) is moved past the intro at the
  next load.
- Casting: a receiver starts past the intro, but the outro is not skipped there.
