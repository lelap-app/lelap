# M53 follow-ups

What is left of [M53 Storage choices](milestones/m53.md).

Checked in the web preview: Settings → Downloads shows “Download folder” with the note that
choosing a folder is in the Android app. Covered by tests: Atom feeds (fixture
`packages/core/test/fixtures/atom.xml`: entries with an audio enclosure, `<updated>` standing in
for `<published>`, author, logo, Podcasting 2.0 chapters) subscribing like RSS, and OPML outlines
of type `atom`; picking `cover.jpg`/`folder.jpg`/`cover.png` per folder in any case, and the cache
name that changes with the image; download paths following books to a chosen folder, clearing
while it can't be reached and coming back, and never deleting a download that can't be seen
(core, Vitest); the library scan leaving out Lelap's own downloads inside the library folder.
On the JVM (`:lelap-download:testDebugUnitTest`): copying a book's files under a temporary name,
checked by length, never touching the originals; a copy that breaks off or comes out short never
gets the file's name; a second run skips finished copies; the list of old copies never deletes
the place a book lives in again; jobs from before M53 stay in private storage.

## How it works

- Each book keeps `job.json` in the app's private storage. Its `location` says where its files
  are: null for private storage, or the tree URI of the chosen folder, where they sit in
  `Lelap/<book>/` (with `.nomedia`, and `.lelap-downloads` so Lelap's own library scan skips
  them).
- A new download goes to the current folder; a book keeps the folder its files are in.
- Choosing a folder (or “Move back”) starts `MoveWorker`. Per book: a book still downloading is
  skipped and moved when it finishes; otherwise every file is copied as `name.move`, checked by
  length and renamed. Then, under the same lock that starting a download takes, the move checks
  that the job is unchanged (same `revision`, which every start renews, same folder, no work
  running), lists the originals in the book's private `old.json` and points `job.json` at the new
  folder. A book started again, removed or moved meanwhile keeps its folder, and the copies go
  unless the book now lives where they are.
- The originals are deleted only when the app asks (`releaseOld`): after the fold has written the
  new paths and the player has reloaded the book, or, for the book that is playing, once it is
  paused. A stop or a crash at any point leaves every book whole in one of the two folders; the
  next run, started when the app comes to the front, skips copies that are already complete.
- A folder that can't be reached (SD card out, permission gone) reports its books as
  `unavailable`: they stream where they can and keep their download, and they are never deleted
  as orphans. New downloads into it fail with a message saying so.
- Exports (library, diagnostics, OPML) are written to the cache folder and handed to the share
  sheet as files through `expo-sharing` 58.0.22 (58.0.23, which Expo's SDK lists, is younger than
  the 7 days `minimumReleaseAge` asks for). The web still downloads them.
- Server folder covers: WebDAV and S3 images are fetched by the phone with the same login as the
  audio, saved in the covers folder under a name made from the file's location, size and date, so
  an unchanged cover is not fetched again. Jellyfin and Audiobookshelf already give the folder's
  image through their own cover addresses. The web app keeps no covers folder and skips them.

## On a phone

- Settings → Download folder → Choose, pick a folder on the SD card: downloaded books move there
  with a “Moving downloads” notification, `adb shell ls /storage/<card>/<folder>/Lelap/` lists
  them, a file manager shows them, and they play in airplane mode.
- Start a download, then choose a new folder while it runs: it finishes, then moves; nothing is
  downloaded twice.
- `adb shell am kill app.lelap` during the move of a large book, then open the app: the move
  carries on, and every book plays from one of the two folders.
- Move back: the books return inside Lelap and the `Lelap` folder on the card is empty.
- Choose a folder inside the library folder: a rescan adds no second copy of the downloaded books.
- Take the SD card out with books on it: they stream where they can, Settings says the folder
  can't be reached, and nothing is deleted. Put it back: they play from the card again.
- A book that plays while it moves keeps playing to its end from the old copy, and the old copy is
  gone (`adb shell run-as app.lelap ls no_backup/downloads/<book>/`) after pausing.
- Remove a download that lives on the card: its folder in `Lelap/` goes too.
- Export library, diagnostics and OPML each open the share sheet with a file
  (`lelap-library-….json`, `.txt`, `.opml`); Files saves it under that name.
- Paste an Atom podcast feed in the Podcasts tab: it subscribes, lists its episodes and plays one.
- A WebDAV book without an embedded cover and with `Cover.JPG` in its folder shows that cover after
  a scan, offline too; an S3 book with `folder.jpg` the same.

## Known limits

- A book waiting in Up Next inside the playback service keeps the paths it was queued with. If it
  moved and its old copies were released before it starts, it streams or fails to start; the app
  hands the service a fresh queue on its next change.

- The permission on an old download folder is kept after moving away from it: the same folder may
  also be the library folder, whose read permission must stay.
- Leftover `name.move` files can stay in a folder that was chosen, left mid-move by a crash, and
  then never chosen again.
- On the web, books from a WebDAV or S3 server show no folder cover.

## Review findings left for later

- A move that fails (such as a full card) also fails a move queued behind it, until the app comes
  to the front again and starts a new one.
- A server folder's cover is fetched once even for books with an embedded cover, one at a time on
  the first scan; replaced versions in the covers folder are not pruned.
- An Atom entry whose `<content type="xhtml">` holds nested elements gets no description from it
  (the summary is used when there is one).
