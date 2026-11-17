# M46 follow-ups

Checked in the web preview (wide and 375 px wide): after marking “The Adventures of Tom Sawyer”
finished, Home shows “Because you finished The Adventures of Tom Sawyer” with two Mark Twain
books from LibriVox's “Most listened” page. The only catalog requests on that load were Home's own
`new.json` and `popular.json`; no stream lookup went out for a suggestion that Home's rows did not
show themselves. Hide removes the row and says where to show it again; Settings → Catalogs →
Suggestions on Home brings it back.

Covered by tests: `packages/core/src/recommend.test.ts` checks the scoring (same author, shared
title words, download genres, hours per author, weak matches left out, podcasts left out, limits),
that nothing in the library or already shown is suggested, that a row follows the last finished
book, that a kids profile only gets rows from what it may see, and that the requests are Home's
first-page requests and the same whatever the profile finished. `settings.test.ts` the new
setting's default.

## Open on a phone

- <a id="row"></a>Finish a streamed LibriVox book (or mark it finished): Home shows “Because you
  finished …” with books by the same author or from the same series, none of them in the
  Library. Finish another: its row comes first.
- A kids profile with a shelf: a finished shelf book gives a row; a grown-up's finished book does
  not show up in the kid's rows.
- Hide on the row: the row goes, a dialog says where to turn it back on; switching profiles keeps
  the other profile's choice.
- TalkBack reads the row's title as a heading and Hide as “Hide suggestions”; Hide is at least
  48 dp.

## Review findings left for later

- Covers of suggested items load from the URL in the add-on's catalog page. That host sees the
  same request when the listener scrolls Home's row to the item, but a suggestion may show it
  earlier. Covers on the web go through the proxy only for plain http.
