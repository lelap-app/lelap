# Contributing to Lelap

Thanks for helping. Lelap is early, so the most useful contributions right now are bug reports,
ideas that fit [the plan](docs/brief.md), and small focused pull requests.

## Setup

You need Node 24 (`.nvmrc`) and pnpm through Corepack.

```bash
corepack enable
pnpm install
pnpm dev:site
```

`pnpm install` also installs a pre-commit hook that runs ESLint and Prettier on staged files.

## Before you open a pull request

```bash
pnpm format:check
pnpm lint
pnpm check
pnpm build
```

CI runs the same four commands on every pull request.

## Pull requests

- Keep each pull request to one change, with a title that says what it does.
- Write in English: code, comments, docs and commit messages.
- If your change makes [`docs/brief.md`](docs/brief.md) or an `AGENTS.md` untrue, update it in the
  same pull request.
- Comment the why, only where a reader would otherwise be surprised.
- Add a test when you fix a bug or add logic, once the package has a test setup.

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
