# @lelap/audio

Kotlin Expo module for Android playback.

- `PlaybackService`: a Media3 `MediaLibraryService` with one ExoPlayer. A book is a playlist with
  one item per file, which plays gaplessly. The session provides the notification, lock screen,
  headphone and Bluetooth controls.
- `AudioFocus`: our own focus handling. ExoPlayer's pauses on phone calls; ours ducks transient
  interruptions (calls, VoIP, navigation) to the listener's level (20–100 %, 20 % by default) when
  set to lower the volume, and pauses calls otherwise; navigation always ducks. Play pressed during
  a call gets focus only when the call ends (the call holds it with a lock); when lowering, the
  book plays at that level until then instead of waiting. `VolumeMixer` multiplies the duck level
  with the sleep timer fade.
- `SleepTimer`: runs inside the service, freezes while you pause, and fades the player's own volume over the
  last 60 seconds, then pauses. It counts minutes, or listening time to the end of the chapter or
  episode (`SleepBoundary`), where an ExoPlayer message stops playback exactly. `ShakeDetector`
  adds ten minutes on a shake in the timer's last five minutes, when “Shake for more time” is on.
  The accelerometer only runs then, batched by the sensor hub (200 ms) and timed by the samples'
  own timestamps.
- `SleepPlace` (M86): when the timer stops playback, the service keeps where and when, and where
  and when the listener last used the player. Only the listener's own commands count: everything
  that goes through the session's player (`SkippingPlayer`: the app, notification, lock screen,
  headphones, watches, cars), the widget's skips, setting or extending the timer, and a shake.
  The service's own moves (smart rewind, auto-advance, the timer's stop) use the players directly
  and don't.
- Voice search (M147): `VoiceQuery` reads a spoken request, `VoiceSearch` ranks titles and
  authors, `VoiceLibrary` searches the car snapshot (with its `library` of more books) and
  `AddonSearch` asks web add-ons' search catalogs for at most three seconds, online only. The
  service answers Android Auto's search and play-from-search, and the phone's Assistant through
  `VoiceSearchActivity`; an add-on's item goes to the app's `play` server task.
- `ExpiringLinks`: a 403 or 410 from an audio host opens the item's own URL again, once, from the
  same byte, so an add-on's `/resolve/…` redirect hands out a fresh link.
- `SoundChain` and `SoundProcessor`: mono, voice EQ (high-pass at 80 Hz, +4 dB around 3 kHz) and
  a +6 dB volume boost behind a peak limiter that never lets a sample past full scale. The
  processor sits in front of ExoPlayer's own audio processors and stays active for every PCM
  stream, so switching an effect ramps over 50 ms instead of reconfiguring the sink.
- `Bedtime`: the bedtime routine. The app writes the active profile's window to the service's
  preferences; when Play falls inside it (the window may cross midnight), or when it opens while
  playing (M86, `BedtimeAlarm`), the service starts a timer for minutes or to the end of the
  chapter and plays at the routine's volume (`VolumeMixer`) until the timer ends, once per night.
  `BedtimeAlarm` is an inexact `setAndAllowWhileIdle` alarm: no permission, a few minutes late at
  most. It broadcasts to the running service only; with nothing playing there is nothing to do.
  A cast receiver keeps its own volume for now ([M78](../../docs/milestones/m78.md)).
- Intro and outro (M45): a podcast's `BookLoad` carries the seconds to skip. `SeekRules` starts
  an episode past its intro and keeps smart rewind out of it; a player message at the outro's
  start seeks to the end, so the episode is logged as played and Up Next goes on.
- Chapter pictures (M103): an episode's `BookLoad` may carry its chapters file's pictures
  (`artworks`); `ChapterArtwork` picks the one for the place, and the chapter ticker swaps the
  item's artwork with its title, so the notification, lock screen and car show it.
- Media button preferences: back and forward by the skip interval (`SkipIcons` picks Media3's
  icon with the seconds) and the sleep timer button. Phones, watches and cars all read them.
- Casting (M50): `RemotePlayer` becomes the session's player while a receiver plays, through the
  cast module's `CastLink`; `RemoteSession` there decides parts, the book's end and speed. The
  sleep timer fades the receiver's volume and pauses it; the book's end is logged and Up Next goes
  on there. ExoPlayer keeps the book, paused, for the hand-back.
- Listening time and scrobble sessions (M51): `ListeningTally` counts what the session's player
  plays (ExoPlayer or a receiver) on the elapsed-realtime clock, at most the position's advance,
  and records start, progress and pause. `AccountingLog` keeps it in its own preferences file
  until the app merges it (`takeAccounting`, then `ackAccounting`); records handed out never
  change, so each is merged once. The app does not count on Android
  ([M51](../../docs/milestones/m51.md)).
- `PositionJournal`: the place, written at every pause, seek and 10 s tick, with the time it moved
  and the time playback paused; the book (files, chapters, live speed) under its own key, written
  only when it changes. The app folds the place in when it starts; headphones resume from both.
  Loading the loaded book again keeps its live place and takes new chapters, intro and outro, or
  other file addresses (M63).
- `AudioModule`: the JavaScript bridge (`src/index.ts`), a `MediaController` on the main thread.
  Every custom command's promise settles with the service's answer.

Unit tests for the pure parts run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-audio:testDebugUnitTest
```

## Wear OS

There is no watch app. Wear OS shows a phone's media session in its own media controls, so a watch
paired with the phone gets, while a book plays:

- Play and pause; the title (the chapter) and the book's title.
- Back and forward by the skip interval, with the seconds on the icon for 5, 10, 15 and 30 s. They
  are the session's `COMMAND_SEEK_BACK` and `COMMAND_SEEK_FORWARD`, which skip across files; the
  older previous and next actions do the same for controllers that only know those.
- The sleep timer button (15 min → 30 min → end of chapter → off) in the watch's extra actions.
- The phone's volume, from the watch's own volume control.

Nothing needs Google Play services: the watch talks to the phone's media session through the
system, so the F-Droid build gets the same controls.

## M1 device checklist

Open Settings → Developer → Audio spike, load the default LibriVox book (ID 254, 35 parts), then:

| #   | Check                                                                                                                                                                                                          | Result                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Gapless:** skip to 20 s before the end of a part and listen across three part boundaries. No click, gap or stall.                                                                                            | Pass                                                                                                                                                                                                                                                     |
| 2   | **Background:** screen off for five minutes, then swipe the app away. Lock screen, notification and headphone play/pause and next work.                                                                        | Pass (lock screen, notification, swipe away); headphones untested                                                                                                                                                                                        |
| 3   | **Speed:** at 2× the voice keeps its pitch, and the speed still applies after the next part starts on its own.                                                                                                 | Pass                                                                                                                                                                                                                                                     |
| 4   | **Calls:** with the switch on, a phone call and a VoIP call duck the book. With it off they pause it, and it resumes afterwards. Play pressed during a call shows “starts when the call ends” and starts then. | Partial: Meet ducks; phone call, WhatsApp and switch off untested. 2026-11-17: Play during a call paused at once with ducking on; fixed and checked on the emulator. Android mutes a book that is already playing when a call rings, until the call ends |
| 5   | **Sleep timer:** a 1-minute timer fades smoothly to silence and pauses. Pausing freezes the countdown. The next Play starts at normal volume.                                                                  | Pass (fade); freeze untested                                                                                                                                                                                                                             |

Results so far: Pixel 10 Pro XL, Android 17 (API 37), 2026-11-16. Record any OEM quirk (for
example media muted during cellular calls) next to the result.
