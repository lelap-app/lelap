# Lelap add-on in plain Node

A complete [Lelap](https://github.com/lelap-app/lelap) add-on on Node's standard library, with no
framework and no dependencies: one catalog, meta and streams for two public-domain LibriVox
recordings hosted on archive.org. Read it to see what the protocol asks of a server, or copy it
when you'd rather not use the TypeScript SDK.

| File             | What                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `addon.mjs`      | The manifest, the data, routing (`route`) and the `node:http` server |
| `server.mjs`     | Starts the server on `PORT` (default 8787)                           |
| `addon.test.mjs` | Tests with `node:test`, against a real server on a random port       |

## Run it

Node 20 or later.

```sh
npm start     # http://localhost:8787/manifest.json
npm test
```

To try it in Lelap, open **Settings → Add-ons**, paste the manifest URL and add it. A phone needs a
URL it can reach, and the web app needs HTTPS: put the server behind a reverse proxy with a
certificate, or deploy it. The docs' hosting page covers both.

## What the code has to get right

- **Paths.** `/manifest.json`, `/catalog/{type}/{id}.json`, `/catalog/{type}/{id}/{extra}.json`,
  `/meta/{type}/{id}.json` and `/stream/{type}/{id}.json`. IDs arrive percent-encoded
  (`example%3Araven`); split the path on `/` first, then decode.
- **Extras** are a query string in one path segment, such as `genre=poetry&skip=50`.
  `URLSearchParams` decodes them, `+` as a space included.
- **CORS** on every response, errors included, and `204` for `OPTIONS` preflights. The web app
  calls add-ons straight from the browser.
- **Errors** are JSON: `{ "error": "…" }` with `404` for unknown routes, catalogs and IDs, `400` for
  extras you can't use. Unknown IDs on `/stream` answer an empty list.
- **Caching:** `cacheMaxAge` in the body and the same value in `Cache-Control`.

## Make it yours

Change the manifest's `id` (reverse DNS of a domain you control), `name` and `idPrefixes`, and
replace `BOOKS` with calls to your source. Only serve audio you are allowed to share; the audio URLs
point at the source, and the app plays them from there.

MIT licensed, like the SDK.
