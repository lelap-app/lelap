# M9 follow-ups

What is left of [M9 Profiles](milestones/m9.md).

## 1. What was built

- Profiles with a name, one of 20 bundled avatars (drawn for Lelap from simple shapes, so the
  licence is the app's; random unused one for a new profile) or the name's initial on a colour,
  an optional four-digit PIN (SHA-256 with the profile ID; the UI says it encrypts nothing), and
  a kids switch.
- “Who's listening?” at launch when there is more than one profile; a locked profile asks for its
  PIN at launch, also when it was used last. Home's avatar switches profile.
- Per profile: places, finished and speed, bookmarks, settings, podcast subscriptions, Up Next,
  and which add-ons it sees. Shared: books, downloads, installed add-ons.
- A kids profile can't change add-ons or manage profiles; a new kids profile sees only the app's
  own add-ons until a grown-up allows more.
- The active profile is per device. The place of a loaded book is saved to the profile it was
  loaded for, also after a switch and in the journal from the service.
- Profiles sync (M7): name, avatar, PIN hash, kids and hidden add-ons; deleting one deletes it on
  every device.

## 2. Checks

Checked in Chrome (web build) on 2026-11-16: add a profile, set a PIN, the launch picker, a wrong
then right PIN, Mia's library with her own (empty) places, no mini player for the other profile's
book.

| #   | Check                                                                           | Status     |
| --- | ------------------------------------------------------------------------------- | ---------- |
| 1   | Profiles, avatars, PIN and the launch picker                                    | Pass (web) |
| 2   | Kids profile: add-ons screen refused, hidden catalogs gone from Home and Search | Not run    |
| 3   | Android: switch while a book plays; its place stays with its profile            | Not run    |
| 4   | Android: lock screen and notification after a switch (see limits)               | Not run    |
| 5   | **Done-when:** two people, one phone and their own devices, own progress        | Not run    |

## 3. Known limits

- Fixed after M9: switching to a profile with nothing to play now empties the player (`unload`),
  so the lock screen and notification no longer show the other profile's book. Still to confirm
  on the phone. Playback resumption from headphones can still pick up that book's journal.
- Per-profile scrobble add-ons wait for scrobbling itself (Later in the brief).
- Settings are per profile, including download rules, which arguably belong to the device.
