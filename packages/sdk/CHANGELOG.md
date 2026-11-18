# @lelap/sdk

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
