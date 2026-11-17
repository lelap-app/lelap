# M49 follow-ups

Checked in the web preview (375×812, with the catalog worker from this branch on `wrangler dev`):
Discover → Most listened shows ★ ratings from archive.org reviews on the LibriVox covers, and each
tile's name ends in “Rated 4.6 of 5”. The item page draws the same rating on its cover, read as
one picture: “Cover: Rated 4.9 of 5”. After a few seconds of playing, the Library row showed
“1 %” on its cover (since the review, Library rows and the Continue listening card leave progress
to their own bar and text); after Mark as finished, the book's tile on Discover and Home
shows ✓ next to its rating, named “…, Finished, Rated 4.9 of 5”. Home's catalog rows and
“Because you finished …” rows draw the same badges. Settings → Catalogs → Badges on covers off:
no badges and no badge words in Search, Discover, Home and the Library; on again, they return.

Covered by tests:

- `packages/sdk/src/protocol.test.ts`: `badges` kept, missing (older add-ons), unknown fields
  dropped, badges that do not fit (a rating of 7, text, `null`) dropped while the item stays, carried over to `Meta`; `addon.test.ts`: `createAddon`
  declares revision 4.
- `services/catalog/test/librivox.test.ts`: the catalog asks archive.org for `avg_rating` and
  `num_reviews`, rates only from 3 reviews up, reads ratings sent as text; the meta works the
  rating out from the item's reviews.
- `packages/core/src/badges.test.ts`: badge order, finished over progress, whole percents, the
  limit per cover, and what a profile has done with an item (streamed or a library folder book,
  per profile); `settings.test.ts`: the new setting defaults to on.
- `apps/app/scripts/check-accessibility.mjs` and the translation check (Malay lines added).

Seen in the preview but not from this change: Library rows and the Continue listening card on the
web draw an empty tile where an archive.org cover should be, with badges on or off.

## Open on a phone

- <a id="talkback"></a>TalkBack on Discover: one swipe per tile, read as title, author, where it
  plays from and “Rated 4.6 of 5”; the badge itself is never a separate stop. On the item page the
  cover is one stop, “Cover: Rated 4.6 of 5”, and only when it has badges. A Library row says
  “✓ Finished” or the percent once, from its text.
- <a id="large-text"></a>At the largest font size, badges stay inside their cover on Home, Discover,
  Search, the Library and the item page (they grow at most 1.5 times on large covers, 1.2 times on list rows); titles below are unchanged.
- <a id="state"></a>Play a LibriVox book from Discover for a minute, go back: its tile shows the
  percent; Mark as finished in the Library: the tile and its Home row show ✓.
- <a id="setting"></a>Settings → Catalogs → Badges on covers off: no badges anywhere; on again brings them back without a restart. A second profile keeps its
  own choice.
- <a id="malay"></a>A Malay profile: Settings reads “Lencana pada kulit buku”, a finished tile's
  cover says “✓” and TalkBack reads “Selesai didengar” and “Penarafan 4.6 daripada 5”.

## Minor review findings, left for later

- Every mounted tile and row subscribes to the library signal for its badges, so all re-render on
  a library change, even with badges off. Passing the badge source down from the list would
  avoid it; not measured as a problem in the preview.
- A tile can show ✓ or a percent for a library folder book matched by title and author, while
  the item page's cover, which only knows the streamed book, shows none.
- The LibriVox catalog rates from archive.org's `avg_rating`, the item page from the item's own
  reviews; the two can differ by a few tenths (4.6 and 4.4 for The Art of War).
- The Podcasts tab and the podcast page draw no badges; the app knows its own unplayed counts
  there, which could become a “new” badge.
