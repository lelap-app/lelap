# Contributing to Lelap

Thanks for helping. Bug reports, ideas that fit [the plan](docs/brief.md) and small focused pull
requests are all welcome. Start with [`docs/architecture.md`](docs/architecture.md) for how the
pieces fit together; [`docs/roadmap.md`](docs/roadmap.md) lists what is planned.

## Setup

You need Node 24 (`.nvmrc`) and pnpm through Corepack.

```bash
corepack enable
pnpm install
```

`pnpm install` also installs a pre-commit hook that runs ESLint and Prettier on staged files.

## Running things

| What                        | Command                           | Notes                                                      |
| --------------------------- | --------------------------------- | ---------------------------------------------------------- |
| The app in a browser        | `pnpm dev:app`                    | Then press `w`. The web app keeps its database in OPFS.    |
| The app on an Android phone | `pnpm android`                    | Needs Android Studio's SDK and a phone with USB debugging. |
| The landing page and docs   | `pnpm dev:site`                   |                                                            |
| A service                   | `pnpm --filter @lelap/<name> dev` | `wrangler dev` simulates D1, R2 and KV offline.            |

A development build on a phone is signed with a debug key, so a release APK can't install over it
(and the other way round): uninstall one before installing the other.

## Before you open a pull request

```bash
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
```

CI runs the same five on every pull request, plus the Kotlin unit tests when native code changes.

## Pull requests

- Keep each pull request to one change, with a title that says what it does.
- Write in English: code, comments, docs and commit messages.
- If your change makes [`docs/brief.md`](docs/brief.md), [`docs/architecture.md`](docs/architecture.md)
  or an `AGENTS.md` untrue, update it in the same pull request.
- Comment the why, only where a reader would otherwise be surprised.
- Add a test when you fix a bug or add logic.
- **Database changes:** generate the migration with `pnpm exec drizzle-kit generate` in
  `packages/core`, on top of the latest `main`; never write or renumber one by hand.
- **UI text** goes through `t()` with the English as the key; see
  [`apps/app/src/i18n/README.md`](apps/app/src/i18n/README.md).
- **Milestones:** each has a file in [`docs/milestones/`](docs/milestones/) with its status, and
  open checks in `docs/mN-follow-ups.md`. Update the status in that file, not in the roadmap table.

## Releases

Maintainers tag `vX.Y.Z` (or `vX.Y.Z-beta.N`) on `main`. The release workflow builds and signs
the APKs after a maintainer approves it, publishes them, ships the over-the-air update and the
Docker images. The steps are in [`docs/architecture.md`](docs/architecture.md#pipelines).

## What we won't accept

Lelap stays a neutral player. We close, without discussion, issues and pull requests that:

- add code, add-ons, docs or examples aimed at finding, indexing or resolving pirated content,
- add lists of or links to third-party add-ons,
- route audio through Lelap's own servers.

Add-ons for open sources and for storage you control (your files, your server) are welcome.

## Conduct

Be kind and assume good intent. Criticise code, not people. Maintainers may remove comments or
contributors that make the project unpleasant for others.

## License

By contributing, you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE), or MIT for code in the add-on SDK.
