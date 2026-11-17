---
name: milestone
description: Use when starting, building, finishing or reviewing a Lelap roadmap milestone (M1–M99, “do M41”, “next milestone”), when several milestones are to be built in a row, or when a milestone's status line, follow-ups file or pull request needs writing.
---

# Building a Lelap milestone

Each milestone has one file, `docs/milestones/mN.md`, listed in `docs/roadmap.md`. It is built in
one pull request, with what can't be checked here written down for a later test round. This skill
is the order to do that in and the files each step touches.

## Before you write code

1. Read `docs/milestones/mN.md`, `docs/brief.md` (decisions, architecture) and the nested
   `AGENTS.md` of every folder you will touch. If the milestone is in “ideas to pick from” form,
   say which ideas you'll build and why, and ask the user before starting.
2. Look for what earlier milestones left for this one: `grep -rn "MN\b" docs/` (follow-ups files,
   M40's “Small fixes”, other milestones saying “waits for MN”).
3. Branch: `mN/<short-name>` (for example `m39/precise-seeking`). Several milestones in a row: one
   branch and pull request each, each based on the previous milestone's branch (M41 into `main`,
   M42 into M41's branch). The user reviews them one at a time.
4. Set the status line to `**Status:** in progress.` in the milestone file only. Never edit the
   table in `docs/roadmap.md`; parallel pull requests would conflict on it.

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
`pnpm build`, the web preview with screenshots), then write every remaining check into
`docs/mN-follow-ups.md`:

```markdown
# M41 follow-ups

Checked in the web preview: <what>. Covered by tests: <what>.

Open on a phone:

- <One check per line: the action, then what should happen.>
```

Add each phone check to `docs/testing.md` too, under the matching `A.` section if `adb` can do it
or `B.` if it needs the user, in the form
`- [ ] [M41] <check>. ([m41](m41-follow-ups.md#anchor))`. Deferred review findings go in the
follow-ups file under their own heading.

## Finishing

1. Run `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm build`.
2. Review your own diff with a fresh pair of eyes (the `code-review` skill or a subagent given the
   diff, not your summary). Fix critical and important findings; list minor ones in follow-ups.
3. Status line: `in progress` with one or two sentences on what was built and a link to the
   follow-ups file. `done` only when the follow-ups have no open checks, with the pull request:
   `**Status:** done ([#74](https://github.com/lelap-app/lelap/pull/74)).`
4. Commit message and pull request title: `MN Name: what it brings`, for example
   `M39 Precise seeking: marks, snapping, fine scrubbing, whole book, jump to`.
5. Pull request body: if stacked, the first line is `Stacked on #NN (MNN). Merge that first.`
   Then a bullet per user-visible change in plain words, then what was checked where and what is
   in the follow-ups file.
6. Check `docs/brief.md`, `README.md` and every `AGENTS.md` you passed still describe reality.

## Common mistakes

| Mistake                                             | Instead                                                       |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Marking a milestone done because the code is merged | Done means its phone checks passed.                           |
| Asking the user to test on the phone mid-milestone  | Write the check into follow-ups and `testing.md`; keep going. |
| Editing the roadmap table to change a status        | Status lives in the milestone file.                           |
| One pull request for three milestones               | One per milestone, stacked.                                   |
| A migration numbered by hand after a merge conflict | Regenerate it with `drizzle-kit generate`.                    |
