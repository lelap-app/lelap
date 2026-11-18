# @lelap/widget

Android home screen widget and Quick Settings tile for the player. No JavaScript API: both work
with the app closed.

- `PlaybackService` in `modules/audio` saves what plays now (`NowPlaying`) and sends
  `app.lelap.audio.NOW_PLAYING_CHANGED` to its own package; `NowPlayingReceiver` redraws the
  widgets and asks the tile to refresh.
- `PlayerWidgetProvider`: RemoteViews, 4x1 below 100 dp of height, 4x2 above. Tapping it opens
  `lelap://player`.
- `PlayTileService`: play or pause; a long press opens `TileLongPressActivity`, then the player.
- `PlayerRemote`: one command through a short-lived `MediaController` to `PlaybackService`. Back
  and Forward go through the session's `SKIP` command, which first loads the last book paused when
  nothing is loaded (M74); with no book at all they are hidden.
- Covers: the app's own copy of a server's cover (`file://` or `content://`) when it has one, else
  the cover's web address, fetched without a login.

Unit tests for the pure parts run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-widget:testDebugUnitTest
```
