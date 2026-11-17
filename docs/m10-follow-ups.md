# M10 follow-ups

What is left of [M10 Your own storage](milestones/m10.md). Built without a phone or
a real server; the listing and signing are unit-tested (the S3 signature matches AWS's own
example).

## 1. How it works

- A **server** is a library root with its settings (`library_roots.remote`): a WebDAV folder with
  a username and password, or an S3-compatible bucket with an optional folder and an access key.
  The settings stay on the device and never sync.
- **Listing:** WebDAV with `PROPFIND`, one level at a time; S3 with `ListObjectsV2` (Signature V4).
  The same rules as for the phone's folder turn files into books.
- **Tags:** Android reads duration, tags and the embedded cover over HTTP with the login
  (`MediaMetadataRetriever`), and the chapter parsers read through HTTP Range requests in 64 KB
  blocks. The web build reads only durations.
- **Playback and downloads:** WebDAV files carry the login as a header, sent only to that host;
  S3 objects play and download through pre-signed links made when needed (valid seven days).
- Removing a server removes its books and places from Lelap; nothing on the server changes.

## 2. Checks

| #   | Check                                                                     | Status  |
| --- | ------------------------------------------------------------------------- | ------- |
| 1   | Nextcloud: add the audiobooks folder with an app password; books appear   | Not run |
| 2   | A WebDAV book plays, seeks, keeps its place, shows its cover and chapters | Not run |
| 3   | A WebDAV book downloads and plays in airplane mode                        | Not run |
| 4   | Cloudflare R2 or MinIO: add a bucket; a book plays and downloads          | Not run |
| 5   | A wrong password says so; a server that is down keeps its books           | Not run |
| 6   | Web: an S3 bucket with CORS lists and plays                               | Not run |

## 3. Known limits and next steps

- **Web dialogs:** `Alert.alert` does nothing in react-native-web, so confirmations and errors in
  the web app (here and since M3) never show. Replace with an in-app dialog (M12).
- WebDAV playback in the browser is not possible (`<audio>` can't send the login); S3 works.
- Credentials sit in the app's SQLite; the Android Keystore is M19.
- Fixed in M53: `cover.jpg` and `folder.jpg` in WebDAV and S3 folders are read for books without
  an embedded cover.
- Audiobookshelf (an add-on with its own API and tokens) is still to do.
- Fixed in M53: downloads can go to a folder of the user's choice, such as one on the SD card.
