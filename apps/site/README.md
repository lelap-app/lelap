# @lelap/site

The landing page for lelap.app: Astro with static output, deployed to Cloudflare Pages.

## Develop

From the repository root:

```bash
pnpm dev:site
```

| Command                             | What it does                  |
| ----------------------------------- | ----------------------------- |
| `pnpm --filter @lelap/site dev`     | Dev server on localhost:4321  |
| `pnpm --filter @lelap/site build`   | Static build into `dist/`     |
| `pnpm --filter @lelap/site preview` | Serve the build locally       |
| `pnpm --filter @lelap/site check`   | Type-check `.astro` and `.ts` |
| `pnpm --filter @lelap/site icons`   | Regenerate icons and splashes |

`icons` renders `public/apple-touch-icon.png`, `public/icons/*` and the iOS splash screens in
`public/splash/` with sharp. The device sizes live in `src/splash-screens.ts`, which also drives the
`apple-touch-startup-image` tags, so add a new iPhone or iPad there and rerun the command.

## Configuration

Build-time environment variables, all optional:

| Variable                | Default                              | What                                                         |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `PUBLIC_LELAP_DOMAIN`   | `lelap.app`                          | Base domain; app, download and email hosts derive from it    |
| `PUBLIC_LELAP_REPO_URL` | `https://github.com/lelap-app/lelap` | Repository links                                             |
| `PUBLIC_LELAP_RELEASED` | unset                                | `true` swaps "Follow on GitHub" for download and app buttons |

## Deploy

`.github/workflows/site.yml` builds and deploys to the Cloudflare Pages project `lelap-site` on
every push to `main` that touches the site. One-time setup:

1. Create the Pages project: `pnpm dlx wrangler pages project create lelap-site --production-branch main`.
2. Add the custom domain `lelap.app` to the project in the Cloudflare dashboard.
3. Create a Cloudflare API token with **Account → Cloudflare Pages → Edit** only.
4. In GitHub, create the environment `web`, limited to the `main` branch, with:
   - secret `CLOUDFLARE_API_TOKEN`
   - variable `CLOUDFLARE_ACCOUNT_ID`
5. Set up Cloudflare Email Routing for `copyright@lelap.app` and `privacy@lelap.app`; both are on
   the site.

The terms and privacy pages are first drafts. Review them before launch.
