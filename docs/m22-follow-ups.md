# M22 follow-ups

Covered by JVM tests: the high-pass and presence filters at several frequencies, mono, the
limiter's ceiling with boost and EQ together, and the 50 ms ramp when a switch changes. The web
graph was rendered in Chrome with an `OfflineAudioContext` on test tones: transparent with all off,
mono averages the channels, -16 dB at 30 Hz, +4.0 dB at 3 kHz, +6.0 dB boost, peaks below full
scale. The web player itself (routing, reload on switch) has not been played in a browser yet: the
preview's library was locked by another tab.

Open on a phone:

- **Headphones:** each switch while playing changes the sound within a moment, without a click,
  stall or rebuffer. Mono puts a hard-panned recording in both ears.
- **Speaker:** volume boost is clearly louder on a quiet LibriVox recording and loud passages don't
  crackle. Voice clarity makes a muffled recording easier to follow without hiss.
- **Bluetooth:** the same, including after reconnecting a headset mid-book.
- **Speed:** the effects hold at 0.8× and 3×, and after a part changes on its own.
- **Ducking and sleep fade** still work on top of the boost.
- **Casting (M26):** casting plays on the receiver without these effects; the switches should not
  disturb a cast session, and local playback picks them up again afterwards.
- **Battery:** an hour with all three on costs no noticeable extra.
- **Synced settings:** mono and voice clarity changed on another device reach the player at the
  next start (synced settings are applied at start, as with smart rewind), volume boost does not.

Open on the web:

- A downloaded book and a LibriVox stream (archive.org sends CORS headers) play with the effects;
  a podcast host without CORS headers plays, without them, and never in silence.
- Turning a switch on while playing reloads the part once and continues at the same place.
- Safari and Firefox: the boost stage takes back the compressor's make-up gain as the spec defines
  it; check that levels match Chrome's.
