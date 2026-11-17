# M41 follow-ups

Covered by tests with JSON fixtures (no live network): the API key checked with `/api/me`, a
refused key (“ask for a new key”) and an address that isn't Audiobookshelf, book libraries only,
listing (several pages, several libraries) and batch fetching of items, items turned into books
(tracks in order, chapters for one-file and several-file books, authors, covers), stream
addresses with the key as a header or `?token=`, the place in one book, progress reports in
seconds of the whole book and finished books, places merged both ways (newer wins, finished
books), and a refused key marked on the server and cleared by a working one or a new key, with
the server's books kept.

The fixtures are written by hand from Audiobookshelf's source (models `LibraryItem`, `Book`,
`MediaProgress`, `User`, controllers `Library`, `LibraryItem` and `Me`), not recorded: Docker was
not running on the machine that built this milestone.

Checked in the web preview against a stand-in server answering from those fixtures (with CORS),
before the change to API keys only: the library list with its switch, connect, the scan (two
books with authors and places), and playing a book (the place read first, the stream with
`?token=`, start and pause sending `PATCH /api/me/progress` in seconds of the book). The web scan
of any server used to stop at the covers folder, which the web build doesn't have; it is now
only made for folder, WebDAV and S3 scans. With API keys only: a key the stand-in server then
refused marked the server on playing a book; Settings showed “Audiobookshelf refused the API
key” with “Change key”; the refused key was turned down again on the Change key screen, and a new
key cleared the mark, kept the server and its books, and was used for the next requests.

Open on a phone, against a real Audiobookshelf server (2.26 or later):

- **API key and libraries.** Make a key in Settings → API Keys, add the server with it, test the
  connection, check the book libraries are picked and podcast libraries are not listed. A server
  behind a path (`https://host/audiobookshelf`) too.
- **Refused key.** Turn the key off in Audiobookshelf, then play a book or rescan: Settings shows
  “Audiobookshelf refused the API key” with “Change key”. Enter a new key: the books and places
  stay, and the mark goes.
- **Books.** A library with single `.m4b` books (chapters shown), books of several `.mp3` files
  (one book, parts in order, a chapter per file) and a book with excluded files. Check titles,
  authors and covers.
- **Playback.** Plays the original file, seeks, and downloads with the header, also a download
  that waits for Wi-Fi. On the web build: plays with `?token=` when the server allows the site;
  the CORS hint appears when it doesn't.
- **Two-way progress.** Play in Lelap, pause, and check Audiobookshelf's web player resumes
  there; play further in the web player, then play in Lelap, and check it starts at that place.
  Finish a book in Lelap and check it shows finished in Audiobookshelf, and the other way.
- **Casting.** A cast device can't send headers: casting an Audiobookshelf book may need
  `?token=` in the address instead. Check with Chromecast and a UPnP renderer.

## Review findings left for later

From the review of this pull request; the important ones that still apply with API keys (an
older Lelap place overwriting the server's, the cached parts after a rescan) are fixed.

- A track whose extension Lelap doesn't know is left out without a word; a book without a title
  is named after its item ID.
- When the profile that added the server is deleted, its places come in for the first profile
  but none go back out.
- Casting doesn't put the key in the address (see Casting above).

Not in this milestone:

- Audiobookshelf before 2.26, which has no API keys, and sign-in with a password (see the
  Audiobookshelf login decision in the [brief](brief.md)).
- Podcast libraries on Audiobookshelf; Lelap follows podcasts by their RSS feeds.
- Chapters inside the files of a book of several files: each file is one chapter.
- Narrators and series are read by Audiobookshelf but the library has no field for them yet.
- Reports are best effort, without an outbox, and go out only while the app runs, as for
  Jellyfin (M36).
