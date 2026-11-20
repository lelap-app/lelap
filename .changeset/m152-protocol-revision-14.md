---
'@lelap/sdk': minor
---

Protocol revision 14. A stream can say it is still preparing (`availability: 'preparing'`), and
its audio may answer `503` with `Retry-After` until it is ready; `404` or `410` ends the wait. A
`StreamPart` no longer needs `durationMs`: the app measures it. A stream response can carry
`refreshAfter`, seconds after which the app asks once more, past its cache. Streams gain `format`
(`STREAM_FORMATS`), `language` and `releaseId`, a lowercase URN (`RELEASE_ID`) that is the same
for the same files across add-ons. A meta's chapters apply to a stream of parts whose lengths add
up to the meta's. `lelap-sdk check` warns of `availability` or `refreshAfter` without revision 14,
a `refreshAfter` above 30 seconds, an unknown `format`, a `releaseId` that is not a lowercase URN
and parts without lengths, and takes audio that answers `503` with `Retry-After` for preparing.
