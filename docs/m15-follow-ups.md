# M15 follow-ups

What is left of M15 Find any book ([M15](milestones/m15.md)) after its first pull
request. M15 stays “In progress” until the device checks pass.

## What landed

- `findSources` in `packages/core` asks every installed add-on with a `stream` resource once, for
  the first of the work's IDs it takes: its own ID, then its `externalIds` as `prefix:value`. An
  add-on that knows the work's own ID is never also asked for a look-alike external one. Repeated
  streams (same add-on and `sourceKey`) are dropped; add-ons that fail are named, not fatal.
- The item page lists every source (“LibriVox · Read by …” with the add-on, length and parts) and
  remembers the choice per book and profile in the `settings` table under `source:<type>:<id>`,
  which ordinary settings and sync ignore. No migration. A book already in the library starts on
  the source it plays.
- A work without audio shows “No audio for this book yet” with how many add-ons were asked and a
  way to Settings → Add-ons, next to its description, language and subject tags, and a “More about
  this book” link to the meta's `link`.
- Checked in the web preview: an Open Library work with four LibriVox recordings, the choice kept
  after a reload, and an Open Library-only work.

## 1. Device checks

Not run (no phone testing for now).

| #   | Check                                                                                           | Status  |
| --- | ----------------------------------------------------------------------------------------------- | ------- |
| 1   | An Open Library work with several LibriVox recordings lists them all; Play plays the one picked | Not run |
| 2   | The picked source is still selected after closing and reopening the app                         | Not run |
| 3   | Picking another source for a book in the library and pressing Play moves the book to it         | Not run |
| 4   | An Open Library-only work shows the no-audio card; “Manage add-ons” opens the add-ons screen    | Not run |
| 5   | “More about this book” opens the work's page in the browser                                     | Not run |
| 6   | Offline, a downloaded book's page still plays and shows its saved metadata                      | Not run |

## 2. Open points

- **Editions:** the protocol has no list of editions, only `year`. Showing editions (and choosing
  between them) needs an optional field on `Meta` in the SDK; left for a later protocol change.
- **Self-hosted sources:** a server add-on that answers `ol:` or `asin:` IDs would show up in the
  list next to LibriVox; none of the first-party add-ons does yet.
- **Choice and sync:** the choice stays on the device. Syncing it would need a new op kind.
