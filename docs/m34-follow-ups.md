# M34 follow-ups

Covered by tests (`packages/core/src/importers/importers.test.ts`, fixtures in
`packages/core/test/fixtures/`): CSV quoting, Goodreads shelves, ISBN formulas and read dates,
title and author matching, ambiguous titles, AntennaPod feeds, local feeds, unsubscribed feeds,
played marks, places, episodes gone from the feed, a second import changing nothing and a newer
Lelap place winning.

Open on a phone:

- Import a real Goodreads CSV: the counts in the dialog fit, tags show on the matched books and
  the finished books appear in Stats under the year they were read.
- Import a real AntennaPod `.db` export (Settings → Import/Export → Database export): the
  document picker offers the file, expo-sqlite's `deserializeDatabaseAsync` opens it, and the
  episodes show as played or with their place. Check a large export (hundreds of feeds) for time
  and memory; the sheet shows "Loading feed n of m" meanwhile.
- The same AntennaPod file in the web app (sql.js) and its OPML export on both.
- After an import, sync sends the tags, marks, places and subscriptions to a second device.
- AntennaPod's `FeedMedia.position` is assumed to be milliseconds, as everywhere else in
  AntennaPod; confirm with a half-played episode.

Not done:

- **Smart AudioBook Player.** Its backup and per-folder files (`position.sabp.dat`,
  `bookmarks.sabp.xml`) are undocumented. Needs sample files from a real install (a folder with a
  place and two bookmarks) to write the parser; the applying side would match by folder and file
  name against local books and use `saveProgress` and `addBookmark`.
- Goodreads books that are not in the library could be looked up through the Catalog add-on
  (Open Library) for a "Want to read" list once M30 lands.
