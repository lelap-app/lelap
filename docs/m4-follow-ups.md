# M4 follow-ups

What is left of [M4 Downloads](roadmap.md#m4-downloads) after PR #14. Built and unit-tested
without a phone; nothing below has run yet. M4 stays “In progress” until the device checks pass.

## 1. Device checks

Steps are in [`apps/app/README.md`](../apps/app/README.md#m4-device-checklist).

| #   | Check                                                     | Status  |
| --- | --------------------------------------------------------- | ------- |
| 1   | First download asks for notifications and battery leave   | Not run |
| 2   | Progress on the item page, storage screen, notification   | Not run |
| 3   | Wi-Fi off mid-download waits, then resumes from the byte  | Not run |
| 4   | “Only while charging” waits for a charger                 | Not run |
| 5   | Swiping the app away keeps the download going             | Not run |
| 6   | **Done-when:** a long book overnight, screen off          | Not run |
| 7   | **Done-when:** the downloaded book plays in airplane mode | Not run |
| 8   | Remove download while playing switches to the stream      | Not run |
| 9   | Removing the book from the library deletes its files      | Not run |

## 2. Risks to watch on the device

- Android 12+ refuses a foreground start from the background without the battery exemption; the
  worker then runs as a plain job (about 10 minutes per run) and resumes. Check the overnight
  download with and without the exemption.
- Android 15+ limits `dataSync` foreground work to 6 hours a day; a stopped run resumes later.
- `POST_NOTIFICATIONS` is asked through `PermissionsAndroid`; confirm the dialog appears on
  Android 17.

## 3. Deferred

- A download already queued shows “Download” again in the Library's long-press menu until it
  finishes; pressing it restarts the job (it resumes, so nothing is lost).
- A queued row whose job folder is gone (app data partly cleared) shows “Waiting” forever.
- Removing a streamed book while it plays from its downloaded files leaves the player on deleted
  files until the next load.
