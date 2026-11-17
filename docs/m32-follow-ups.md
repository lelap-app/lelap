# M32 follow-ups

What is left of M32 Audnexus ([`next.md`](next.md)) after its first pull request. M32 stays
“In progress” until the device checks pass.

## What landed

- The Catalog add-on looks for an Audible ASIN among a work's Open Library audio editions and, when
  it finds one, adds narrators, series, length and chapters from Audnexus to the meta
  (`externalIds.asin`). It also answers `asin:` IDs with a whole meta from Audnexus.
- Audnexus answers and misses are cached for a week; after a 429 the add-on stops asking until
  `Retry-After` has passed. When Audnexus fails the meta still goes out, with a short `cacheMaxAge`.
- `series` on `Meta` in the SDK (optional, backward compatible), documented on the protocol and data
  model pages.
- The app shows the main series next to the narrators on the item page, and uses the meta's chapters
  for a stream without its own only when the stream's length is within 15 seconds of the meta's
  `durationMs`.

## 1. Device checks

Not run (no phone testing for now).

| #   | Check                                                                                      | Status  |
| --- | ------------------------------------------------------------------------------------------ | ------- |
| 1   | Item page for an `asin:` book shows “Series, book N · Read by …”                           | Not run |
| 2   | A single-file stream of the same recording gets the Audnexus chapters in the chapter sheet | Not run |
| 3   | A stream of another recording (length differs) keeps its own or no chapters                | Not run |
| 4   | A downloaded book with Audnexus chapters keeps them offline                                | Not run |

## 2. Open points

- **Few ASINs on Open Library.** Only some audio editions on Open Library carry an Audible ASIN, and
  some of those are not in Audnexus's `us` region. A source that knows ASINs (such as the
  Audiobookshelf add-on in M10) should put `asin` in `externalIds` or use `asin:` IDs.
- **One meta per item.** The app takes the meta of the first add-on that answers, so another add-on's
  meta with `externalIds.asin` is not enriched by the Catalog. Merging metas across add-ons is a
  separate decision.
- **Region.** Audnexus is asked for the `us` region only.
