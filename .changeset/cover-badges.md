---
'@lelap/sdk': minor
---

Protocol revision 4 adds `badges` to `MetaPreview` and `Meta`: `rating` (0 to 5 stars) and
`newEpisodes`, data the app draws on covers instead of text baked into pictures. New `Badges`
schema and type. Backward compatible: older apps ignore `badges`, items without them work as
before, and unknown badge fields are dropped. `LATEST_PROTOCOL_VERSION` is now 4, so `createAddon`
declares revision 4.
