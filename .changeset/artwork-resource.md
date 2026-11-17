---
'@lelap/sdk': minor
---

Protocol revision 3 adds the `artwork` resource: `GET /artwork/{type}/{id}.json` answers
`{ artwork: ArtworkImage[] }` (`url`, `kind`, `width`, `height`). New `ArtworkImage`,
`ArtworkResponse` and `artworkPath`; `parseRoute` knows the route and `createAddon({ artwork })`
serves it. `LATEST_PROTOCOL_VERSION` is now 3.
