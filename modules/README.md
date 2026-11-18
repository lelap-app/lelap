# modules

Native Kotlin modules for the Expo app:

- `audio`: Media3 `MediaLibraryService`, audio focus and ducking, gapless parts, the sleep timer fade.
- `library`: folder access, tags and chapters for the local library.
- `download`: background downloads with WorkManager, Wi-Fi and charging rules, Range resume.
- `widget`: home screen widget and Quick Settings tile; they read what plays from `audio`.
- `bluetooth`: connected Bluetooth audio devices, their battery level and whether one is a car;
  opt-in, with the nearby devices permission.

- `netfs`: SMB 2 and 3 (smbj) and SFTP (sshj) servers: the folder walk, a Media3 data source that
  reads at any offset, and shared connections for the player, downloads, tags and casting. Also
  `LocalNetwork`, Android 17's local network permission check, shared by casting and downloads.

- `cast`: casting with open protocols only: UPnP for Sonos and DLNA, our own Cast v2 client for
  Google Cast speakers, FCast; a small LAN server for files on the phone. No Google Cast SDK.
  `audio`'s playback service plays through its `CastLink` while casting, so the media session
  (notification, lock screen, car) controls the receiver.

See [`docs/brief.md`](../docs/brief.md).
