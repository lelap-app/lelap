---
'@lelap/sdk': minor
---

Protocol revision 10. A `scrobble` resource can list the `events` it uses, such as
`['finish', 'rate']`, and the app sends only those; `wantsScrobble` takes the event as a fourth
argument. A `rate` without `rating` means the listener took their rating back. The app now sends
`resumed` only to an add-on it told about the book before, and `sessionStartMs` on every `finish`
that ends a session.

The configure page grows into what a service with tokens and lists needs: `text` (an intro, a link,
steps and a note), `url` and `choices` fields (a group of boxes, kept as a list), `placeholder`, a
second page with `choose` whose fields depend on the first (its settings ride along sealed for an
hour), `manifest` for catalogs that depend on the settings, and `legacy` to keep add-on addresses
made before the add-on used this configure. `Config` values can now be lists of strings. The page
after saving copies the address with a tap. `lelap-sdk check` warns of `events` off the scrobble
resource, editions that share a key and a single edition the app never shows.
