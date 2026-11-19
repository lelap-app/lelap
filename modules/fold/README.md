# @lelap/fold

Kotlin Expo module that follows a foldable's hinge (M113) through Jetpack WindowManager: whether
it runs up and down (a book) or across (a laptop or a phone on a table), whether it separates the
screen (half open, or a hinge that hides part of it) and where its edges are, in window points.

- The window size alone can't tell a half-open book from a flat one, nor where the hinge is, so the
  app asks this module. `packages/core/src/screen.ts` (`foldLayout`) decides the layout from it:
  the screens left of a book's hinge and the player right of it, or the screens above a tabletop's
  hinge and the player below; no control sits under the hinge.
- It listens to the activity on screen from `start()` on, and again for a new activity after the
  app was in the background. A device without a hinge never sends an event.
- `Folds` turns the feature's pixel bounds into points and is tested on the JVM:
  `cd apps/app/android && ./gradlew :lelap-fold:testDebugUnitTest`.

The web has nothing like it; `apps/app/src/platform/fold.web.ts` reports no fold.
