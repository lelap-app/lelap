# M25 follow-ups

What is left of M25 Home screen and tiles ([`milestones/m25.md`](milestones/m25.md)) after its
first pull request. M25 stays “In progress” until the device checks pass.

## What landed

- `modules/widget` (Kotlin, no JavaScript API): `PlayerWidgetProvider` with a 4x1 and a 4x2
  RemoteViews layout, `PlayTileService` for Quick Settings, and `TileLongPressActivity`, which a
  long press on the tile opens and which hands over to `lelap://player`.
- `modules/audio`: `PlaybackService` saves what plays now (`NowPlaying`, JSON in the
  `lelap_now_playing` preferences) and sends `NOW_PLAYING_CHANGED` to its own package when it
  changes. The widget and tile read that, so they show the last book with the app closed.
- Buttons on the widget and the tile reach `PlaybackService` through a short-lived
  `MediaController`. Play with nothing loaded makes the session resume the last book from the
  position journal, as headphone Play already does.
- A sleep timer `CommandButton` (overflow slot) on the media notification and lock screen:
  15 min → 30 min → end of chapter → off (`SleepCycle`). A timer set in the app turns off on the
  next press. Other controllers (watches, cars) may use it too.
- Covers are downloaded by the widget from their own host (never through our services), shrunk to
  320 px and kept in the cache, one at a time.

## 1. Device checks

Not run (no phone testing for now).

| #   | Check                                                                                                 | Status  |
| --- | ----------------------------------------------------------------------------------------------------- | ------- |
| 1   | Add the widget at 4x1 and resize to 4x2: the layout switches, cover, title and chapter show           | Not run |
| 2   | Widget play, pause, back and forward work with the app open and with it swiped away                   | Not run |
| 3   | The widget's numbers follow the skip interval set in Settings                                         | Not run |
| 4   | The chapter line on the widget changes when a chapter ends                                            | Not run |
| 5   | Tapping the widget opens the player, from a cold start and with the app in the background             | Not run |
| 6   | After a reboot, widget Play resumes the last book at its place (playback resumption)                  | Not run |
| 7   | Quick Settings tile: shows the book and Playing/Paused; a tap plays and pauses                        | Not run |
| 8   | A long press on the tile opens the player                                                             | Not run |
| 9   | Notification and lock screen show the sleep button; presses step 15 → 30 → chapter → off              | Not run |
| 10  | The app's sleep timer screen follows timers set from the notification, and the button follows the app | Not run |
| 11  | Switching to a profile with nothing loaded clears the widget and tile                                 | Not run |
| 12  | Covers from an Audiobookshelf server that needs a login (the widget sends no headers)                 | Not run |

## 2. Open points

- Covers that need the server's login (check 12) show the placeholder: the widget has no access to
  the book's headers. Passing a local copy of the cover from the app would fix it.
- Widget Back and Forward do nothing while nothing is loaded; only Play resumes.
- The widget link is `lelap://player`, the app's scheme; a fork with another scheme changes
  `Links.kt` too.
- The widget's strings are English like the rest of the app; they move with the app when it gets
  translations.
