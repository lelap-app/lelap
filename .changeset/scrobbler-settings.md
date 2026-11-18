---
'@lelap/sdk': minor
---

Protocol revision 8 lets an add-on inside the app with `scrobble` and `settings` but no `library`
be set up under Settings → Add-ons: the app shows the form its `settings` describe, keeps the
values sealed on the device, and hands them to its `scrobble` handler as `args.settings` next to
`args.events`. `scrobblePath()` names that call, which only the sandbox makes; over HTTP an add-on
still takes `POST /scrobble`. `scrobblesWithSettings(manifest)` tells whether an add-on is such a
scrobbler. Backward compatible. `LATEST_PROTOCOL_VERSION` is now 8.
