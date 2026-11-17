# M29 follow-ups

Checks for [M29 Sleep and links](milestones/m29.md) that need a phone or a live
add-on. The rules themselves have JVM tests (`SleepBoundaryTest`, `SleepTimerTest`,
`ShakeDetectorTest`, `ExpiringLinksTest`, `DownloadRulesTest`) and Vitest tests
(`packages/core/src/sleep.test.ts`).

## Rules, as built

- **End of chapter** stops at the end of the chapter playing; a book without chapter marks stops at
  the end of the file. **End of episode** (podcasts) stops at the end of the episode, and Up Next
  does not start.
- The timer follows the chapter that is playing. Playback never crosses the boundary (the timer
  stops it there), so the boundary only moves when the listener seeks, skips or picks another
  chapter, and then it is that chapter's end. Loading another book carries a chapter timer over to
  its chapter.
- Pausing freezes the timer; it shows the listening time left at the current speed.
- The fade is the same 60 seconds. Playback stops on the boundary, and the place is parked there,
  so the next Play starts the next chapter after smart rewind's few seconds.
- **Shake** (Android only): in the last five minutes of a running timer, three firm jolts within
  0.8 s add ten minutes and bring the volume back. A chapter or episode timer becomes a plain
  countdown of what was left plus ten minutes. After a shake, two seconds are ignored. The
  accelerometer is only on during those five minutes; no permission is needed. The web skips it:
  browsers ask before sharing motion, which a sleepy listener should not have to answer.
- **Expiring links:** on 403 or 410, playback (ExoPlayer's load error policy) and downloads ask the
  stream's own URL again, once per expiry, and continue from the same byte. The web player can't
  see HTTP statuses, so it asks again once after a network or source error, at the last place.

## Phone checks

1. **End of chapter, mid-file.** A single-file book with chapters: start "End of chapter" two
   minutes before a chapter mark. The moon shows `ch.` and the time left; the volume fades over the
   last minute; playback stops on the mark, and Play resumes a few seconds before it.
2. **End of chapter, file end.** A book with one file per chapter: the timer stops at the end of
   the file and the next Play starts the next file (after smart rewind into the previous one).
3. **Seek moves it.** With a chapter timer running, pick a later chapter in the chapter list: the
   time left grows to that chapter's end. Skip back 30 s across a mark: it shrinks to the earlier
   chapter's end.
4. **Speed.** At 2× the time left halves within a few seconds of changing speed.
5. **App closed.** Swipe the app away with a chapter timer running: it still stops on the mark.
6. **End of episode.** A podcast episode with another in Up Next: "End of episode" stops at the end,
   the episode is marked played, and the next one does not start.
7. **Shake.** With a 5-minute timer, shake the phone (screen off, phone on a bed): ten minutes are
   added and the volume comes back. Turning over in bed must not trigger it; a shake with 20
   minutes left does nothing.
8. **Battery.** With a 45-minute timer, the accelerometer is not listed as in use until the last
   five minutes (`adb shell dumpsys sensorservice`, active connections).
9. **Expired link, playback.** An add-on whose `/resolve/…` URL redirects to a link that answers
   403 after a minute: playback continues past the minute with at most a short buffering pause,
   and the position does not jump. A link that keeps answering 403 shows the error after one retry.
10. **Expired link, download.** The same add-on with a download: the part file continues after the
    403 instead of failing the download.
11. **Web.** The same three timer checks (1, 3, 6) in Chrome and Firefox, and the expired link
    check (9).
