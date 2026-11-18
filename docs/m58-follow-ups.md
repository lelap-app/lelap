# M58 follow-ups

Checked in the web preview (Chrome) against Navidrome 0.64.2 in Docker, with two libraries
(“Music Library” and “Audiobooks”) and a few files made with `say` and `ffmpeg`: “Add a server”
shows Subsonic next to HTTP folder with its form; connecting by genre finds both test audiobooks
and leaves the rock album out, and by music folder (“Audiobooks”) only the book in that library.
The server's bookmark came into the library as the book's place (Chapter 2 at 1.5 s; The Secret
Garden at 43 %), and books play in the browser with the token in the address. Pausing saves a
bookmark on the server (`getBookmarks` shows it with the comment “Lelap”), and finishing a book
removes it. API calls go as form posts (`formPost`), each with its own salt; Navidrome's log never
shows a token. The browser now reads the duration of the first file of each server book; before,
asking for the covers folder threw on the web and every read was skipped.

Covered by tests: the bundled add-on run as the sandbox runs it, against answers recorded from
Navidrome (`packages/core/test/fixtures/subsonic/`): genre and music folder, a music folder that
isn't there, a wrong password, a server without OpenSubsonic (plain requests, still a token), a
UTF-8 password longer than one MD5 block, bookmarks both ways, and a place saved from a sandbox
that never listed. The token is never the password, never in a stored address, and not in the
database, sync, exports or diagnostics; download addresses and places from other hosts are left
out. Protocol revision 6 in the SDK. Kotlin: the journal keeps `privateUris`, and a cast request
with it goes through the phone.

Open on a phone:

- <a id="play"></a>Add a Navidrome server (Settings → Servers → Add a server → Subsonic): its
  audiobooks scan in with covers, play with the screen off, and a single-file `.m4b` shows its
  chapters.
- <a id="download"></a>Download a book from it on Wi-Fi: it comes from `download`, not `stream`
  (Navidrome's log says “Downloading”), and plays in flight mode.
- <a id="places"></a>Play a while, pause, open Navidrome's web player: the song shows a bookmark at
  that place. Move the bookmark in another Subsonic app, rescan in Lelap: the place follows.
- <a id="closed"></a>With the app swiped away, the book plays from the notification and from
  Android Auto.
- <a id="cast"></a>Cast a book to a speaker: it plays, and the speaker fetches it from the phone
  (the phone's address in the speaker's app), never with the token.
- <a id="restore"></a>Restore a backup on another phone: the server asks only for its password
  again.
- <a id="gonic"></a>Gonic and Airsonic-Advanced: books by genre and by music folder, places kept.

## Later

- The first file of each book is read by the app for chapters and ISBN or ASIN tags, since
  Subsonic servers expose neither; in the browser that read gives only the duration, so the first
  chapter shows its file name (“001 Chapter 1”) instead of its title.
- A place at 0 is reported when playback starts, before the player has moved to the saved place;
  a scan in between would take it. Jellyfin and Audiobookshelf report the same way.
- Navidrome shows paths it made up unless `Subsonic.DefaultReportRealPath` is on, so a folder
  path is not offered as a way to pick audiobooks.
- Covers come from `getCoverArt` as each folder's `cover.jpg`, fetched with the login like a
  WebDAV cover; the browser keeps no covers folder, so server books show no cover there.
- The stream and download token is made once per scan and kept sealed; Subsonic tokens don't
  expire, so an old one keeps working until the password changes.
- Albums are read with one `getAlbum` per album when only a music folder is chosen; a library of
  thousands of albums may need the 2-minute limit on a listing raised.
- `known` bookmarks live in the server's sandbox; after the app restarts, older bookmarks of a
  book are tidied only after the next scan.

## From the review

Fixed: the playback service's journal and queue, which keep file addresses with their login, are
left out of Android backups; a form post from an add-on asks not to follow redirects (browsers
honour it; whether Android's `fetch` does is open, below), and an answer from another host after a
redirect is not handed to the add-on; a username with letters like ü
works; a download that gets a JSON or XML message instead of the file fails instead of being kept;
finishing a book tidies its older bookmarks even when the server has none for the last file; a
failed `getBookmarks` no longer forgets the known ones; no place is reported for a book with a
file of unknown length; the browser's duration read gives up after 30 s.

Left for later:

- On Android, `fetch` may follow redirects by itself, so a request with the token that a server
  redirects elsewhere (an SSO proxy in front of it) could reach that host before the app refuses
  the answer. Check on a phone with a server that redirects `/rest/` to another host.
- Casting and downloads see no extension in a Subsonic address: receivers get `audio/mpeg` as the
  type for any file, and downloaded parts are named `.audio`. The extension is in the file's path.
- A bookmark's time is the server's clock, compared with the phone's; a server clock running
  ahead lets an older bookmark win.
