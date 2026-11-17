# M26 follow-ups

What is left of [M26 Casting](milestones/m26.md): checks on a phone and real receivers, and
what this round left out.

## How it works

- **Discovery** (`modules/cast`, `Discovery.kt`): while the Cast sheet is open, an SSDP search for
  `MediaRenderer:1` every 8 s (device description over plain HTTP, services found in embedded
  devices, so a Sonos ZonePlayer works), and NsdManager for `_googlecast._tcp` and `_fcast._tcp`.
  A multicast lock is held only during discovery.
- **UPnP** (`Upnp.kt`): SetAVTransportURI with DIDL-Lite (title, author, album, cover, type),
  Play, Pause, Seek (REL_TIME), Stop, GetTransportInfo and GetPositionInfo every second,
  RenderingControl Get/SetVolume. Renderers play at 1×; a STOPPED after PLAYING is the end of the
  file.
- **Google Cast** (`GoogleCast.kt`, `CastMessage.kt`): TLS to the device (its certificate is not
  checked, as in VLC: only control messages and LAN URLs cross it), length-prefixed protobuf
  `CastMessage` written by hand, connection, heartbeat and receiver namespaces, LAUNCH of the
  Default Media Receiver (`CC1AD845`), media LOAD/PLAY/PAUSE/SEEK/SET_PLAYBACK_RATE/GET_STATUS.
- **FCast** (`FCast.kt`): TCP 46899, Play/Pause/Resume/Seek/Stop/SetSpeed/SetVolume, PlaybackUpdate.
- **Files on the phone** (`MediaServer.kt`): a server on the phone's Wi-Fi address with Range
  support and DLNA headers, one random 128-bit token per file, stopped when casting ends. It also
  passes through streams that need a login (WebDAV), since receivers cannot send headers. m4b and
  m4a go out as `audio/mp4`. A Wi-Fi lock is held while casting.
- **App** (`apps/app/src/casting.ts`): `platform/audio.ts` routes play, pause, seek, skip, speed,
  load and state to the receiver while casting, so the player, mini player and chapters work
  unchanged. The phone's player stays paused and is moved to the receiver's place every 10 s and
  on pause or seek; that writes the service's journal (no change to `modules/audio`). Parts play
  one after another. Handing back seeks the phone there and plays on if the receiver was playing;
  Play on the lock screen or headphones does the same. A lost connection hands back, paused.

## 1. Checks on a phone

- [ ] **Sonos** (One or Era): appears by room name; a LibriVox book streams, shows title and cover
      in the Sonos app; pause, seek, ±30 s, next chapter across a file boundary, volume.
- [ ] **Nest Mini**: appears by its name; LAUNCH and LOAD work; speed 1.5× is applied; volume;
      stopping from the Google Home app or another phone taking the speaker hands back.
- [ ] **A DLNA TV** (Samsung, LG or Sony): plays an mp3 stream and an m4b from the phone; seek works
      once playback has started.
- [ ] **Local file over LAN**: a downloaded book and a book from the library folder (`content://`)
      play from the phone's server; seeking far ahead works (Range); the server is gone after
      “Play on this phone” (the URL then gives no answer).
- [ ] **WebDAV book**: plays through the phone's pass-through.
- [ ] **FCast receiver** (desktop receiver app): plays, pauses, seeks.
- [ ] **Progress**: cast for a few minutes, swipe the app away, open it again: the place is within
      10 s of where the receiver was. Hand back: the phone resumes at the receiver's place (smart
      rewind applies after a long cast, as after any pause).
- [ ] **Screen off for 30 minutes** while casting a multi-part book: parts still advance.
- [ ] Wi-Fi with client isolation (guest networks): no receivers found, no crash.

## 2. Not in this round

- **A foreground service for cast sessions.** Parts advance from JavaScript; with the screen off
  for long, Android may stop the app between parts. A service holding the session (and a media
  notification that controls the receiver) is the fix.
- **Lock screen and notification controls** still drive the phone's player; Play there hands the
  book back to the phone.
- **Sleep timer while casting**: the timer lives in the playback service and does not pause the
  receiver yet (M29 reworks the timer; wire it afterwards).
- **A book that ends on a receiver** is left at its last second, not marked finished, and Up Next
  does not follow on.
- **Speed on UPnP renderers**: they play at 1×; the player shows 1× while casting to one.
- **Cast device authentication** and speaker groups across protocols. Cast groups appear as their
  own `_googlecast._tcp` service and should work; untested.
- **Android 17 local network permission**: when the app targets API 37, discovery and the LAN
  server will need the new local network permission at run time. Today no runtime permission is
  needed; `NEARBY_WIFI_DEVICES` is not used, since NsdManager and plain sockets do not require it.
- **Web**: the web app shows no Cast tool.
