---
'@lelap/sdk': minor
---

Protocol revision 9. `Meta.editions` lists a work's editions (`Edition`: `key`, `name`, `year`,
`narrators`, `publisher`, `language`, `cover`, `durationMs`, `externalIds`), which the item page
lets the listener choose from; a list that does not fit is dropped, not the item. A `start` event
can carry `resumed: true` when the listener carries on with a book begun before, so trackers can
leave the book where it is. `LibraryResponse.next` lets a library come in pages: the app asks again
with `args.library.cursor`. An add-on inside the app with `settings` and no `library` is set up under
Settings → Add-ons and gets its settings on every call; `setUpWithSettings(manifest)` tells which.
`AddonError` takes `{ retryAfter }` and sends it as `Retry-After`. The configure pages say who runs
them (“This page is run by {host}, not by Lelap.”), no longer name Lelap as the sender, and use the
new `PAGE_STYLE`. Backward compatible: older apps ignore the new fields, and older add-ons work as
before. `LATEST_PROTOCOL_VERSION` is now 9.
