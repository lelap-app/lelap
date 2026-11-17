# M20 follow-ups

What is left of [M20 SDK on npm](roadmap.md#m20-sdk-on-npm). The code, the Changesets setup and the
`SDK` workflow (`.github/workflows/sdk.yml`) are in place; publishing needs accounts and settings
that only the maintainer can create.

## 1. npm

- **Account:** an npm account for the project, with two-factor authentication required for both
  login and publishing.
- **Scope:** create the `lelap` organization on npm (free for public packages), so `@lelap/sdk` can
  be published. Add the maintainers as members.
- **First publish needs a token.** npm only lets you set up trusted publishing on a package that
  exists. Two ways to get the first version out:
  1. A granular access token with read and write access to the `@lelap` scope, a short expiry
     (7 days) and the option to bypass 2FA, saved as the `NPM_TOKEN` secret of the `npm`
     environment (step 2). Merge the version pull request, approve the job, then delete the token
     on npm and the secret on GitHub.
  2. Or publish 0.x once by hand: in `packages/sdk`, `pnpm build && pnpm pack`, then
     `npm publish lelap-sdk-<version>.tgz --access public`. This version has no provenance
     statement; every later one from CI does.
- **Trusted publishing** (afterwards): on npmjs.com, package `@lelap/sdk` → Settings → Trusted
  publisher → GitHub Actions, with organization `lelap-app`, repository `lelap`, workflow `sdk.yml`
  and environment `npm`. Then set “Publishing access” to require 2FA and disallow tokens, and
  remove any `NPM_TOKEN` secret. The workflow needs no change: with no token, npm authenticates
  through the job's OIDC token (`id-token: write`).

## 2. GitHub

- **Environment `npm`** (Settings → Environments → New environment). Why a new one and not
  `release`: `release` is limited to `v*` tags and holds the APK signing keys and Cloudflare
  tokens; the SDK publishes from `main` on its own schedule, and npm's trusted publisher is tied
  to one environment name. Settings:
  - Deployment branches and tags: selected branches, `main` only.
  - Required reviewers: the maintainers, with “Prevent self-review” off if you release alone.
  - Secret `NPM_TOKEN` only for the first publish (see above).
- No repository-wide secret is needed, and pull requests (forks included) can't reach the
  environment.

## 3. First release

1. Merge the M20 pull request. Its changeset (`.changeset/sdk-on-npm.md`) is a minor bump, so the
   first published version is **0.2.0**. Merging M20 also starts the `SDK` workflow, which finds
   `0.1.0` missing on npm and waits for approval: reject that run (or approve it if you'd rather
   ship 0.1.0 first).
2. Run `pnpm changeset version && pnpm install` on a branch, open a pull request, merge it, and
   approve the `SDK` run.
3. Check: `npm view @lelap/sdk` shows the version, and the package page on npmjs.com shows
   “Built and signed on GitHub Actions” with a link to the workflow run.
4. Copy `services/template` out of the repository, run
   `npm pkg delete dependencies.@lelap/sdk && npm install @lelap/sdk`, then `npm test` and
   `npx tsc --noEmit`. Both should pass against the published package.

## 4. Not done here

- The site's SDK guide shows `npm install @lelap/sdk`; it works once the first version is out.
- `pnpm changeset version` runs by hand. A bot that opens the “Version packages” pull request
  (`changesets/action`) would need `contents: write` and `pull-requests: write` and the
  repository setting that lets Actions open pull requests; worth it only if releases get frequent.
