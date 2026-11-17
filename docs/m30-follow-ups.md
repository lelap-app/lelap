# M30 follow-ups

Covered by tests with fixtures (no live network): the SDK's `POST /scrobble` route and schemas, the
outbox (order, original timestamps, backoff, drops on 4xx, removed add-ons and age), the tracker
(start, progress every five minutes, pause, finish), the configure pages and sealed settings, the
Hardcover shelf, progress, read and rating calls against a fake GraphQL server, and gPodder play
actions for both server types, including the feed lookup by `guid`.

Open on a phone or against the real services:

- **Hardcover API shapes.** Hardcover's API docs refused automated reading while this was built,
  so the GraphQL (`me`, `user_books`, `insert_user_book`, `update_user_book`,
  `insert_user_book_read`, `update_user_book_read`, `editions`, `search`, and the input type names
  `UserBookUpdateInput` and `DatesReadInput`) follows the public schema as known, not a live check.
  With a real token: configure, play a book for a few minutes, pause, and check Currently reading
  with its progress; finish it and check Read with today's date; check the Want to read row.
- Listening with the app swiped away: the playback service plays without JavaScript, so only
  start, pause and finish seen by the app are reported (finish through `takeFinished`). Progress
  from the service alone isn't reported; decide whether the service should journal it.
- Offline: listen in flight mode, come back online, and check the events arrive with their own
  times (the outbox flushes on start, when the app becomes active, and when an event is due).
- gPodder: with gpodder.net and with Nextcloud gPodder Sync, play an episode, pause, and check
  AntennaPod (synced to the same server) continues at that place.
- The web app posts to add-ons cross-origin; check the CORS preflight for `POST /scrobble` on the
  deployed catalog service.
- The app sends no `abandon` or `rate` yet: there is no rating or "stop reading" control. Add them
  with the item page's next changes.
- Configure pages show the link to paste; the app has no `lelap://` install link handler yet.
- Deploy: set `CONFIG_SECRET` on the catalog Worker (`wrangler secret put CONFIG_SECRET`) before
  announcing the add-ons.
