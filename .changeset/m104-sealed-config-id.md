---
'@lelap/sdk': minor
---

Sealed settings are bound to the add-on that sealed them. `encodeConfig` and `decodeConfig` take
the manifest ID as a third argument and seal it in as AES-GCM associated data, in a new `e2.`
token, so two add-ons sharing one `configure.secret` can no longer read each other's settings.
`createAddon` passes the ID itself. Backward compatible: `e1.` tokens from earlier versions still
open, so configured URLs keep working; new configure pages hand out `e2.` tokens.
