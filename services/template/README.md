# Lelap add-on template

The smallest [Lelap](https://github.com/lelap-app/lelap) add-on: one catalog, meta and streams for
two public-domain LibriVox recordings, hosted on archive.org. It runs on Cloudflare Workers with
[Hono](https://hono.dev) and `@lelap/sdk`, which routes requests, adds CORS and checks your answers
against the protocol.

## Make it yours

1. Copy this folder out of the monorepo. Replace `"@lelap/sdk": "workspace:*"` in `package.json`
   with the version published on npm, then run `npm install` (or pnpm, or yarn).
2. In `src/addon.ts`, give the manifest your own `id` (reverse DNS of a domain you control), `name`
   and `idPrefixes`.
3. Replace `src/books.ts` with calls to your source. Only serve audio you are allowed to share.
4. Rename the worker in `wrangler.toml`.

## Run it

```sh
npx wrangler dev
```

Open <http://localhost:8787/manifest.json> to check the manifest. To try it in Lelap, open
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

The protocol reference is in the Lelap docs.
