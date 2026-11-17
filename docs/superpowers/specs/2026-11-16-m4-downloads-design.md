# M4 Downloads: design

Status: builder's design, written with the code. Milestone: [M4 in the roadmap](../../milestones/m4.md).

## Intent

A book streamed from an add-on (M3) can be downloaded to the phone. Downloads run in a native
background worker that obeys Wi-Fi and charging rules, survive the app being closed and the phone
sleeping, and resume where they stopped. A downloaded book plays from its files, with its cover,
chapters and a snapshot of the add-on's metadata, so it works in airplane mode. A storage overview
shows what takes space and removes it.

**Done when** a book downloads overnight with the screen off and plays in airplane mode.

## Goals

- **Download** and **Remove download** on the item page and in the Library's long-press menu, for
  streamed books whose stream does not say `downloadable: false`.
- Rules: Wi-Fi only (default on) and only while charging (default off), applied to queued and
  running downloads when changed.
- Resume after a lost connection, a reboot, the app being swiped away or the rules pausing it.
- Cover, chapters and the add-on's `Meta` kept with the download.
- Downloads and storage screen: used by Lelap, free on the phone, each download with its state and
  size; remove, cancel and retry.
- Battery optimisation exemption asked for on the first download (`docs/brief.md`, Android notes).

## Non-goals

- Downloading local books (already on the phone) or single chapters.
- Auto-download rules and podcast episodes (M5).
- The web build's storage (M6, OPFS).
- Choosing the storage location (SD cards). Files live in the app's no-backup storage.
- The `/resolve/…` retry flow: archive.org links do not expire (as in M3).

## Approaches

**Download engine** (builder's call). Considered: (A) Android's `DownloadManager`; (B) Media3's
`DownloadService` with its cache; (C) WorkManager with an own HTTP loop. **Chosen: C.** A keeps
files in shared external storage and has no charging rule before the job starts on every version;
B stores audio in Media3's cache format, so files are not plain files and playback must go through
a `CacheDataSource`. C gives plain files, WorkManager constraints (`UNMETERED`, `requiresCharging`,
`requiresStorageNotLow`) that survive reboots, backoff, and a `dataSync` foreground notification.

**Who knows a download finished.** As with M2's position journal: the app owns SQLite. The worker
writes only files (`job.json`, `.part` files, an error file). The app reads native statuses on
start, on return to the foreground and every 1.5 s while a download is active, and folds them in.

## Architecture

```
packages/core     downloads table, planning (file names, sizes), folding native statuses in,
                  removal, storage list; Vitest
modules/download  Kotlin: WorkManager worker, HTTP with Range resume, notification, storage and
                  battery calls; pure rules unit-tested on the JVM
apps/app          platform adapter, download actions, item page button, Downloads screen
```

### Data (migration `0003_downloads`)

- `downloads` (shared: downloaded files are stored once, see M9): `book_id` (PK, cascades with the
  book), `state` (`queued` | `done` | `failed`), `bytes_total`, `error`, `meta` (the add-on's
  `Meta` as JSON), `requested_at`, `completed_at`, `updated_at`.
- `book_files.download_path`: the absolute path of a part's downloaded copy, or null.
- `books.cover_path` points at the downloaded cover; adding the book again from the item page no
  longer clears it.
- `AddonItemRef.downloadable`: false when the stream said so.

Playback uses `file://<download_path>` for every part that has one and the URL for the rest, so a
half-finished download still plays.

### Native module

`job.json` per book in `noBackupFilesDir/downloads/<bookId>/` holds the parts (URL, file name,
expected size), the cover and the rules. One unique work per book (`download:<bookId>`) downloads
the missing parts in order to `<name>.part`, renames each when complete, then the cover. A part
resumes with `Range: bytes=<n>-`: 206 with a matching start appends, 200 starts over, 416 with
the expected size counts as complete. Redirects are followed by hand (also across http and https).
4xx other than 408 and 429 fail the download; other errors retry with exponential backoff.

Statuses: `waiting` (enqueued or blocked by a rule), `running`, `done` (every part on disk),
`failed` (with a message), and `stopped` (no work and not done, for example after a force stop).
Changing the rules re-enqueues unfinished work with new constraints; the parts resume.

### Screens

- Item page: under Play, `Download · 245 MB`, `Waiting for Wi-Fi`, `Downloading · 45 %`,
  `Downloaded · Remove`. Offline, the page shows the snapshot.
- Library: `Downloaded` instead of `Streaming`; long-press adds Download or Remove download.
  Removing a book from the library removes its download.
- Settings → Downloads and storage: the rules, `Lelap uses 1.2 GB · 34 GB free`, and each download.

## Tests

- Core: file names, planning (sizes, refusal for local and non-downloadable books), folding a
  `done` status into paths and the cover, failure and retry, removal, the cover surviving
  `addStreamedBook`, played files using local copies, the migration.
- Kotlin: the resume decision table, `Content-Range` parsing, the job codec, name validation and
  status derivation.
- Device checklist in `apps/app/README.md`: overnight with the screen off on Wi-Fi, a rule change
  mid-download, airplane mode playback, removal while playing.
