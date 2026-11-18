# M61 follow-ups

Checked in the web preview (Chrome), with the catalog Worker under `wrangler dev` and a stand-in
for Open Library's login and bookshelves endpoints on localhost (`OPEN_LIBRARY_URL`): the configure
page at `/open-library/configure` refused a wrong secret with “Open Library did not accept these S3
keys” and made a sealed link for the right ones. Pasted under Settings → Add-ons, the add-on showed
as Working. Playing Walden from the Catalog (`ol:OL55649W`, audio from LibriVox) put
`OL55649W` on shelf 2 (Currently reading); playing it to the end put it on shelf 3 (Already read)
within seconds. Each request carried only `bookshelf_id` and `dont_remove`, the `session` cookie
and `User-Agent: Lelap/1 (+https://github.com/lelap-app/lelap)`.

Covered by tests, against answers written from Open Library's source (`account_login_json`,
`process_work_bookshelves`): the S3-key login and the cookie it sets, keys never in the link,
keys refused while configuring and later (401), an email and password refused before anything is
sent, start and finish to the two shelves, nothing sent for progress, pauses, abandons and ratings
(no login either), books without a work ID skipped and never searched for, `ol` external IDs from
other add-ons, only the last start or finish per work, one login per batch and 350 ms between
shelf requests, 429 and refused writes retried later, a link sealed for another add-on refused.

Open with a real account (the maintainer's; nothing here created or used one):

- <a id="keys"></a>Make S3 keys at archive.org/account/s3.php, paste them on
  `https://catalog.lelap.app/open-library/configure` (after the next services deploy): the page
  makes a link. Check that the JSON login with S3 keys still sets the `session` cookie; the
  add-on depends on it.
- <a id="reading"></a>Add the link in Lelap on a phone, start a Catalog book: within a minute it
  is on Currently reading at openlibrary.org/account/books.
- <a id="read"></a>Play it to the end: within a minute it moves to Already read, with no check-in
  date added.
- <a id="already"></a>Start a book that is already on Want to read: it moves to Currently reading
  rather than coming off the shelf.
- <a id="revoke"></a>Make new keys on the same archive.org page: the next start fails with 401 and
  the add-on asks to be configured again.
- <a id="librivox"></a>A book from the LibriVox add-on outside the Catalog has no Open Library ID:
  nothing is sent.

## Left for later

- Books from the listener's own files that M56 linked to a Catalog work are scrobbled without the
  work's ID, so this add-on skips them. Sending the linked work as `externalIds.ol` would cover
  them (and give Hardcover a better match).
- “Mark as finished” in the book menu doesn't scrobble, here or to Hardcover; only playing to the
  end does.
- Each batch with a start or finish signs in again; Open Library's login goes through archive.org.
  If that proves slow or limited, the Worker could keep the session in memory for a while, at the
  cost of holding a live session on the server.
