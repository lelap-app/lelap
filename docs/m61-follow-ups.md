# M61 follow-ups

The reading log is a bundled add-on inside the app
(`packages/core/src/addons/bundled/openlibrary-log.js`), not a Worker route: the archive.org S3 keys
stay sealed on the phone and never travel in an add-on URL or reach a Lelap server.

Checked in the web preview (Chrome) with a stand-in for Open Library's login and bookshelves on
localhost (`EXPO_PUBLIC_LELAP_SCROBBLER_STAND_IN`, development builds only): Settings → Add-ons lists
“Open Library reading log” under Comes with Lelap with the note that it works in the Android app
only, and its set-up page shows the same note instead of the form. Driven from the console, the
add-on ran in a worker sandbox (`isolated: true`) of its own: with only openlibrary.org allowed,
its sign-in was refused before anything left the page (“Not allowed: this add-on may only reach
openlibrary.org.”); with the stand-in allowed, the login reached it and nothing else did. Chrome
sent its own User-Agent instead of Lelap's and kept the `session` cookie from the page, so the
add-on answered 401: the reason the web app doesn't offer it.

Covered by tests: the add-on file run as the sandbox runs it, against answers written from Open
Library's source (`account_login_json`, `process_work_bookshelves`): the S3-key login as JSON with
Lelap's User-Agent, the set-up check (a call without events signs in only), start and finish to
the two shelves with only `bookshelf_id` and `dont_remove`, nothing about the listening sent,
nothing sent for progress, pauses, abandons and ratings (no login either), books without a work
ID skipped and never searched for, `ol` external IDs from other add-ons, the last start or finish
per work with one login and 350 ms between requests, account errors as 401 and passing ones as
5xx, a work Open Library refuses skipped, no keys in its messages, only openlibrary.org or a
stand-in the app allowed. The settings on the device: the secret sealed and opened again, not for
other code, asked for again after a restore on another phone, kept out of sync, exports,
diagnostics and the scrobble outbox, removed with the add-on; the sandbox's hosts.

Open on a phone, with the maintainer's own archive.org account (nothing here created or used one):

- <a id="reading"></a>Settings → Add-ons → Open Library reading log → Set up. Make S3 keys at
  archive.org/account/s3.php, paste them, Check and save: it signs in and the add-on shows in the
  list. Start a Catalog book: within a minute it is on Currently reading at
  openlibrary.org/account/books. Play it to the end: within a minute it moves to Already read, with
  no check-in date added. Check that the JSON login still sets the `session` cookie and that the
  app hands the add-on `set-cookie` on Android; the add-on depends on both.
- <a id="useragent"></a>The stand-in's log on a development build shows
  `User-Agent: Lelap/1 (+https://github.com/lelap-app/lelap)`: set
  `EXPO_PUBLIC_LELAP_SCROBBLER_STAND_IN` to a stand-in on the laptop behind `adb reverse`.
- <a id="already"></a>Start a book that is already on Want to read: it moves to Currently reading
  rather than coming off the shelf.
- <a id="revoke"></a>Make new keys on the same archive.org page: check that the old ones stop
  working, so the next start fails with 401; the add-on then asks to be set up again.
- <a id="restore"></a>Restore a backup on another phone: the reading log asks for its keys again
  (Settings shows “Enter the keys again”), and the export file holds no keys.
- <a id="librivox"></a>A book from the LibriVox add-on outside the Catalog has no Open Library ID:
  nothing is sent.

## Left for later

From the review:

- The app's tracker sends `start` on every resume, so each resume signs in to Open Library once.
  Resuming a finished book moves it back to Currently reading, as with Hardcover.
- `Retry-After` from Open Library is not passed on; a 429 is retried on the outbox's own backoff.
- The User-Agent names the project and its repository but no contact email, which Open Library
  suggests for clients that make many requests. The add-on keeps to 3 requests a second.

Also:

- Books from the listener's own files that M56 linked to a Catalog work are scrobbled without the
  work's ID, so the reading log skips them. Sending the linked work as `externalIds.ol` would cover
  them (and give Hardcover a better match).
- “Mark as finished” in the book menu doesn't scrobble, here or to Hardcover; only playing to the
  end does.
- When settings can't be opened (a restore on another phone), events wait (503) until the keys are
  entered again or for 30 days; the Add-ons screen doesn't yet say so on the add-on's row.
