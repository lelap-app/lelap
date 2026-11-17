# M41 follow-ups

Covered by tests with JSON fixtures (no live network): sign-in with a refresh token and with a
pre-2.26 token, refused logins and an address that isn't Audiobookshelf, token renewal with the
rotated refresh token, JWT expiry, book libraries only, listing and batch fetching of items,
items turned into books (tracks in order, chapters for one-file and several-file books, authors,
covers), stream addresses with the token as a header or `?token=`, progress reports in seconds
of the whole book and finished books, places merged both ways (newer wins, finished books), and
a cleared login asking for a new one.

The fixtures are written by hand from Audiobookshelf's source (models `LibraryItem`, `Book`,
`MediaProgress`, `User`, controllers `Library`, `LibraryItem`, `Me` and `Auth`), not recorded:
Docker was not running on the machine that built this milestone.

Checked in the web preview against a stand-in server answering from those fixtures (with CORS):
add the server with a password, the library list with its switch, connect, the scan (two books
with authors and places), playing a book (the stream carries `?token=`, start and pause send
`PATCH /api/me/progress` in seconds of the book) and the renewal of the access token after a
reload. The web scan of any server used to stop at the covers folder, which the web build
doesn't have; it is now only made for folder, WebDAV and S3 scans.

Open on a phone, against a real Audiobookshelf server:

- **Sign-in and libraries.** On 2.26 or later and on an older version (2.25 or before): add the
  server with a password, test the connection, check the book libraries are picked and podcast
  libraries are not listed. Then with an API key from Settings → API Keys. A server behind a path
  (`https://host/audiobookshelf`) too.
- **Books.** A library with single `.m4b` books (chapters shown), books of several `.mp3` files
  (one book, parts in order, a chapter per file) and a book with excluded files. Check titles,
  authors and covers.
- **Playback.** Plays the original file, seeks, and downloads with the header. On the web build: plays with `?token=` when the server allows
  the site; the CORS hint appears when it doesn't.
- **Two-way progress.** Play in Lelap, pause, and check Audiobookshelf's web player resumes
  there; play further in the web player, rescan in Lelap, and check Lelap moves to that place.
  Finish a book in Lelap and check it shows finished in Audiobookshelf, and the other way.
- **Long sessions with a password login (2.26 on).** Access tokens last about an hour, and the
  playback service keeps the headers it was given when the book loaded. Play one streamed book
  for over an hour and seek: check it keeps playing. Start a download that waits for Wi-Fi and
  let it start more than an hour later: check it downloads. If either fails, the fix is to hand
  the service fresh headers on a timer, or to recommend API keys; the API key login has neither
  problem.
- **Expired login.** Leave a password login unused past the refresh token's life (set
  `REFRESH_TOKEN_EXPIRY=120` on a test server to try it in minutes): Settings shows “Log in” and
  logging in again keeps the books and places.
- **Casting.** A cast device can't send headers: casting an Audiobookshelf book may need
  `?token=` in the address instead. Check with Chromecast and a UPnP renderer.
- **Covers on old servers.** Servers before covers were opened to read without a login show the
  placeholder instead (the token is never put in a stored cover address).

## Review findings left for later

From the review of this pull request; the important ones (token renewal for every book, a
refused API key never asking for a login, an older Lelap place overwriting the server's, short
token lives, a renewal overwriting a new login, the cached parts after a rescan) are fixed.

- **Password logins and long waits** (important, open): headers are fixed when a book loads or a
  download is queued. See “Long sessions” above; handing the service fresh headers is the fix
  if the phone check fails.
- Logging in again starts with the password form even when the server was added with an API
  key, and doesn't warn when it is a different Audiobookshelf user than before.
- A track whose extension Lelap doesn't know is left out without a word; a book without a title
  is named after its item ID.
- When the profile that added the server is deleted, its places come in for the first profile
  but none go back out.
- Casting doesn't renew the token or put it in the address (see Casting above).
- Not tested: the app side of renewals (one at a time, a refused one clearing the login, keeping
  the cached token offline); it lives in `apps/app/src/audiobookshelf.ts`, which has no unit
  tests, like the Jellyfin reports.

Not in this milestone:

- Podcast libraries on Audiobookshelf; Lelap follows podcasts by their RSS feeds.
- Chapters inside the files of a book of several files: each file is one chapter.
- Narrators and series are read by Audiobookshelf but the library has no field for them yet.
- Reports are best effort, without an outbox, and go out only while the app runs, as for
  Jellyfin (M36).
