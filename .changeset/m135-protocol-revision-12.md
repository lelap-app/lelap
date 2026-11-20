---
'@lelap/sdk': minor
---

Protocol revision 12, for add-ons inside the app with a library. A `LibraryFile` can carry the
book's `description`, `language` and `series` (from the book's first file, in place of the file's
own), and a `ref`: the add-on's own note for the file, which the app stores and hands back in
place reports. A `LibraryResponse` can carry `digest`, a user name and password that the app
answers with HTTP Digest per request on the phone, for servers such as Calibre's content server
without https. Each file of a `PlaceReport` now has its `durationMs` where the app knows it, and
its `ref`. `X-Lelap-Digest` is a header the app keeps for itself.
