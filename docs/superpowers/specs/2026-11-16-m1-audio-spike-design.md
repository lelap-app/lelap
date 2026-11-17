# M1 audio spike: design

Approved 2026-11-16. Later the same day the sleep timer lost its name “Lull” (now “Sleep timer”
everywhere), and pausing freezes it instead of letting it run. Scope and “done when” criteria come from
[`docs/roadmap.md`](../../milestones/m1.md).

## Intent

Prove, on a real Android phone, that the riskiest player requirements work before any UI is built:
gapless multi-part books, background playback with system controls, pitch-preserving speed, ducking
instead of pausing on calls, and a sleep timer (Lull) that fades the player's own volume.

## Goals

- `apps/app`: bare Expo app (SDK 58, dev client, TypeScript) with one test screen.
- `modules/audio`: Kotlin Expo module around a Media3 `MediaLibraryService`, published in the
  workspace as `@lelap/audio`.
- A manual test checklist for the five “done when” criteria.

## Non-goals

Database, Expo Router, NativeWind, web build, downloads, styling, Android Auto browsing tree, unit
tests. Those arrive with M2 and later; the test screen is throwaway.

## Approaches

| Approach                                    | Trade-off                                                                         | Picked |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Own Kotlin module around Media3 (the brief) | Most work, but full control of audio focus and fades inside the service           | Yes    |
| react-native-track-player                   | Less code; no control of focus handling or service-side fades; contradicts brief  | No     |
| expo-audio                                  | Simplest; no `MediaLibraryService`, no Android Auto path, no ducking-on-call knob | No     |

## Design

- **Service.** `PlaybackService : MediaLibraryService` owns one ExoPlayer. A book is a playlist with
  one `MediaItem` per part, which ExoPlayer plays gaplessly. The `MediaLibrarySession` gives the
  media notification, lock screen and headphone buttons. HTTP data source allows cross-protocol
  redirects (archive.org redirects to mirrors).
- **Audio focus.** ExoPlayer's built-in handling pauses on calls and on any duck request for speech,
  so the service requests focus itself (`handleAudioFocus = false`). Permanent loss pauses.
  Transient loss (calls, VoIP, navigation) ducks to about 20% when the “duck on interruption”
  setting is on, otherwise pauses and resumes on regain. The setting persists in
  `SharedPreferences`. Unplugging headphones pauses.
- **Speed.** `PlaybackParameters(speed, pitch = 1f)`.
- **Lull.** Runs in the service so it survives screen-off and a closed app. Over the last 60 seconds
  it ramps `player.volume` to zero, then pauses and restores volume. Ducking and Lull multiply into
  one volume so they do not fight.
- **Bridge.** The Expo module connects a `MediaController` to the service. Functions: `load(parts)`,
  `play`, `pause`, `seekBy`, `skipToPart`, `setSpeed`, `setDuckOnInterruption`, `startLull(minutes)`,
  `cancelLull`, `getState`. Lull and the duck setting travel as custom session commands. Events:
  `onStateChange` (playing, part index, position, duration, speed, Lull remaining).
- **Closing the app.** Swiping the app away keeps the service running while playing; stops it when
  paused.
- **Test audio.** LibriVox “Pride and Prejudice (version 2)” (book 254, 35 parts, about 13 hours),
  fetched from the LibriVox API by ID and streamed from archive.org. The ID is editable on the
  screen.

## Left to the builder

Notification icon, exact duck level, position polling interval, test screen layout.
