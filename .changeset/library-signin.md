---
'@lelap/sdk': minor
---

Protocol revision 7 lets library sources inside the app sign the listener in through a website and
play in the browser with a login that is otherwise a header. A setting of the new type `signin`
shows as a Sign in button; the new `signin` resource answers `signinPath('start')` with a
`SigninStart` (a `code`, an https `url` to enter it at, `expiresAt`, `interval` and `state`) and
`signinPath('check')` with a `SigninResult`, whose `settings` fill in the form once the listener is
done. `applySignin()` merges them the way the app does, and `offersSignin(manifest)` tells whether
an add-on signs in. `LibraryResponse.webQuery` holds query parameters the app adds instead of
`headers` where it can't send headers, such as a browser's audio element, sealed like `query`.
`signin` is for add-ons inside the app only, with one `signin` field at most. Backward compatible
for everything already valid; an app before revision 7 refuses a manifest that lists `signin`.
`LATEST_PROTOCOL_VERSION` is now 7.
