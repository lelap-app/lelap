# Lelap add-on template

The smallest [Lelap](https://github.com/lelap-app/lelap) add-on: one catalog, meta and streams for
two public-domain LibriVox recordings, hosted on archive.org. It runs on Cloudflare Workers with
[Hono](https://hono.dev) and `@lelap/sdk`, which routes requests, adds CORS and checks your answers
against the protocol.

## Make it yours

1. Copy this folder out of the monorepo and install the SDK from npm in place of the workspace
   link:

   ```sh
   npm pkg delete dependencies.@lelap/sdk
   npm install @lelap/sdk
   ```

   pnpm and yarn work too (`pnpm add @lelap/sdk`, `yarn add @lelap/sdk`).

2. In `src/addon.ts`, give the manifest your own `id` (reverse DNS of a domain you control), `name`
   and `idPrefixes`.
3. Replace `src/books.ts` with calls to your source. Only serve audio you are allowed to share.
4. Rename the worker in `wrangler.toml`.

## Run it

```sh
npx wrangler dev
```

Open <http://localhost:8787/manifest.json> to check the manifest (the base URL redirects there). To try it in Lelap, open
**Settings → Add-ons**, paste the manifest URL and add it. A phone needs a URL it can reach: use
your computer's LAN address with `wrangler dev --ip 0.0.0.0`, or deploy first.

## Deploy

```sh
npx wrangler login
npx wrangler deploy
```

Wrangler prints the `workers.dev` URL; add `/manifest.json` to it and paste that into Lelap. You
can attach a custom domain to the worker in the Cloudflare dashboard.

## Test

```sh
npm test        # Vitest, through the Hono app
npm run check   # TypeScript
```

## Not on Workers, or not in TypeScript

`addon.fetch` is a standard `fetch(request)` handler, so the same code runs on Deno, Bun, or Node
through `@hono/node-server`. For other hosts and languages, see the samples in
[`examples/`](../../examples): plain Node with no dependencies, Python with the standard library,
and an add-on with hard-coded seasonal catalogs.

The developer docs on the Lelap site (`/docs/`) have the protocol reference, data model samples, a
manifest builder and a hosting guide.
