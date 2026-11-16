# @lelap/audio

Kotlin Expo module for Android playback.

- `PlaybackService`: a Media3 `MediaLibraryService` with one ExoPlayer. A book is a playlist with
  one item per file, which plays gaplessly. The session provides the notification, lock screen,
  headphone and Bluetooth controls.
- `AudioFocus`: our own focus handling. ExoPlayer's pauses on phone calls; ours ducks transient
  interruptions (calls, VoIP, navigation) when “duck on interruption” is on, and pauses otherwise.
- `SleepTimer`: runs inside the service, freezes while you pause, and fades the player's own volume over the
  last 60 seconds, then pauses.
- `AudioModule`: the JavaScript bridge (`src/index.ts`), a `MediaController` on the main thread.

Unit tests for the pure parts run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-audio:testDebugUnitTest
```

## M1 device checklist

Load the default LibriVox book (ID 254, 35 parts) on the test screen, then:

| #   | Check                                                                                                                                         | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **Gapless:** skip to 20 s before the end of a part and listen across three part boundaries. No click, gap or stall.                           |        |
| 2   | **Background:** screen off for five minutes, then swipe the app away. Lock screen, notification and headphone play/pause and next work.       |        |
| 3   | **Speed:** at 2× the voice keeps its pitch, and the speed still applies after the next part starts on its own.                                |        |
| 4   | **Calls:** with the switch on, a phone call and a VoIP call duck the book. With it off they pause it, and it resumes afterwards.              |        |
| 5   | **Sleep timer:** a 1-minute timer fades smoothly to silence and pauses. Pausing freezes the countdown. The next Play starts at normal volume. |        |

Record phone model, Android version and any OEM quirk (for example media muted during cellular
calls) next to the result.
