# M31 follow-ups

Covered by tests (no live network): local matches (finished downloads, library-folder books by
title and author), the stream verdict (found, none, unknown when an add-on fails, the second ask
by external IDs from the meta), the cache (newest first, concurrency, spacing, cap, TTLs, reset)
and the wanted list (shelf changes, pruning only when every shelf was read, baseline, one alert
per book, oldest check first). Checked in the web preview: LibriVox badges in Discover and
Search, “Metadata only” on Open Library results, the “Playable only” toggle.

Open on a phone:

- Home rows, Discover and Search show badges as items scroll in, with no burst of requests on a
  fast fling (watch the add-on's logs or a proxy).
- A downloaded book shows “On this phone” on its cover in Home and Search; a book from a library
  folder with the same title and author does too.
- “Playable only” on a catalog with Open Library works (Search shows them; a catalog of mixed
  works is needed) hides “Metadata only” covers and loads more pages as needed.
- Want to read (Hardcover add-on): the card under the row asks for notifications once on Android
  13+; “Not now” never shows it again for that profile. With a wanted book that gains a source
  (or by removing and adding back the LibriVox add-on between two refreshes), the background
  refresh posts “Now playable: <title>”, and a tap opens the item page.
- The background refresh with many wanted books: ten per run, one at a time; check it finishes
  well inside Android's time for a background task.
- Notification icon: it uses the system play icon; swap in the app's monochrome icon with M12's
  icon set if it looks off.
- `Alerts.kt` in the download module was not compiled here: build the APK once (`pnpm android`)
  and post a test notification.
