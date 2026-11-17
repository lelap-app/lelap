# @lelap/audio

Kotlin Expo module for Android playback.

- `PlaybackService`: a Media3 `MediaLibraryService` with one ExoPlayer. A book is a playlist with
  one item per file, which plays gaplessly. The session provides the notification, lock screen,
  headphone and Bluetooth controls.
- `AudioFocus`: our own focus handling. ExoPlayer's pauses on phone calls; ours ducks transient
  interruptions (calls, VoIP, navigation) when “duck on interruption” is on, and pauses otherwise.
- `SleepTimer`: runs inside the service, freezes while you pause, and fades the player's own volume over the
  last 60 seconds, then pauses. It counts minutes, or listening time to the end of the chapter or
  episode (`SleepBoundary`), where an ExoPlayer message stops playback exactly. `ShakeDetector`
  adds ten minutes on a shake in the timer's last five minutes.
- `ExpiringLinks`: a 403 or 410 from an audio host opens the item's own URL again, once, from the
  same byte, so an add-on's `/resolve/…` redirect hands out a fresh link.
- `AudioModule`: the JavaScript bridge (`src/index.ts`), a `MediaController` on the main thread.

Unit tests for the pure parts run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-audio:testDebugUnitTest
```

## M1 device checklist

Open Settings → Developer → Audio spike, load the default LibriVox book (ID 254, 35 parts), then:

| #   | Check                                                                                                                                                                                                          | Result                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | **Gapless:** skip to 20 s before the end of a part and listen across three part boundaries. No click, gap or stall.                                                                                            | Pass                                                              |
| 2   | **Background:** screen off for five minutes, then swipe the app away. Lock screen, notification and headphone play/pause and next work.                                                                        | Pass (lock screen, notification, swipe away); headphones untested |
| 3   | **Speed:** at 2× the voice keeps its pitch, and the speed still applies after the next part starts on its own.                                                                                                 | Pass                                                              |
| 4   | **Calls:** with the switch on, a phone call and a VoIP call duck the book. With it off they pause it, and it resumes afterwards. Play pressed during a call shows “starts when the call ends” and starts then. | Partial: Meet ducks; phone call, WhatsApp and switch off untested |
| 5   | **Sleep timer:** a 1-minute timer fades smoothly to silence and pauses. Pausing freezes the countdown. The next Play starts at normal volume.                                                                  | Pass (fade); freeze untested                                      |

Results so far: Pixel 10 Pro XL, Android 17 (API 37), 2026-11-16. Record any OEM quirk (for
example media muted during cellular calls) next to the result.
