# @lelap/audio

Kotlin Expo module for Android playback.

- `PlaybackService`: a Media3 `MediaLibraryService` with one ExoPlayer. A book is a playlist with
  one item per file, which plays gaplessly. The session provides the notification, lock screen,
  headphone and Bluetooth controls.
- `AudioFocus`: our own focus handling. ExoPlayer's pauses on phone calls; ours ducks transient
  interruptions (calls, VoIP, navigation) when “duck on interruption” is on, and pauses otherwise.
  Play pressed during a call gets focus only when the call ends (the call holds it with a lock);
  with ducking on, the book plays quietly until then instead of waiting.
- `SleepTimer`: runs inside the service, freezes while you pause, and fades the player's own volume over the
  last 60 seconds, then pauses. It counts minutes, or listening time to the end of the chapter or
  episode (`SleepBoundary`), where an ExoPlayer message stops playback exactly. `ShakeDetector`
  adds ten minutes on a shake in the timer's last five minutes.
- `ExpiringLinks`: a 403 or 410 from an audio host opens the item's own URL again, once, from the
  same byte, so an add-on's `/resolve/…` redirect hands out a fresh link.
- `SoundChain` and `SoundProcessor`: mono, voice EQ (high-pass at 80 Hz, +4 dB around 3 kHz) and
  a +6 dB volume boost behind a peak limiter that never lets a sample past full scale. The
  processor sits in front of ExoPlayer's own audio processors and stays active for every PCM
  stream, so switching an effect ramps over 50 ms instead of reconfiguring the sink.
- `Bedtime`: “start a sleep timer at bedtime”. The app writes the window to the service's
  preferences; when Play falls inside it (the window may cross midnight), the service starts a
  timer for minutes or to the end of the chapter, once per night.
- Intro and outro (M45): a podcast's `BookLoad` carries the seconds to skip. `SeekRules` starts
  an episode past its intro and keeps smart rewind out of it; a player message at the outro's
  start seeks to the end, so the episode is logged as played and Up Next goes on.
- Media button preferences: back and forward by the skip interval (`SkipIcons` picks Media3's
  icon with the seconds) and the sleep timer button. Phones, watches and cars all read them.
- Casting (M50): `RemotePlayer` becomes the session's player while a receiver plays, through the
  cast module's `CastLink`; `RemoteSession` there decides parts, the book's end and speed. The
  sleep timer fades the receiver's volume and pauses it; the book's end is logged and Up Next goes
  on there. ExoPlayer keeps the book, paused, for the hand-back.
- `AudioModule`: the JavaScript bridge (`src/index.ts`), a `MediaController` on the main thread.

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
