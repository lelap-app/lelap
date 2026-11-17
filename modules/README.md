# modules

Native Kotlin modules for the Expo app:

- `audio`: Media3 `MediaLibraryService`, audio focus and ducking, gapless parts, the sleep timer fade.
- `library`: folder access, tags and chapters for the local library.
- `download`: background downloads with WorkManager, Wi-Fi and charging rules, Range resume.

- `cast`: casting with open protocols only: UPnP for Sonos and DLNA, our own Cast v2 client for
  Google Cast speakers, FCast; a small LAN server for files on the phone. No Google Cast SDK.

See [`docs/brief.md`](../docs/brief.md).
