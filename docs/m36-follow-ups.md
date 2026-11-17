# M36 follow-ups

Covered by tests with recorded JSON fixtures (no live network): sign-in and the `MediaBrowser`
header, refused logins, the library list with the fallback to the pre-10.9 route, paging through
items, items turned into books (albums, folders, chapters, covers, authors), stream addresses
with the token as a header or `api_key`, progress reports in ticks, played marks with the route
fallback, and places merged both ways (newer wins, played parts, finished books).

Open on a phone, against a real Jellyfin server:

- **Sign-in and libraries.** On Jellyfin 10.9 or later and on 10.8: add the server, test the
  connection, check the Books library is picked and a music library can be added. Check that
  Jellyfin's Dashboard → Devices shows "Lelap" once, and that logging in again from Settings
  reuses that device instead of adding another.
- **Books.** A library with single `.m4b` files (chapters shown), one with a folder of `.mp3`
  parts per book (one book, parts in order), and a music album. Check titles, authors and
  covers. A server behind a path (`https://host/jellyfin`) too.
- **Playback.** Plays without transcoding (Dashboard → Activity shows Direct Play), seeks, and
  downloads with the header. On the web build: plays with `api_key` when the server allows the
  site; the CORS hint appears when it doesn't.
- **Two-way progress.** Play in Lelap, pause, and check the Jellyfin web client resumes there;
  play further in the Jellyfin web client, rescan in Lelap, and check Lelap moves to that place.
  Finish a book in Lelap and check it shows played in Jellyfin. Check whether
  `/Sessions/Playing/Progress` updates the item's "last played" date: the merge compares that
  date with Lelap's own, so if it doesn't, Lelap's place wins until another client plays there.
- **Casting.** A cast device can't send headers: casting a Jellyfin book may need `api_key` in the
  address instead. Check with Chromecast and a UPnP renderer.

Not in this milestone:

- Narrators are read (`jellyfinPeople`: Narrator, else Composer) but the library has no narrator
  field yet, so they aren't shown.
- Reports are best effort, without an outbox: a place reported while offline is lost and reaches
  Jellyfin with the next report for that book. An outbox like the scrobble one would close that.
- Reports go out only while the app runs (like scrobbles, M30): listening with the app swiped
  away reaches Jellyfin at the next start, pause or finish the app sees.
