# M59 follow-ups

Checked in the web preview (Chrome) against Emby Server 4.10.2 in Docker, with an “Audiobooks”
library of two books made with `say` and `ffmpeg` (one in two MP3 parts with a `cover.jpg`, one
`.m4b` with two chapters) and a “Music” library: “Add a server” shows Emby and Plex next to
Subsonic and HTTP folder. Emby connects with a username and password, finds the four files of the
audiobook library and leaves the music library out. The place set on the server (Chapter 2 at
1.5 s) came in as the book's place, and the book marked played on the server shows as finished.
The book plays in the browser with the token in the address (`api_key`); pausing and finishing
save the place on the server (`UserData` shows the new position, and the last part played).
Emby's CORS headers let the browser in without changes. Plex's form shows a Sign in button; with
plex.tv's answers faked inside the page (no Plex account was used, and nothing reached plex.tv),
the button shows the code and an “Open plex.tv” button, the app asks every 2 s, and the form then
fills in the server's name and its addresses at home and away, leaving out the relayed one.

Covered by tests: both add-ons run as the sandbox runs them. Emby against answers recorded from
that server (`packages/core/test/fixtures/emby/`): books and parts in order, chapters, covers from
the folder, places both ways, an API key with a username instead of a password, libraries by name,
a wrong password, one device ID per server and user. Plex against hand-written answers in the
shapes plex.tv and Plex Media Server give (`packages/core/test/fixtures/plex/`): the PIN flow as
the product Lelap with one client ID, the owned server or one named, local before remote and never
a relay, an address where another server answers gets no token, the account's token only to
plex.tv and the server's only to its checked address, plex.tv offline at home, view offsets both
ways and a scrobble at the end, a sandbox that never listed. Containment: the sign-in is sealed
like a password and kept out of sync and exports; the token goes as a header on the phone and in
the address only in the browser, and never to another host. Protocol revision 7 in the SDK.

Open on a phone:

- <a id="emby"></a>Add an Emby server (Settings → Servers → Add a server → Emby) with a username
  and password: its audiobook library scans in with covers and chapters, and books play with the
  screen off.
- <a id="emby-download"></a>Download a book from it on Wi-Fi: it comes from `/Items/…/Download`,
  and plays in flight mode.
- <a id="emby-places"></a>Play a while and pause, then open Emby's web app: the part shows the
  place (“Resume”). Move the place there, rescan in Lelap: the place follows.
- <a id="emby-key"></a>An Emby API key with a username, instead of the password: the same books.
- <a id="plex-signin"></a>Plex (needs the maintainer's account): press Sign in, open the link on
  another device and enter the code. The form fills in the server and its addresses; plex.tv's
  Authorized Devices lists “Lelap”, once, also after signing in again.
- <a id="plex-play"></a>With “Audiobooks” as a music library on Plex: the books scan in with
  covers, play with the screen off, and a single-file `.m4b` shows its chapters.
- <a id="plex-away"></a>Away from home (mobile data): a rescan finds the server at its address
  away from home; with remote access off, the scan says it can't reach the server, and nothing
  plays through a relay.
- <a id="plex-places"></a>Pause a book from Plex, open Plex Web: the track shows the place. Finish
  the book: the last track is marked played.
- <a id="cast"></a>Cast a book from Emby and from Plex: it plays, fetched through the phone, never
  with the token.
- <a id="restore"></a>Restore a backup on another phone: Emby asks for its password again, Plex for
  a new sign-in.

Open in a browser:

- <a id="web-plex"></a>Plex in the web app with a real account: the sign-in, a scan and playback
  with `X-Plex-Token` in the address over a `plex.direct` connection (Plex Media Server's CORS
  headers).

## Later

- Plex's `/:/progress` ignores places in the first and last few percent of a track and marks a
  track played near its end, so a short part's place may not stick on the server; the next scan
  takes the newer of the two.
- Plex's addresses come from plex.tv at sign-in. When the server's address changes (a new IP at
  home or away), the listener signs in again; the add-on can reach only the addresses in the form.
- A book's file addresses are those of the address that answered at the last scan; after leaving
  home, books play once a scan has found the server away.
- The first track of a Plex book is read by the app for chapters and ISBN or ASIN tags, as for
  Subsonic; in the browser that read gives only the duration.
- Plex's “Libraries” setting takes names; a list to pick from would need the server's libraries
  before the server is a host, which the sign-in can't reach yet.
- A Plex place saved after the app restarts makes the add-on list the libraries again first, to
  find the track; for a large library that may run past the 20 s a place report may take.
- Emby's API key reaches every user's library; the form says the password is the better choice.
