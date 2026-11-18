---
'@lelap/sdk': minor
---

Protocol revision 5 lets add-ons inside the app work as library sources. `Manifest.settings`
describes the form the app shows when the listener adds the add-on as a server (`SettingField`:
`text`, `url` or `password`; a `url` field marked `host` lets the add-on reach that address);
`readSettings` checks what was typed and `settingHosts` gives the hosts it grants. A new `library`
resource (`GET /library/audiobook/all.json`, `LibraryResponse` of `LibraryFile`s, `libraryPath()`)
lists the listener's files with tags, sizes, covers and IDs, so the app scans them into the
library. Streams and library listings may carry `headers` (`RequestHeaders`), such as a login,
which the app sends only to the add-on's own hosts. Settings, `library` and headers are for add-ons
inside the app only: a manifest without `sandbox` that declares them is invalid, `WebStream` and
`WebStreamResponse` refuse headers, and `createAddon` never serves a stream with headers.
`offersLibrary(manifest)` tells whether an add-on lists a library. Backward compatible for
everything already valid; an app before revision 5 refuses a manifest that lists `library`.
`LATEST_PROTOCOL_VERSION` is now 5.
