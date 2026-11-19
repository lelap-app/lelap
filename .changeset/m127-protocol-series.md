---
'@lelap/sdk': minor
---

Protocol revision 11 also adds the `series` resource: every book of a series in reading order,
asked by the series' name with `author`, `language` and `work` as extras
(`GET /series/{type}/{name}/{extra}.json`). The answer is a `SeriesResponse`; a book has a
`title`, `titles` by language, a `position` such as `1` or `0.5`, a `released` year or date and
`externalIds`, and `{ "series": null }` means the add-on doesn't know the series. `createAddon`
takes a `series` handler; `seriesPath`, `offersSeries`, `positionNumber` and `orderSeriesVolumes`
(by position, a book without one after the last book released before it) come with it. An app
before revision 11 refuses a manifest that lists `series`, so keep it in an add-on of its own or
one that needs revision 11 anyway. `lelap-sdk check` asks a name no series has, and with
`--series name/author` a series you know, and warns of books with neither a position nor a date.
