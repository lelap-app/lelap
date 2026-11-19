# Lelap add-on in Python

A complete [Lelap](https://github.com/lelap-app/lelap) add-on on Python's standard library
(`http.server`), with no packages to install: one catalog, meta and streams for two public-domain
LibriVox recordings hosted on archive.org.

| File            | What                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `addon.py`      | The manifest, the data, routing (`route`) and the HTTP server        |
| `test_addon.py` | `unittest` tests, against a real server on a random port             |
| `package.json`  | Only so the monorepo's `pnpm test` runs the tests; not needed to run |

## Run it

Python 3.9 or later.

```sh
python3 addon.py            # http://localhost:8787/manifest.json, PORT to change it
python3 -m unittest         # the tests
```

To try it in Lelap, open **Settings → Library and sources → Add-ons**, paste the manifest URL and add it. A phone needs a
URL it can reach, and the web app needs HTTPS: put the server behind a reverse proxy with a
certificate, or deploy it. The docs' hosting page covers both.

`http.server` is fine for an add-on with a handful of listeners. For more, keep `route()` and serve
it from the WSGI or ASGI framework you already use; the protocol only needs `GET` routes that
answer JSON.

## What the code has to get right

- **Paths.** `/manifest.json`, `/catalog/{type}/{id}.json`, `/catalog/{type}/{id}/{extra}.json`,
  `/meta/{type}/{id}.json` and `/stream/{type}/{id}.json`. IDs arrive percent-encoded
  (`example%3Araven`); split the path on `/` first, then `unquote` each part.
- **Extras** are a query string in one path segment, such as `genre=poetry&skip=50`. `parse_qs`
  decodes them, `+` as a space included.
- **CORS** on every response, errors included, and `204` for `OPTIONS` preflights. The web app
  calls add-ons straight from the browser.
- **Errors** are JSON: `{"error": "…"}` with `404` for unknown routes, catalogs and IDs, `400` for
  extras you can't use. Unknown IDs on `/stream` answer an empty list.
- **Caching:** `cacheMaxAge` in the body and the same value in `Cache-Control`.

## Make it yours

Change the manifest's `id` (reverse DNS of a domain you control), `name` and `idPrefixes`, and
replace `BOOKS` with calls to your source. Only serve audio you are allowed to share; the audio URLs
point at the source, and the app plays them from there.

MIT licensed, like the SDK.
