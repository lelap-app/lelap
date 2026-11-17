# Seasonal catalogs

A [Lelap](https://github.com/lelap-app/lelap) add-on with two hard-coded catalogs, **Christmas** and
**Autumn**, of public-domain LibriVox recordings. The lists live in
[`src/catalogs.json`](src/catalogs.json); the code is a manifest and one `catalog` handler with
`@lelap/sdk`.

It only answers `catalog`. Every item has a `librivox:` ID (the archive.org identifier of the
recording), so the LibriVox add-on, which Lelap ships with, answers its meta and streams. Listeners
get the two rows on Home and play the books from archive.org, and this add-on never sees a play.

## Change the lists

Edit `src/catalogs.json`. Each catalog has an `id` (part of the URL, unique), a `name` (the row's
heading) and `metas`: the protocol's `MetaPreview` objects. The add-on checks the file against the
protocol when it starts, so a missing field or a broken URL fails the tests, not the app.

To find a recording's ID, open it on archive.org: in
`https://archive.org/details/christmascarol_librivox`, the ID is `librivox:christmascarol_librivox`.
Use the `librivoxaudio` collection's items, since that is what the LibriVox add-on serves. You can
mix in `ol:` IDs (Open Library works) too: the LibriVox add-on looks up recordings for those.

A catalog of books from your own source needs `meta` and `stream` handlers as well; see the
template in `services/template`.

## Run it

```sh
npx wrangler dev       # http://localhost:8787/manifest.json
npx wrangler deploy
npm test
```

Outside this repository, install the SDK from npm in place of the workspace link:

```sh
npm pkg delete dependencies.@lelap/sdk
npm install @lelap/sdk
```

`src/index.ts` is a Cloudflare Worker; `addon.fetch` also runs on Deno
(`Deno.serve(addon.fetch)`), Bun, or Node through an adapter.

MIT licensed, like the SDK.
