# M20 follow-ups

How [M20 SDK on npm](milestones/m20.md) was set up, and the one step left. Releasing a new
version is in [`packages/sdk/README.md`](../packages/sdk/README.md#releasing).

## Set up (2026-11-17)

- **npm:** a personal maintainer account with 2FA, and the `lelap` organization, which owns the
  `@lelap` scope. Usernames and organizations share one namespace on npm, so the account has its
  own name.
- **GitHub:** environment `npm`, limited to `main`, with required reviewers. It is separate from
  `release`, which only `v*` tags can use and which holds the signing keys; npm's trusted
  publisher names one environment.
- **First publish (0.2.0):** a granular token with 2FA bypass and a 7-day expiry, stored as the
  `NPM_TOKEN` secret of `npm`, then deleted. npm can only trust a publisher for a package that
  exists.
- **Trusted publisher:** `lelap-app/lelap`, workflow `sdk.yml`, environment `npm`. The workflow
  needs no token; npm authenticates through the job's OIDC token (`id-token: write`).

## Left to do

- **Validate trusted publishing before 2026-11-19 10:08 UTC.** npm marks the publisher “Pending
  validation” until one publish uses it. 0.2.1 (a README fix) is that publish: merge its pull
  request and approve the `SDK` run. Afterwards, in the package settings on npmjs.com, set
  “Publishing access” to “Require two-factor authentication and disallow tokens”, and delete the
  first-publish token under Access Tokens if it is still listed.

## Worth knowing

- **Environments must exist before the first run.** A job that names an environment GitHub doesn't
  know creates it with no rules, and the job runs straight away. Create the environment with
  reviewers and a branch rule before merging a workflow that uses a new one.
- **New packages are reviewed.** The first version of a new package showed as “Validating” for a
  few minutes and `npm view` returned 404 until the review was done. npm also listed a
  `0.0.0-stage` placeholder; `latest` moved to 0.2.0 by itself once it was validated.
- **Changesets by hand.** `pnpm changeset version` runs locally. A bot that opens the “Version
  packages” pull request (`changesets/action`) would need `contents: write`,
  `pull-requests: write` and the repository setting that lets Actions open pull requests; only
  worth it if releases get frequent.
