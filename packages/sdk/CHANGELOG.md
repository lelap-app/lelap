# @lelap/sdk

## 0.8.0

### Minor Changes

- 5c10972: Protocol revision 15. The app sends its own revision as a `Lelap-Protocol` header on every
  resource request to an add-on that declares revision 15 or higher (never on the manifest or on
  audio), and handlers get it as `appProtocol`: absent for an app at revision 14 or older, or when
  the value is not a whole number (`parseAppProtocol`). A manifest can name the lowest app revision
  it works with as `minProtocolVersion`; `createAddon({ minProtocolVersion })` puts it in the
  manifest and answers `426 Upgrade Required` with a short plain-text body by itself to an app that
  sends a lower revision or none. The CORS preflight now sends `Access-Control-Max-Age: 86400` and
  keeps `Access-Control-Allow-Headers: *` (`PREFLIGHT_HEADERS`). New helpers: `PROTOCOL_HEADER`,
  `sendsAppProtocol` and `needsNewerApp`. `lelap-sdk check` sends the header as the app does, and
  warns when `minProtocolVersion` is above `protocolVersion`, when it is set without revision 15,
  and when an add-on of revision 15 answers a preflight without allowing `Lelap-Protocol`.

## 0.7.0

### Minor Changes

- a10fa3d: Protocol revision 14. A stream can say it is still preparing (`availability: 'preparing'`), and
  its audio may answer `503` with `Retry-After` until it is ready; `404` or `410` ends the wait. A
  `StreamPart` no longer needs `durationMs`: the app measures it. A stream response can carry
  `refreshAfter`, seconds after which the app asks once more, past its cache. Streams gain `format`
  (`STREAM_FORMATS`), `language` and `releaseId`, a lowercase URN (`RELEASE_ID`) that is the same
  for the same files across add-ons, and `live`, for a live broadcast: no place, progress,
  downloads, seeking or speed, with what is on air from ICY or ID3 metadata. A meta's chapters apply to a stream of parts whose lengths add
  up to the meta's. `lelap-sdk check` warns of `availability` or `refreshAfter` without revision 14,
  a `refreshAfter` above 30 seconds, an unknown `format`, a `releaseId` that is not a lowercase URN
  and parts without lengths, and takes audio that answers `503` with `Retry-After` for preparing.

## 0.6.0

### Minor Changes

- `llms.txt` ships in the package: a one-page guide for coding assistants working in an add-on's
  project, pointing at the `.d.ts` files and the docs.
- f768770: Protocol revision 11, for add-ons inside the app. A `LibraryResponse` can carry `settings`: new
  values for the add-on's own fields, such as a server's new address. The app saves them before it
  reads the files; address fields that grant a host change only for add-ons that come with the app.
  The new `locate` resource is asked where a book's files are just before it streams
  (`LocateRequest`, `LocateResponse`, `locatePath`, `offersLocate`); a file left out streams
  without the library's login.

  Revision 11 also adds `choice` settings, a list to pick from instead of a name to type. A
  `SettingField` of type `choice` has its own `options` (`ChoiceOption`: `value`, `label`,
  `detail`), or the add-on lists the `settings` resource and answers `SettingsOptions` at
  `settingsPath()` with the form's values so far, such as a server's libraries after signing in.
  With `multiple` the value is the picked values, one per line: `choiceValues` splits it,
  `choiceOptions` merges both kinds of options, and `offersSettingOptions` says whether the app asks.
  `readSettings` checks fixed options. `lelap-sdk check` warns of a choice field without revision
  11, a `settings` resource that no field needs and a choice with one option.

- 0180dc2: Protocol revision 10. A `scrobble` resource can list the `events` it uses, such as
  `['finish', 'rate']`, and the app sends only those; `wantsScrobble` takes the event as a fourth
  argument. A `rate` without `rating` means the listener took their rating back. The app now sends
  `resumed` only to an add-on it told about the book before, and `sessionStartMs` on every `finish`
  that ends a session.

  The configure page grows into what a service with tokens and lists needs: `text` (an intro, a link,
  steps and a note), `url` and `choices` fields (a group of boxes, kept as a list), `placeholder`, a
  second page with `choose` whose fields depend on the first (its settings ride along sealed for an
  hour), `manifest` for catalogs that depend on the settings, and `legacy` to keep add-on addresses
  made before the add-on used this configure. `Config` values can now be lists of strings. The page
  after saving copies the address with a tap. `lelap-sdk check` warns of `events` off the scrobble
  resource, editions that share a key and a single edition the app never shows.

- d2ea0b4: Sealed settings are bound to the add-on that sealed them. `encodeConfig` and `decodeConfig` take
  the manifest ID as a third argument and seal it in as AES-GCM associated data, in a new `e2.`
  token, so of two add-ons sharing one `configure.secret`, neither accepts the other's settings. It
  authenticates the ID; it doesn't hide anything more from whoever holds the secret.
  `createAddon` passes the ID itself. Backward compatible: `e1.` tokens from earlier versions still
  open, so configured URLs keep working; new configure pages hand out `e2.` tokens.
- 4131c31: The add-on test kit. `lelap-sdk check <url>` (or `npx @lelap/sdk check <url>`) fetches an add-on's
  manifest and every resource it declares, validates each answer with the SDK's schemas and says
  what is wrong: the field, what was expected and the address that answered. It also checks CORS,
  response times, caching headers, catalog paging that ends, IDs that come back unchanged, stream
  addresses and configure pages that use `PAGE_STYLE`. `--json` prints the report for CI; the exit
  code is 0 when it passes, 1 for problems and 2 for wrong use. `checkAddon(url, { fetch })` and
  `formatReport`, from `@lelap/sdk/check`, do the same from code, so a test can check `addon.fetch`
  without a server.
- 4dd2eff: Protocol revision 11 also adds the `series` resource: every book of a series in reading order,
  asked by the series' name with `author`, `language` and `work` as extras
  (`GET /series/{type}/{name}/{extra}.json`). The answer is a `SeriesResponse`; a book has a
  `title`, `titles` by language, a `position` such as `1` or `0.5`, a `released` year or date and
  `externalIds`, and `{ "series": null }` means the add-on doesn't know the series. `createAddon`
  takes a `series` handler; `seriesPath`, `offersSeries`, `positionNumber` and `orderSeriesVolumes`
  (by position, a book without one after the last book released before it) come with it. An app
  before revision 11 refuses a manifest that lists `series`, so keep it in an add-on of its own or
  one that needs revision 11 anyway. `lelap-sdk check` asks a name no series has, and with
  `--series name/author` a series you know, and warns of books with neither a position nor a date.
- Protocol revision 13, for add-ons inside the app with a library. A `LibraryFile` can carry the
  book's `description`, `language` and `series` (from the book's first file, in place of the file's
  own), and a `ref`: the add-on's own note for the file, which the app stores and hands back in
  place reports. A `LibraryResponse` can carry `digest`, a user name and password that the app
  answers with HTTP Digest per request on the phone, for servers such as Calibre's content server
  without https. Each file of a `PlaceReport` now has its `durationMs` where the app knows it, and
  its `ref`. `X-Lelap-Digest` is a header the app keeps for itself.
- Every handler gets `waitUntil(promise)` for work after the answer; `fetch(request, env, ctx)` hands
  it to the Workers execution context, and elsewhere the promise simply runs. Configure fields take a
  `link` (`href`, `text`) shown beside them and a `group`, a heading the page sorts them under.
  `fingerprint(secret)` is a short stable hash for cache keys per account, and `log(event, fields)`
  prints one JSON line from strings, numbers and booleans only, with URLs cut to their path.
  `mockFetch(routes)` in `@lelap/sdk/check` answers the routes given and fails every other request,
  so an add-on's tests never reach a real service.
- 59d468c: The configure page can offer signing in with the service instead of typing a token:
  `text.signIn` (`href`, `label`, `note`, `other`) puts a button to a path on the add-on's own host
  first, with the page's `return` address added, and folds the form under `other`.

### Patch Changes

- 8a2f0ce: The page after saving a configure form names the app's new Settings path: Settings → Library and
  sources → Add-ons.

## 0.5.0

### Minor Changes

- 3b0aaab: Protocol revision 9. `Meta.editions` lists a work's editions (`Edition`: `key`, `name`, `year`,
  `narrators`, `publisher`, `language`, `cover`, `durationMs`, `externalIds`), which the item page
  lets the listener choose from; a list that does not fit is dropped, not the item. A `start` event
  can carry `resumed: true` when the listener carries on with a book begun before, so trackers can
  leave the book where it is. `LibraryResponse.next` lets a library come in pages: the app asks again
  with `args.library.cursor`. An add-on inside the app with `settings` and no `library` is set up under
  Settings → Add-ons and gets its settings on every call; `setUpWithSettings(manifest)` tells which.
  `AddonError` takes `{ retryAfter }` and sends it as `Retry-After`. The configure pages say who runs
  them (“This page is run by {host}, not by Lelap.”), no longer name Lelap as the sender, and use the
  new `PAGE_STYLE`. Backward compatible: older apps ignore the new fields, and older add-ons work as
  before. `LATEST_PROTOCOL_VERSION` is now 9.

### Patch Changes

- a72b886: The work matcher reads a leading “Book 2 - Title” or “Vol. 3: Title” as a series number, and a
  print book's ASIN, which is its ISBN-10, now meets the same book's `isbn:978…`.

## 0.4.0

### Minor Changes

- 1424f6b: Protocol revision 4 adds `badges` to `MetaPreview` and `Meta`: `rating` (0 to 5 stars) and
  `newEpisodes`, data the app draws on covers instead of text baked into pictures. New `Badges`
  schema and type. Backward compatible: older apps ignore `badges`, items without them work as
  before, unknown badge fields are dropped, and badges that do not fit are dropped without the item. `LATEST_PROTOCOL_VERSION` is now 4, so `createAddon`
  declares revision 4.
- f5791e8: Protocol revision 6 lets library sources inside the app keep places with their server and log in
  through the address. `LibraryResponse.query` (`QueryParams`) holds query parameters the app adds
  to every file and download address (and a folder's `cover.jpg`) on the add-on's own hosts, sealed
  like `headers` and never stored in a file's address, for servers that take a login only there, such as the Subsonic
  API. A `LibraryFile` may carry `downloadUrl`, where the app downloads it from, and `place`
  (`LibraryPlace`), the listener's place in it as the source keeps it; the newest place wins. A new
  `place` resource gets a `PlaceReport` (`placePath()`) when the listener's place moves, so the
  add-on can save it on the server. `place` is for add-ons inside the app only, and
  `offersPlaces(manifest)` tells whether an add-on keeps places. Backward compatible for everything
  already valid; an app before revision 6 refuses a manifest that lists `place`.
  `LATEST_PROTOCOL_VERSION` is now 6.
- 9e954bd: Protocol revision 7 lets library sources inside the app sign the listener in through a website and
  play in the browser with a login that is otherwise a header. A setting of the new type `signin`
  shows as a Sign in button; the new `signin` resource answers `signinPath('start')` with a
  `SigninStart` (a `code`, an https `url` to enter it at, `expiresAt`, `interval` and `state`) and
  `signinPath('check')` with a `SigninResult`, whose `settings` fill in the form once the listener is
  done. `applySignin()` merges them the way the app does (address fields that grant a host only
  with `hosts: true`, which the app gives the add-ons that come with it), and `offersSignin(manifest)` tells whether
  an add-on signs in. `LibraryResponse.webQuery` holds query parameters the app adds instead of
  `headers` where it can't send headers, such as a browser's audio element, sealed like `query`.
  `signin` is for add-ons inside the app only, with one `signin` field at most. Backward compatible
  for everything already valid; an app before revision 7 refuses a manifest that lists `signin`.
  `LATEST_PROTOCOL_VERSION` is now 7.
- 45c1fe5: Protocol revision 5 lets add-ons inside the app work as library sources. `Manifest.settings`
  describes the form the app shows when the listener adds the add-on as a server (`SettingField`:
  `text`, `url` or `password`; a `url` field marked `host` lets the add-on reach that address);
  `readSettings` checks what was typed and `settingHosts` gives the hosts it grants. A new `library`
  resource (`GET /library/audiobook/all.json`, `LibraryResponse` of `LibraryFile`s, `libraryPath()`)
  lists the listener's files with tags, sizes, covers and IDs, so the app scans them into the
  library. Streams and library listings may carry `headers` (`RequestHeaders`), such as a login,
  which the app sends only to the add-on's own hosts. Settings, `library` and headers are for add-ons
  inside the app only: a manifest without `sandbox` that declares them is invalid, `WebStream` and
  `WebStreamResponse` refuse headers, and `createAddon` never serves a stream with headers.
  `offersLibrary(manifest)` tells whether an add-on lists a library. Backward compatible for
  everything already valid; an app before revision 5 refuses a manifest that lists `library`.
  `LATEST_PROTOCOL_VERSION` is now 5.
- 6268832: Protocol revision 8 lets an add-on inside the app with `scrobble` and `settings` but no `library`
  be set up under Settings → Add-ons: the app shows the form its `settings` describe, keeps the
  values sealed on the device, and hands them to its `scrobble` handler as `args.settings` next to
  `args.events`. `scrobblePath()` names that call, which only the sandbox makes; over HTTP an add-on
  still takes `POST /scrobble`. `scrobblesWithSettings(manifest)` tells whether an add-on is such a
  scrobbler. Backward compatible. `LATEST_PROTOCOL_VERSION` is now 8.
- 13d5080: The matcher Lelap uses to find a book page's work in the listener's own library, for source
  add-ons to map their files to works. `createWorkIndex(entries)` indexes your items by ID, title
  and author; `find(work)` returns those that share an ISBN, ASIN or other ID, else those with the
  same title and author after normalising (case, accents, punctuation, a leading article,
  “(Unabridged)”, series numbers, “Last, First”). `matchStrength`, `titleKey`, `authorKey`,
  `sameAuthor`, `sameAuthors`, `splitAuthors`, `fold`, `normalizeId`, `normalizeIds`,
  `normalizeIsbn` and `idsFromTags` are the pieces. `lookupWork(id)` turns a work ID into what the
  index needs: `isbn:` and `asin:` as they are, an `ol:` work's title, authors and edition IDs from
  Open Library. No change to the protocol.

## 0.3.0

### Minor Changes

- dc678c3: Protocol revision 2, backward compatible with v1 add-ons and apps:

  - `protocolVersion` in the manifest (absent means 1) and `LATEST_PROTOCOL_VERSION`.
  - `behaviorHints`: `configurable`, `configurationRequired` and `health`, with helpers
    `isConfigurable`, `needsConfiguration`, `offersHealth` and `protocolVersionOf`.
  - `GET /health` and the `HealthResponse` schema; `createAddon` answers it (or calls your `health`
    handler) and declares it.
  - `createAddon({ configure })` serves a settings form at `/configure`, encodes the settings into a
    `/{token}/` prefix of the add-on's URL (AES-GCM with `configure.secret`), sends the listener back
    to `lelap://addon?manifest=…` and passes `config` to every handler. `encodeConfig`,
    `decodeConfig` and `allowedReturn` are exported for add-ons that route themselves.

- 5bb1025: Protocol revision 3 adds the `artwork` resource: `GET /artwork/{type}/{id}.json` answers
  `{ artwork: ArtworkImage[] }` (`url`, `kind`, `width`, `height`). New `ArtworkImage`,
  `ArtworkResponse` and `artworkPath`; `parseRoute` knows the route and `createAddon({ artwork })`
  serves it. `LATEST_PROTOCOL_VERSION` is now 3.
- e3080d3: Manifest `sandbox.hosts` (revision 3) for add-ons that run inside the app: the only hosts the app
  fetches from for the add-on.

## 0.2.1

### Patch Changes

- README: link the SDK guide, protocol reference and samples on the docs site instead of their source
  files.

## 0.2.0

### Minor Changes

- 6ec055b: First release on npm: ESM with type declarations, built from the TypeScript source, and the
  protocol's JSON Schema at `@lelap/sdk/protocol.schema.json`.
