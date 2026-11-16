# M1 Audio Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bare Expo app and a Kotlin Media3 module that pass the five M1 “done when” checks on a
real Android phone.

**Architecture:** `PlaybackService` (a Media3 `MediaLibraryService`) owns ExoPlayer, its own audio
focus, and Lull. The Expo module `@lelap/audio` talks to it through a `MediaController` plus custom
session commands. A single throwaway React Native screen drives it.

**Tech Stack:** Expo SDK 58 (React Native 0.88, React 19.3), expo-dev-client, Kotlin, Media3
1.11.1, JUnit 4 for JVM unit tests, pnpm workspaces.

**Spec:** [`docs/superpowers/specs/2026-11-16-m1-audio-spike-design.md`](../specs/2026-11-16-m1-audio-spike-design.md)

## Global Constraints

- TypeScript strict, no `any`, named exports; shared options from `tsconfig.base.json`.
- Android application ID `app.lelap`; Kotlin package `app.lelap.audio`; JS module name `LelapAudio`.
- Media3 artifacts pinned to `1.11.1` (`media3-exoplayer`, `media3-session`, `media3-datasource`).
- Generated native folders (`apps/app/android`, `apps/app/ios`) are never committed (CNG).
- No hard-coded `lelap.app` hosts. Test audio comes from `librivox.org` and `archive.org` only.
- Comments explain why, one or two lines, only where a reader would be surprised.
- Root `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm build` stay green (CI has no Android
  SDK, so nothing in those scripts may need Gradle).

## Review Focus

1. **Network failure mid-book** (Wi-Fi drop, archive.org 403/5xx): the player reports an error in
   state and the screen shows it; nothing crashes. Covered in Task 7 (`error` field) and Task 8.
2. **App reopened while the service is still playing:** the screen reconnects and shows the live
   part and position instead of an empty state. Covered in Task 7 (controller reads the session on
   connect), Task 8 (screen calls `getState` on mount) and the device checklist.
3. **Manual pause or cancel during the Lull fade:** volume returns to full and the timer clears.
   Covered by `LullTest` in Task 4.
4. **Duck and Lull at once:** the volumes multiply, and ending one does not reset the other.
   Covered by `VolumeMixerTest` in Task 3.
5. **Speed survives part boundaries and app restarts within a session:** ExoPlayer keeps
   `PlaybackParameters` across items; the checklist checks it after an auto-advance.

---

## File structure

```
pnpm-workspace.yaml                      + modules/*
package.json                             + dev:app, android scripts
eslint.config.js                         ignore apps/app/android, apps/app/ios
.prettierignore                          same
apps/app/
  package.json  app.json  tsconfig.json  index.ts  App.tsx
  src/librivox.ts                        LibriVox API → Part[]
  src/PlayerScreen.tsx                   the test screen
  README.md                              how to run on a phone
modules/audio/
  package.json  expo-module.config.json  tsconfig.json
  src/index.ts                           typed JS API
  android/build.gradle
  android/src/main/AndroidManifest.xml   service + permissions
  android/src/main/java/app/lelap/audio/
    AudioModule.kt                       Expo module: controller bridge, events
    PlaybackService.kt                   MediaLibraryService, player, session callback
    AudioFocus.kt                        own focus handling and duck policy
    VolumeMixer.kt                       duck × lull → player.volume
    Lull.kt                              sleep timer state and fade curve
    Commands.kt                          custom command names and bundle keys
  android/src/test/java/app/lelap/audio/
    VolumeMixerTest.kt  LullTest.kt  AudioFocusPolicyTest.kt
  README.md                              device test checklist
```

---

### Task 1: Expo app scaffold and workspace wiring

**Files:**

- Create: `apps/app/{package.json,app.json,tsconfig.json,index.ts,App.tsx}` from the
  `expo-template-blank-typescript@sdk-58` template
- Modify: `pnpm-workspace.yaml`, `package.json`, `eslint.config.js`, `.prettierignore`,
  `.gitignore`

**Interfaces:**

- Produces: workspace package `@lelap/app` with scripts `start` (`expo start --dev-client`),
  `android` (`expo run:android`), `check` (`tsc --noEmit`). No `build` script.

- [ ] **Step 1:** Generate the template into `apps/app` with
      `pnpm create expo-app@latest apps/app --template blank-typescript@sdk-58 --no-install`, keeping
      the existing `README.md`. Rename the package to `@lelap/app`, add `expo-dev-client`, set
      `tsconfig.json` to extend `expo/tsconfig.base` and keep `strict`.
- [ ] **Step 2:** `app.json`: name `Lelap`, slug `lelap`, scheme `lelap`,
      `android.package` `app.lelap`, `userInterfaceStyle` `dark`, drop iOS-only keys.
- [ ] **Step 3:** Add `modules/*` to `pnpm-workspace.yaml`; root scripts `dev:app`
      (`pnpm --filter @lelap/app start`) and `android` (`pnpm --filter @lelap/app android`); ignore
      `apps/app/android/`, `apps/app/ios/`, `apps/app/.expo/` in git, ESLint and Prettier. Approve
      any dependency build scripts pnpm asks about with `pnpm approve-builds`.
- [ ] **Step 4:** Run `pnpm install && pnpm format:check && pnpm lint && pnpm check && pnpm build`.
      Expected: all pass. If Metro cannot resolve isolated pnpm dependencies later, add
      `node-linker=hoisted` to `.npmrc` and note why.
- [ ] **Step 5:** Commit `Scaffold the Expo app for the M1 audio spike`.

### Task 2: `@lelap/audio` module skeleton

**Files:**

- Create: `modules/audio/{package.json,expo-module.config.json,tsconfig.json,src/index.ts}`,
  `modules/audio/android/build.gradle`, `AndroidManifest.xml`, `AudioModule.kt` (stubs),
  `Commands.kt`
- Modify: `apps/app/package.json` (dependency `"@lelap/audio": "workspace:*"`)

**Interfaces:**

- Produces (TypeScript, `modules/audio/src/index.ts`):

```ts
export type Part = { url: string; title: string };
export type PlayerState = {
  connected: boolean;
  playing: boolean;
  buffering: boolean;
  partIndex: number; // -1 when nothing is loaded
  partCount: number;
  positionMs: number;
  durationMs: number; // 0 when unknown
  speed: number;
  duckOnInterruption: boolean;
  lullRemainingMs: number | null;
  error: string | null;
};
export function load(bookTitle: string, parts: Part[], startIndex?: number): Promise<void>;
export function play(): void;
export function pause(): void;
export function seekBy(deltaMs: number): void;
export function skipToPart(index: number): void;
export function setSpeed(speed: number): void;
export function setDuckOnInterruption(enabled: boolean): void;
export function startLull(minutes: number): void;
export function cancelLull(): void;
export function getState(): Promise<PlayerState>;
export function addStateListener(listener: (state: PlayerState) => void): { remove(): void };
```

- Produces (Kotlin, `Commands.kt`): `object Commands { const val SET_DUCK = "app.lelap.audio.SET_DUCK"; const val START_LULL = "app.lelap.audio.START_LULL"; const val CANCEL_LULL = "app.lelap.audio.CANCEL_LULL"; const val KEY_ENABLED = "enabled"; const val KEY_DURATION_MS = "durationMs"; const val EXTRA_DUCK = "duckOnInterruption"; const val EXTRA_LULL_END = "lullEndsAtElapsedMs" }`.
  The service publishes duck and Lull state in `MediaSession.sessionExtras` under the two `EXTRA_*`
  keys.

- [ ] **Step 1:** Scaffold with `pnpm dlx create-expo-module@latest --local` in a scratch folder to
      copy the SDK 58 Gradle and config layout, then write `modules/audio` by hand: module class
      `app.lelap.audio.AudioModule`, platforms `["android"]`, `build.gradle` adding the three Media3
      artifacts at `1.11.1` and `testImplementation "junit:junit:4.13.2"`.
- [ ] **Step 2:** `index.ts` wraps `requireNativeModule('LelapAudio')` with the signatures above;
      `AudioModule.kt` declares `Name("LelapAudio")`, `Events("onStateChange")` and every function as
      a no-op so the bridge links.
- [ ] **Step 3:** Run `pnpm install && pnpm check`. Expected: PASS.
- [ ] **Step 4 (needs Android SDK):** `cd apps/app && pnpm expo prebuild -p android --clean && cd android && ./gradlew :lelap-audio:compileDebugKotlin`.
      Expected: BUILD SUCCESSFUL. Use whatever Gradle project name autolinking prints if it differs.
- [ ] **Step 5:** Commit `Add the @lelap/audio Expo module skeleton`.

### Task 3: Volume mixer

**Files:** Create `VolumeMixer.kt`, `VolumeMixerTest.kt`.

**Interfaces:** Produces `class VolumeMixer(private val apply: (Float) -> Unit) { var duck: Float; var lull: Float; fun reset() }`.
Setting either property calls `apply(duck * lull)`, each clamped to `0f..1f`. `reset()` sets both
to 1f.

- [ ] **Step 1:** Write `VolumeMixerTest`: `duck = 0.2f` then `lull = 0.5f` applies `0.1f`;
      `duck = 1f` afterwards applies `0.5f` (Lull kept); `lull = 2f` clamps to `1f`; `reset()`
      applies `1f`.
- [ ] **Step 2:** Run `./gradlew :lelap-audio:testDebugUnitTest` (from `apps/app/android`).
      Expected: FAIL, unresolved `VolumeMixer`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `Add the volume mixer for ducking and Lull`.

### Task 4: Lull timer

**Files:** Create `Lull.kt`, `LullTest.kt`.

**Interfaces:**

- Produces `fun lullVolume(remainingMs: Long, fadeMs: Long = 60_000L): Float`: `1f` when
  `remainingMs >= fadeMs`, linear to `0f` at `remainingMs <= 0`.
- Produces `class Lull(private val clock: () -> Long, private val onVolume: (Float) -> Unit, private val onFinished: () -> Unit) { fun start(durationMs: Long); fun cancel(); fun tick(); val endsAtMs: Long?; val remainingMs: Long? }`.
  `tick()` is driven every 250 ms by the service's main-thread `Handler` while active. It calls
  `onVolume(lullVolume(...))`, and when time is up calls `onFinished()` then `onVolume(1f)` and
  clears. `cancel()` calls `onVolume(1f)` and clears. `start` while active restarts.

- [ ] **Step 1:** Write `LullTest` with a fake clock: `lullVolume(60_000) == 1f`,
      `lullVolume(30_000) == 0.5f`, `lullVolume(0) == 0f`, `lullVolume(-5) == 0f`. A 2-minute Lull
      ticked at 30 s reports volume 1f; at 90 s, 0.5f; at 120 s, `onFinished` called once, then
      volume 1f and `remainingMs == null`. `cancel()` at 100 s reports 1f and clears.
- [ ] **Step 2:** Run the unit tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `Add Lull with a 60-second fade`.

### Task 5: Audio focus policy

**Files:** Create `AudioFocus.kt`, `AudioFocusPolicyTest.kt`.

**Interfaces:**

- Produces the pure policy:
  `enum class FocusAction { PAUSE, PAUSE_TRANSIENT, DUCK, RESTORE }` and
  `fun focusAction(focusChange: Int, duckOnInterruption: Boolean): FocusAction`. Mapping:
  `AUDIOFOCUS_LOSS` → `PAUSE`; `AUDIOFOCUS_LOSS_TRANSIENT` → `DUCK` if enabled, else
  `PAUSE_TRANSIENT`; `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` → `DUCK`; `AUDIOFOCUS_GAIN` → `RESTORE`.
- Produces `class AudioFocus(context: Context, private val onAction: (FocusAction) -> Unit) { var duckOnInterruption: Boolean; fun request(): Boolean; fun abandon() }`,
  built on `AudioManagerCompat` and `AudioFocusRequestCompat` with `USAGE_MEDIA` and
  `CONTENT_TYPE_SPEECH`, `setWillPauseWhenDucked(true)`. That flag stops the system from ducking
  on its own, so the duck level stays ours.

- [ ] **Step 1:** Write `AudioFocusPolicyTest` covering all six combinations of the four focus
      changes with the flag.
- [ ] **Step 2:** Run the unit tests. Expected: FAIL.
- [ ] **Step 3:** Implement the policy and the class.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `Handle audio focus ourselves so calls can duck instead of pause`.

### Task 6: Playback service

**Files:** Create `PlaybackService.kt`; modify `AndroidManifest.xml`.

**Interfaces:**

- Consumes: `VolumeMixer`, `Lull`, `AudioFocus`, `focusAction`, `Commands`.
- Produces: service `app.lelap.audio.PlaybackService`, exported, with intent filters
  `androidx.media3.session.MediaLibraryService` and `android.media.browse.MediaBrowserService`,
  `foregroundServiceType="mediaPlayback"`. Permissions: `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `INTERNET`, `WAKE_LOCK`.

Behaviour to implement:

- ExoPlayer built with `setAudioAttributes(speech/media, handleAudioFocus = false)`,
  `setHandleAudioBecomingNoisy(true)`, `setWakeMode(C.WAKE_MODE_NETWORK)`, and a
  `DefaultMediaSourceFactory` over `DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)`.
- Focus: request focus in `onIsPlayingChanged(true)` or when `playWhenReady` turns on, and abandon
  it on pause. `PAUSE` pauses and abandons. `PAUSE_TRANSIENT` pauses and remembers to resume.
  `DUCK` sets `mixer.duck = 0.2f`. `RESTORE` sets `mixer.duck = 1f` and resumes if it paused
  transiently.
- Session callback: `onConnect` adds the three custom commands to the available session commands.
  `onCustomCommand` handles them, persists the duck flag in `SharedPreferences("lelap_audio")`, and
  updates `sessionExtras`. `onGetLibraryRoot` returns an empty browsable root, which is enough for
  M1.
- Lull: `onFinished` pauses the player; the tick runner posts on `Looper.getMainLooper()` every
  250 ms only while active.
- `onTaskRemoved`: stop the service when `!player.playWhenReady || player.mediaItemCount == 0`,
  otherwise keep playing.
- `onDestroy`: release the session and player, cancel Lull, abandon focus.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run `./gradlew :lelap-audio:testDebugUnitTest :app:assembleDebug`.
      Expected: tests PASS, BUILD SUCCESSFUL.
- [ ] **Step 3:** Commit `Add the Media3 playback service`.

### Task 7: Bridge in `AudioModule`

**Files:** Modify `AudioModule.kt`.

**Interfaces:** Consumes the service's commands and session extras. Implements the TypeScript API
from Task 2 exactly.

- Connect lazily: build a `MediaController` from `SessionToken(context, ComponentName(context, PlaybackService::class.java))`
  on first call, on the main thread. Hold it until `OnDestroy`, then release it.
- `load` builds `MediaItem`s with `mediaId = url`, `MediaMetadata` title = part title, album title =
  `bookTitle`, then calls `setMediaItems(items, startIndex, 0)`, `prepare()`.
- `onStateChange` is emitted from `Player.Listener.onEvents` and from a 1 s main-thread ticker
  while playing. `error` is `PlaybackException.message` with its error code name. It clears on the
  next successful `prepare` or `load`.
- `lullRemainingMs` is derived from `EXTRA_LULL_END - SystemClock.elapsedRealtime()`, read from
  `controller.sessionExtras`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run `./gradlew :app:assembleDebug`. Expected: BUILD SUCCESSFUL.
- [ ] **Step 3:** Commit `Bridge the playback service to JavaScript`.

### Task 8: Test screen

**Files:** Create `apps/app/src/librivox.ts` and `apps/app/src/PlayerScreen.tsx`; modify
`apps/app/App.tsx`.

**Interfaces:**

- Produces `export async function fetchLibriVoxBook(id: string): Promise<{ title: string; parts: Part[] }>`
  using `https://librivox.org/api/feed/audiobooks/?id=${id}&format=json&extended=1`. It maps
  `sections[]` sorted by `section_number` to `{ url: listen_url, title: \`${n}. ${title}\` }`,
validates with a type guard, and throws `Error('LibriVox book <id> not found')` on an empty
  result.
- Default book ID `254`.

Screen contents, top to bottom:

1. Book ID input and a Load button.
2. Book title and `Part n / N: <title>`.
3. Position / duration, and a buffering indicator.
4. −30 s, Play/Pause, +30 s, Previous and Next part.
5. Speed buttons: 0.8, 1, 1.25, 1.5, 2, 3.
6. “Duck on interruption” switch.
7. Lull buttons: 1, 5 and 15 min, Cancel, and the remaining time.
8. An error line.

Plain `StyleSheet`, dark background.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run `pnpm format:check && pnpm lint && pnpm check`. Expected: PASS.
- [ ] **Step 3:** Commit `Add the M1 test screen`.

### Task 9: Docs, then device verification

**Files:** Modify `docs/roadmap.md` (M1 status “In progress” in the table and section),
`AGENTS.md` (repo map: `apps/app` and `modules/audio` no longer planned), `apps/app/README.md`.
Create `modules/audio/README.md`.

- [ ] **Step 1:** `apps/app/README.md`: prerequisites (Node 24, Android Studio JDK as
      `JAVA_HOME`, `ANDROID_HOME`, USB debugging) and `pnpm android` to build and install the dev
      client.
- [ ] **Step 2:** `modules/audio/README.md`: what the module does and the device checklist, one
      line per check with how to trigger it:
  1. Gapless: listen across three part boundaries; no click, gap or stall.
  2. Background: screen off for 5 min; swipe the app away; the lock screen and headphone
     play/pause and next work.
  3. Speed: 2× keeps the voice's pitch, and still applies after an auto-advance.
  4. Calls: with the setting on, a phone call and a VoIP call (Signal, WhatsApp) duck the book;
     with it off, they pause it and it resumes afterwards.
  5. Lull: a 1-minute Lull fades smoothly from about 0 s to 60 s, then pauses; volume is normal
     on the next play.
- [ ] **Step 3:** Run `pnpm format:check && pnpm lint && pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 4:** Commit `Document the audio spike and mark M1 in progress`.
- [ ] **Step 5:** With the phone attached, run `pnpm android` and walk the checklist. Record the
      results, including OEM quirks (for example, the phone muting media during cellular calls), in
      the module README. Mark M1 done in the roadmap only when all five checks pass.
