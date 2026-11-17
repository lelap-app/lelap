# M50 follow-ups

What is left of [M50 Casting 2](milestones/m50.md): checks on a phone and real receivers, and
what this round left out.

Covered by tests (JVM, `./gradlew :lelap-cast:testDebugUnitTest`): `RemoteSession` (next part,
the book's end, a second book on the same receiver, play, pause, a pause on the speaker, a
stopped receiver, seeks within and across parts, speed fallback to 1×, a failed load),
`ReceiverFade` (fade from the receiver's own volume, rate limit, silence, restore, receivers
without a volume), UPnP play speeds from AVTransport service descriptions, and when the Android 17
permission is needed. Checked here: `pnpm check`, `pnpm test` (translations, accessibility),
`pnpm build`, the cast and audio modules compile. Nothing ran against a real receiver.

## How it works

- **The session plays on the receiver.** `CastLink` (`modules/cast`) holds one session: the
  protocol client, the phone's file server, a Wi-Fi lock, and a wake lock while the receiver
  plays, with a poll every second. The app connects (`@lelap/cast` `connect`), then asks the
  playback service to cast (`@lelap/audio` `castTo`). The service swaps its media session's player
  for `RemotePlayer`, a Media3 `SimpleBasePlayer` that plays the book's parts on the receiver.
  The notification, lock screen, headphones, watches and Android Auto control it like ExoPlayer.
- **Foreground service: `mediaPlayback`.** It is the playback service's type already, and Media3
  keeps the service in the foreground while the session's player plays, now the receiver's. The
  listener started the playback and controls it through a media notification, which is what
  `mediaPlayback` covers; it needs no runtime permission. `connectedDevice` is meant for talking to
  a device (Bluetooth, USB, NFC, a network link), not for playback, and would have needed a second
  notification.
- **Decisions** are in `RemoteSession`: a part that ends loads the next; the last part ending
  ends the book, which the service logs as finished (the app marks it played) and, for items
  that hand over, starts Up Next on the same receiver. ExoPlayer keeps the book, paused and not
  fetching, for the hand-back.
- **Sleep timer:** the timer in the service runs as before; while casting it fades the
  receiver's own volume where the protocol reports one (UPnP RenderingControl, Google Cast,
  FCast), pauses the receiver, then puts the volume back. A chapter or episode timer stops by its
  tick, about a second after the boundary, since ExoPlayer's exact stop message cannot fire on a
  receiver.
- **Speed on UPnP:** the renderer's AVTransport description lists the speeds it takes
  (`TransportPlaySpeed`); a book's speed in that list goes out with Play (`3/2`), anything else
  plays at 1× and the player shows 1×.
- **Android 17 local network permission:** the Cast sheet explains and asks before discovery
  when the app targets API 37 on Android 17; it shows a way to Android's settings once refused
  for good. Below that target the permission is implied by INTERNET and nothing is asked.
- **Volume keys** while casting change the receiver's volume (the session reports remote
  playback with the receiver's volume).

## 1. Checks on a phone

- [ ] **Sonos, locked for an hour**: cast a multi-part LibriVox book, lock the phone; after an
      hour parts still advance and the notification shows the chapter and controls the speaker.
- [ ] **Lock screen and notification**: pause, play, ±30 s and the seek bar act on the receiver,
      not the phone; the phone stays silent.
- [ ] **Headphones and Android Auto**: a headset button pauses and plays the receiver; in the
      car, the player controls the receiver and picking another book plays it on the receiver.
- [ ] **Volume keys** change the speaker's volume while casting.
- [ ] **Sleep timer, 5 minutes**: the speaker fades over the last minute (Sonos, Nest Mini),
      pauses, and its volume is back to where it was afterwards. On a DLNA TV without
      RenderingControl, it pauses without a fade.
- [ ] **End of chapter timer** while casting pauses the speaker within about two seconds of the
      chapter's end.
- [ ] **Book ends on the speaker**: it shows as finished in the library. A podcast episode with
      the next episode in Up Next starts that episode on the same speaker.
- [ ] **UPnP speed**: a renderer that lists 3/2 in its AVTransport description plays at 1.5×;
      Sonos plays at 1× and the player shows 1×.
- [ ] **Nest Mini**: 1.5× still applies; the speaker taken by another phone hands back, paused.
- [ ] **Hand back** (“Play on this phone”) while playing: the phone plays on from the
      receiver's place without a rewind; while paused: it stays paused there.
- [ ] **Swipe the app away while casting**: the notification stays and controls the receiver;
      reopening the app shows the receiver in the Cast tool.
- [ ] **Android 17 permission** (a test build with `targetSdkVersion` 37): opening the Cast
      sheet explains first; Allow shows Android's “nearby devices” prompt; after it, receivers
      appear and a phone file plays from the phone's server. Refusing twice shows “Open
      settings”.
- [ ] **FCast desktop receiver**: plays, pauses, seeks; the sleep timer fades it.

## 2. Not in this round

- **A podcast's outro skip** (M45) does not apply on a receiver: it relies on an ExoPlayer
  message. The intro is still skipped, since the start place is worked out before loading.
- **Smart rewind on a receiver** rewinds after a pause like on the phone; it was not tuned for
  receivers, which buffer a few seconds after a seek.
- **The home screen widget and Quick Settings tile** follow the receiver's play state (they read
  what the service publishes) but were not checked.
- **Raising `targetSdkVersion` to 37** is a separate change; the permission is declared and
  asked only once it is.
