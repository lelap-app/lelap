# Lelap source add-on in plain Node

A [Lelap](https://github.com/lelap-app/lelap) add-on with only a `stream` resource: audio for works
that other add-ons' pages show. It declares `idPrefixes: ['ol:', 'isbn:', 'asin:']`, so Lelap asks
it for streams by a work's Open Library ID, ISBN or ASIN, and the matcher in `@lelap/sdk` finds
which of its files that work is. The two books are public-domain LibriVox recordings on
archive.org.

| File             | What                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `addon.mjs`      | The manifest, the file list with its tags, the index and the handler     |
| `server.mjs`     | Serves `addon.fetch` with `node:http` on `PORT` (default 8787)           |
| `addon.test.mjs` | Tests with Vitest; Open Library is answered by the test, not the network |

## Run it

In this repository the SDK is its TypeScript source, which Vitest loads and Node does not:

```sh
pnpm test
```

Copy the folder out of the repository to run it with Node 20 or later:

```sh
npm pkg delete dependencies.@lelap/sdk devDependencies.vitest
npm install @lelap/sdk
node server.mjs      # http://localhost:8787/manifest.json
```

## How it finds the files

- `createWorkIndex` is built once from the file list: IDs from the tags (`idsFromTags` reads
  `ISBN`, `ASIN`, `AUDIBLE_ASIN` and iTunes' `----:com.apple.iTunes:ASIN`), titles and authors
  from the rest.
- For each request, `lookupWork` says what the ID stands for: `isbn:` and `asin:` as they are, an
  `ol:` work's title, authors and edition IDs from Open Library.
- `index.find(work)` returns the files sharing an ID, else those with the same title and author
  after normalising.

The rules are in the docs: [Mapping your files to works](https://lelap.app/docs/mapping-files/).
Replace `FILES` with a scan of your own storage, and only serve audio you are allowed to share.
