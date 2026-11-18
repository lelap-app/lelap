# The add-on from “Your first add-on”

The code of the developer guide at [lelap.app/docs/guide/](https://lelap.app/docs/guide/), which
reads these files at build time. Each step is a file that builds on the one before.

| File           | What                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| `books.mjs`    | Two public-domain LibriVox recordings on archive.org                                |
| `catalog.mjs`  | Step 1: manifest, catalog, meta and streams                                         |
| `settings.mjs` | Step 2: a configure form whose choices reach the catalog                            |
| `source.mjs`   | Step 3: streams for other add-ons’ book pages from your own folder                  |
| `page.mjs`     | A page of your own in the SDK’s shared style, with the sender line                  |
| `server.mjs`   | Serves a step with `node:http`: `node server.mjs catalog` (or `settings`, `source`) |
| `worker.mjs`   | Cloudflare Workers entry for steps 1 and 2                                          |
| `Dockerfile`   | Step 3 in a container, built in your own copy                                       |
| `test/`        | Runs every step with Vitest; Open Library is answered by the test                   |

## Run it

In this repository the SDK is its TypeScript source, which Vitest loads and Node does not:

```sh
pnpm test
```

Outside it, follow the guide: `npm install @lelap/sdk` in a new folder, then copy the files in.
The Dockerfile only builds there, where `npm install` wrote `package-lock.json`; this folder links
the SDK from the repository instead.
