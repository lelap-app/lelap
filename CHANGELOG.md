# Changelog

What changed in each Lelap release, newest first.

## 0.1.0-beta.4 (2026-11-17)

This beta changes the app’s Android code, so it needs the new APK; an over-the-air update can’t
bring it.

### New

- Audiobookshelf: add your server with an API key (Audiobookshelf 2.26 or later) and pick its book
  libraries. Books play from the original files, and your place syncs both ways. (#91)
- Find chapters in a book that has none: Player → Chapters → Find chapters marks a part at each
  long silence. Android only. (#98)
- Skip a podcast’s intro and outro, from 15 to 90 seconds, set once per show. Reaching the outro
  marks the episode played. (#98)
- Tablets and laptops: in a wide window the tabs become a rail and the player stands beside your
  library. A phone turned sideways shows the cover beside the controls. (#95)
- Keyboard shortcuts in the web app: Space or K plays and pauses, ← → or J L skip, < > change the
  speed, / opens Search and ? lists them. (#95)
- “Because you finished …” rows on Home suggest books by the same author or series. They are
  worked out on your phone; Hide on the row turns them off. (#101)
- Badges on covers: a rating or “3 new” episodes when an add-on sends them, and ✓ or “42 %” for
  what you finished or started. LibriVox books show their archive.org rating. Turn them off in
  Settings → Catalogs. (#106)
- A diagnostics log, off by default, in Settings → Help → Diagnostics. It keeps the last 500
  events without personal data, and you see the whole file before you share it. (#103)
- Translating Lelap needs no development setup: one file per language, edited in the browser on
  GitHub or sent through the new Translation issue form. (#104)

### Improved

- Casting: the lock screen, the notification, headphones, watches and Android Auto control the
  speaker, and a cast keeps going with the screen off. (#107)
- Casting: the sleep timer fades the speaker’s own volume, the volume keys change it, and a book
  that ends on the speaker is marked finished, with Up Next going on there. (#107)
- Casting: UPnP speakers play at the book’s speed when they support it, and “Play on this phone”
  carries on from the speaker’s place. (#107)
- TalkBack names every control, reads the scrubber as “12:30 of 45:00” and offers Delete on
  bookmarks. Buttons are at least 48 dp, screens hold up at the largest text size, and reduced
  motion stops the animations. (#92)
- Big libraries: with 10,000 books, Library, Home and Podcasts open several times faster, and
  rescanning an unchanged folder takes 0.3 s instead of 7 s on a laptop. The web app starts faster
  and loads less. (#93)
- Notifications, the widget, the Quick Settings tile and Android Auto follow the profile’s
  language. (#104)
- Adding a WebDAV server reads only the folder you entered. Each request gives up after 30 s with
  a clear message instead of spinning. (#94)
- The APK is about half the size: it carries code for ARM phones only. x86 Chromebooks and
  emulators can use the web app. (#85)

### Fixed

- With “Duck on calls” on, pressing Play during a call plays the book quietly instead of pausing
  it again at once. (#89)
- Sync works from the beta: its server goes live with this release. Before, pairing failed
  because the server couldn’t be found. (#99)

### Self-hosting and add-on developers

- Protocol revision 4: `badges` on `MetaPreview` and `Meta` (`rating` 0 to 5, `newEpisodes`).
  Older apps ignore them. The SDK release with revision 4 follows `@lelap/sdk` 0.3.0. (#106)
- `@lelap/sdk` 0.3.0 brings protocol revisions 2 and 3 to npm: health, behaviour hints, artwork
  and add-ons inside the app. (#87)

### Known issues

- Casting with these changes hasn’t been tried on real speakers yet (Sonos, DLNA, Google Cast,
  FCast). (#107)
- Audiobookshelf was tested against a stand-in, not a real server; casting an Audiobookshelf book
  may not play. (#91)
- The tablet layout was checked in a browser only, not on an Android tablet. (#95)
- Find chapters and the intro and outro skips haven’t been tried on a phone yet. (#98)
- A book already playing when a call starts may go silent rather than quieter. (#89)
