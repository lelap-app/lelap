---
'@lelap/sdk': minor
---

Protocol revision 6 lets library sources inside the app keep places with their server and log in
through the address. `LibraryResponse.query` (`QueryParams`) holds query parameters the app adds
to every file and download address (and a folder's `cover.jpg`) on the add-on's own hosts, sealed
like `headers` and never stored in a file's address, for servers that take a login only there, such as the Subsonic
API. A `LibraryFile` may carry `downloadUrl`, where the app downloads it from, and `place`
(`LibraryPlace`), the listener's place in it as the source keeps it; the newest place wins. A new
`place` resource gets a `PlaceReport` (`placePath()`) when the listener's place moves, so the
add-on can save it on the server. `place` is for add-ons inside the app only, and
`offersPlaces(manifest)` tells whether an add-on keeps places. Backward compatible for everything
already valid; an app before revision 6 refuses a manifest that lists `place`.
`LATEST_PROTOCOL_VERSION` is now 6.
