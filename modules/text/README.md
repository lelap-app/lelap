# @lelap/text

The profile's language for native Android text: notification channels and their notifications,
the player's buttons, Android Auto's shelves, the home screen widget and the Quick Settings tile.

- The app calls `setNativeText(language, lines)` at start and on every language switch, with the
  lines listed in `apps/app/src/nativeText.ts`, translated through the app's catalogs.
- `NativeText` saves them in shared preferences, so they hold with the app closed, renames the
  notification channels it created, and sends `app.lelap.text.CHANGED` to its own package; the
  widget and `PlaybackService` redraw on it.
- Other modules depend on this one (`implementation project(':lelap-text')`) and look lines up by
  the English: `NativeText.t(context, "Back {n} seconds", "n" to 30)`. A line without a
  translation shows in English. `pnpm --filter @lelap/app test` fails when Kotlin uses a line the
  app doesn't hand over.

Unit tests for the pure part run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-text:testDebugUnitTest
```
