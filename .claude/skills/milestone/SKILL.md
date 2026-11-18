---
name: milestone
description: Use when starting, building, finishing or reviewing a Lelap roadmap milestone (M1–M99, “do M41”, “next milestone”), when several milestones are to be built in a row, or when a milestone's status, open checks or pull request needs writing.
---

# Building a Lelap milestone

Each milestone has one file, `docs/milestones/mN.md`. Its front matter is the source of the
roadmap table, which `pnpm roadmap` writes; nobody edits the table by hand. A milestone is built
in one pull request, with what can't be checked here written into its own `## Open checks`
section for a later test round. This skill is the order to do that in and the files each step
touches.

## The milestone file

```markdown
---
title: Audiobookshelf
status: in progress # planned | in progress | done
summary: Audiobookshelf libraries as a source, with progress synced both ways
prs: [91]
---

# M41 Audiobookshelf

What it brings (planned), or what shipped and where it lives (done).

## Open checks

- [ ] (adb) <the action, on what, and what should happen>
- [ ] (you) <a check that needs the maintainer: calls, car, by ear, accounts, a second device,
      browsers>
```

- `title` matches the heading after `# MN `. `summary` is one line for the roadmap table.
- `status`: `planned` (nothing built), `in progress` (code still missing), `done` (code merged;
  open checks may remain).
- `prs`: every pull request that built it, `[]` until one exists.
- `## Open checks` is always the last section. Each item starts with `(adb)` or `(you)`;
  `pnpm checks` lists them and `pnpm roadmap --check` fails on an untagged one.
- After any change to the front matter or the open checks, run `pnpm roadmap`; CI runs
  `pnpm roadmap --check`.

## Before you write code

1. Read `docs/milestones/mN.md`, `docs/brief.md` (decisions, architecture) and the nested
   `AGENTS.md` of every folder you will touch. If the milestone is in “ideas to pick from” form,
   say which ideas you'll build and why, and ask the user before starting.
2. Look for what earlier milestones left for this one: `grep -rn "MN\b" docs/` (other
   milestones' notes, M40's “Small fixes”, planned milestones that gather skipped work).
3. Branch: `mN/<short-name>` (for example `m39/precise-seeking`). Several milestones in a row: one
   branch and pull request each, each based on the previous milestone's branch (M41 into `main`,
   M42 into M41's branch). The user reviews them one at a time.
4. Set `status: in progress` in the front matter and run `pnpm roadmap`.

## While building

| When you…                          | Also do                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| change the database schema         | `pnpm exec drizzle-kit generate` in `packages/core` on top of the latest `main`; never hand-write or renumber. If a parallel PR merged one first, regenerate after merging `main`. |
| add a native module or test folder | Extend the `android` paths filter of the `android-unit-tests` job in `.github/workflows/ci.yml`, and the repository map in `AGENTS.md`.                                            |
| add a Babel plugin or preset       | Make it a dependency of `apps/app` (release builds bundle JavaScript; pnpm hides transitive ones).                                                                                 |
| add UI text                        | Write it through `t()` and add the Malay line to `apps/app/src/i18n/catalogs/ms.json` (see `apps/app/src/i18n/README.md`). Use the `lelap-voice` skill.                            |
| add a dependency                   | Prefer none. If needed, it must work on native and web, and be 7 days old (`minimumReleaseAge`). Approve build scripts with `pnpm approve-builds`.                                 |
| touch a service                    | Hosts come from configuration, never hard-coded. Audio never goes through a service.                                                                                               |
| make or change a decision          | Use the `record-decision` skill: it goes into `docs/brief.md` in the same pull request.                                                                                            |
| add pure logic                     | Put it in `packages/core` with Vitest tests, so it is tested without a phone.                                                                                                      |

## What you can't check here

The maintainer tests on a phone in batches, not during a milestone. Verify what you can (tests,
`pnpm build`, the web preview with screenshots), then write every remaining check into the
milestone's `## Open checks`, one item each: the action, on what, and what should happen. Tag it
`(adb)` if an agent with a USB phone and `adb` can run it, `(you)` if it needs the user. A short
group word may follow the tag (`(you) [car]`).

**Skipped work is not a check.** Code or a feature you left out (a deferred review finding, a
known limit you could fix, “later”) goes into a planned milestone: add it to an existing planned
milestone of the same area, or make a new file with the next free number, `status: planned`, a
summary and a short body. Small unrelated ideas can go under “Future goals” in `docs/roadmap.md`.

## Finishing

1. Run `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build` and
   `pnpm roadmap --check`.
2. Review your own diff with a fresh pair of eyes (the `code-review` skill or a subagent given the
   diff, not your summary). Fix critical and important findings; put minor ones into a planned
   milestone as above.
3. Front matter: `status: done` once the code is merged (open checks may remain), and the pull
   request numbers in `prs`. Shorten the body to a record: what shipped and where it lives in the
   code, links to decisions in the brief. Never shorten or drop the `## Open checks` section.
   Run `pnpm roadmap`.
4. Commit message and pull request title: `MN Name: what it brings`, for example
   `M39 Precise seeking: marks, snapping, fine scrubbing, whole book, jump to`.
5. Pull request body: if stacked, the first line is `Stacked on #NN (MNN). Merge that first.`
   Then a bullet per user-visible change in plain words, then what was checked where and how many
   open checks the milestone file has.
6. Check `docs/brief.md`, `README.md` and every `AGENTS.md` you passed still describe reality.

## Common mistakes

| Mistake                                             | Instead                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Editing the roadmap table                           | Change the front matter and run `pnpm roadmap`.                   |
| Ticking a check without `pnpm roadmap`              | The table counts open checks; CI fails until it is regenerated.   |
| Asking the user to test on the phone mid-milestone  | Write the check into `## Open checks`; keep going.                |
| Writing skipped work as an open check               | Put it in a planned milestone; checks are tests of existing code. |
| A check without `(adb)` or `(you)`                  | Tag every check; `pnpm checks --adb` relies on it.                |
| One pull request for three milestones               | One per milestone, stacked.                                       |
| A migration numbered by hand after a merge conflict | Regenerate it with `drizzle-kit generate`.                        |
