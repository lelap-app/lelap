# @lelap/sdk

Types, zod schemas and a request handler for [Lelap](https://github.com/lelap-app/lelap) add-ons.
An add-on is a stateless HTTP service that answers with JSON: catalogs, metadata and audio sources
for the Lelap player. The SDK speaks protocol v1, revision 9, so your code is a manifest and a
handler for each resource.

```sh
npm install @lelap/sdk
```

It is ESM only and needs a runtime with the Fetch API (`Request` and `Response`): Cloudflare
Workers, Deno, Bun, or Node 20 and later.

## Example

```ts
import { createAddon, type Manifest } from '@lelap/sdk';

const manifest: Manifest = {
  id: 'com.example.readings',
  version: '1.0.0',
  protocol: 1,
  name: 'Example Readings',
  description: 'Public-domain books read by volunteers.',
  types: ['audiobook'],
  resources: ['catalog'],
  catalogs: [{ type: 'audiobook', id: 'new', name: 'New releases' }],
};

export const addon = createAddon({
  manifest,
  catalog: () => ({ metas: [], cacheMaxAge: 3600 }),
});

// Cloudflare Workers and Bun: export default { fetch: addon.fetch };
// Deno: Deno.serve(addon.fetch);
```

`createAddon` routes `/manifest.json`, `/catalog/…`, `/meta/…` and `/stream/…`, adds CORS and
caching headers, answers `OPTIONS`, and checks every answer against the protocol's schemas. Throw
`AddonError(status, message)` for a JSON error, with `{ retryAfter }` in seconds to send
`Retry-After`; return `null` from `meta` for a 404.

## What's inside

- **Schemas and types** for every protocol object: `Manifest`, `MetaPreview`, `Meta`, `Stream`,
  `CatalogResponse`, `MetaResponse`, `StreamResponse` and their parts, such as `Badges`: a rating
  and new episodes that the app draws on an item's cover. Each is a zod schema and a
  TypeScript type of the same name.
- **`createAddon(handlers, options)`** turns handlers into `fetch(request)`. `options.basePath`
  mounts several add-ons under one host.
- **Settings and sign-in:** `createAddon({ configure: { fields, secret, check } })` serves a form at
  `/configure` and puts the listener's settings, encrypted and bound to the manifest's `id`
  (`e2.` tokens; `e1.` ones from before still open), into the add-on's URL; handlers get them
  as `config`. Nothing is stored on a server. The pages say who runs them (“This page is run by
  {host}, not by Lelap.”) and use `PAGE_STYLE`, the stylesheet Lelap's own configure pages share.
- **Health:** every add-on answers `GET /health`; pass a `health` handler to report `degraded` or
  `down`.
- **Matching files to works:** `createWorkIndex(entries)` indexes your files by ID, title and
  author, and `find(work)` returns those that are a work: a shared ISBN or ASIN first, else the
  same title and author after normalising. `idsFromTags` reads ISBNs and ASINs from tags;
  `lookupWork(id)` turns an `ol:`, `isbn:` or `asin:` ID into what the index needs. The same code
  Lelap uses for the listener's own library; see
  [Mapping your files to works](https://lelap.app/docs/mapping-files/).
- **Library sources inside the app** (revision 5): `SettingField`, `readSettings` and
  `settingHosts` for the form a listener fills in, `LibraryResponse` and `LibraryFile` for the
  listing, `RequestHeaders` for a login sent with the audio, `offersLibrary`. Web add-ons never send
  headers: `WebStream` refuses them, and `createAddon` never serves them. Revision 6 adds
  `QueryParams` for a login the app adds to the address, a file's `downloadUrl` and `place`, and
  `PlaceReport` with `offersPlaces` for add-ons that save the listener's place on their server.
- **Revision 9:** `Edition` for a meta's `editions`, which the item page lets the listener choose
  from; `resumed` on a `start` that carries on with a book; `next` on a `LibraryResponse` for a
  library in pages; and `setUpWithSettings`, for an add-on inside the app whose settings reach every
  call.
- **Paths:** `catalogPath`, `metaPath`, `streamPath`, `libraryPath`, `placePath`, `parseRoute`, `encodeExtra`,
  `parseExtra`.
- **Helpers:** `supports`, `prefixesFor`, `hasParts`, `isConfigurable`, `needsConfiguration`,
  `offersHealth`, `encodeConfig`, `decodeConfig`, `CORS_HEADERS`, `PROTOCOL_VERSION`,
  `LATEST_PROTOCOL_VERSION`.
- **JSON Schema** of every response, for other languages: `@lelap/sdk/protocol.schema.json`.

[Your first add-on](https://lelap.app/docs/guide/) builds one step by step: a catalog, settings, a
source for your own files and a deploy. The [SDK guide](https://lelap.app/docs/sdk/), the
[protocol reference](https://lelap.app/docs/protocol/)
and [samples](https://lelap.app/docs/samples/) in plain Node and Python are in the developer docs. The
smallest complete add-on is [`services/template`](https://github.com/lelap-app/lelap/tree/main/services/template).

## License

MIT, so you can use it in an add-on under any license. The Lelap app itself is AGPL-3.0.

## Developing in the monorepo

Workspace packages (`services/*`, `packages/core`, `apps/*`, `examples/*`) import the TypeScript
source through `"exports": "./src/index.ts"`, so they need no build. The published package points
at `dist/` instead: `publishConfig` overrides `exports` and `types`, and `pnpm pack` applies it.

| Task                   | Command                            |
| ---------------------- | ---------------------------------- |
| Build ESM, types, JSON | `pnpm --filter @lelap/sdk build`   |
| Type-check             | `pnpm --filter @lelap/sdk check`   |
| Test                   | `pnpm --filter @lelap/sdk test`    |
| Files that would ship  | `npm pack --dry-run` (in this dir) |
| The tarball npm gets   | `pnpm pack` (in this dir)          |

Relative imports in `src/` have no extension, which the workspace's bundlers expect;
`scripts/esm-paths.mjs` adds `.js` in `dist/` for Node's ESM loader.

## Releasing

Versions and the changelog come from [Changesets](https://github.com/changesets/changesets). Only
this package is published; the rest of the workspace is private and Changesets skips it.

1. In the pull request with the change, add a changeset and commit the file it writes:

   ```sh
   pnpm changeset
   ```

   Pick `@lelap/sdk`, the bump (patch for fixes, minor for additions, major for breaking changes
   to the API or the protocol) and a sentence for the changelog.

2. When you want to release, on a branch from `main`:

   ```sh
   pnpm changeset version
   pnpm install
   ```

   This bumps `version` in `package.json`, writes `CHANGELOG.md` and deletes the used changesets.
   Open a pull request with the result.

3. Merging it to `main` starts the `SDK` workflow (`.github/workflows/sdk.yml`). It builds and
   tests the package, sees that npm doesn't have the version yet, packs the tarball with
   `pnpm pack` and runs
   `npm publish --provenance`, so npm shows where and how the package was built. Versions with a
   prerelease part (`0.3.0-beta.1`) go to the `next` tag.

Don't run `npm publish` in this folder: it would publish `exports` pointing at `src/`. The
`prepublishOnly` script stops it.
