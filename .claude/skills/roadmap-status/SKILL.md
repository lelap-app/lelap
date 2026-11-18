---
name: roadmap-status
description: Use when the maintainer asks where Lelap stands, for a roadmap or project overview, a status dashboard, what to work on next, what is blocked or waiting on them, or how far the next release is (“status”, “overblik”, “hvad nu”, “what's next”).
---

# Roadmap status

Show the maintainer, at a glance and without Markdown to read, where Lelap stands, what is
moving, what waits on them, and what to do next. The skill only reads. It never merges, tags,
starts work or changes files. The answer is a visual card and a short reply, in the language the
maintainer wrote in.

## 1. Gather (run these in parallel)

Read from `origin/main`, not from a branch: `git fetch -q --tags origin`, then run the script in a
checkout of `origin/main`. In a worktree with no uncommitted work, `git switch --detach origin/main`
is fine. Otherwise use `git worktree add --detach <scratch dir> origin/main` and remove it after.

| What               | Command                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestones         | `node scripts/roadmap.mts status`: JSON with each milestone's status, summary, PRs, item count, open checks by tag (`adb`, `you`), open questions and left-out count                  |
| Open pull requests | `gh pr list --json number,title,headRefName,isDraft,mergeable,updatedAt,statusCheckRollup`                                                                                            |
| CI on main         | `gh run list --branch main --limit 6 --json name,status,conclusion`                                                                                                                   |
| Last release       | `git tag --sort=-v:refname \| head -3`; the downloads host's `beta.json` (and `latest.json` once stable) for what phones get                                                          |
| Since the last tag | `git log --first-parent --oneline <tag>..origin/main`; native changes with `git diff --stat <tag>..origin/main -- modules/ apps/app/app.json apps/app/app.config.js apps/app/plugins` |
| Waiting approvals  | `gh run list --workflow release.yml --limit 3`; for a waiting run, `gh api repos/{owner}/{repo}/actions/runs/<id>/pending_deployments`                                                |
| SDK                | `ls .changeset/*.md` (pending changes) and `npm view @lelap/sdk version`                                                                                                              |
| Security           | `gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] \| select(.state=="open")] \| length'`                                                                                      |

Add what this session knows and the files don't: agents or sessions still running and what they
build, and decisions the maintainer was asked for in chat and hasn't answered.

## 2. Work out

- **In flight:** open PRs, with CI (green, failing, running) and mergeable or conflicting; agents or
  sessions still building.
- **Waiting on the maintainer**, the most useful part, so be specific:
  - release approvals waiting in a run
  - questions asked in chat and not answered
  - `(you)` open checks: count, and name the ones that block a release
  - `## Open questions` in milestone files
  - pending SDK changesets not on npm
  - native changes merged since the last tag that phones only get with a new APK

  Every item here must come from something you checked just now (a command's output, a file, an
  unanswered question in this chat), never from an agent's report or your memory of an earlier
  state. A setup step someone said was still to do (a token to delete, a setting to change) is only
  listed after you confirmed it is still undone; when it can't be checked from here, leave it out
  or ask.

- **Blocked:** a PR with failing CI or conflicts, a milestone that needs another one first, or work
  that can only be checked on a phone or receiver (name the `(adb)` count).
- **Next, at most three, each with one line of why.** Rules, in order:
  1. Finish what's in flight: merge green PRs, fix red ones.
  2. Something the maintainer asked for and not yet started.
  3. A release, when user-visible fixes or native changes have piled up since the last tag. Say
     what it would carry.
  4. A phone test round over adb, when `(adb)` checks are many and recent work has settled, not
     while many changes are still landing.
  5. Planned milestones: bugs and small ones first.

  Don't suggest two at once that touch the same area (the same screens, the scan, casting, the
  release pipeline). Don't suggest more than one add-on protocol revision in a batch.

## 3. Show

Load the visualize module (`mcp__visualize__read_me` with `interactive`, platform `mobile` when the
maintainer is on Remote Control or a phone) and draw one card with `show_widget`, top to bottom:

1. **Headline:** one sentence on where things stand, e.g. “Beta 7 is out; 3 PRs in flight; nothing
   waits on you.”
2. **Numbers row:** milestones done / in progress / planned; open checks `adb` / `you`; open PRs;
   commits since the last tag.
3. **Next:** up to three cards, each with a title, the reason, and a button that calls
   `sendPrompt` with the request (“Start M65”, “Release beta 8”, “Merge #160”).
4. **Waiting on you:** each item with what to do. Empty: say “Nothing waits on you.”
5. **In flight:** PRs and agents, each with a coloured status dot.
6. **Milestones:** a compact grid of the not-done milestones (number, short title, status colour,
   a small `adb`/`you` check count). Done milestones as one count, not a list.

Plain words, no Markdown inside the card. Colours only for status (green done, amber in progress,
grey planned, red blocked), each with a text label too. No percentages for progress: bars or
counts.

Without the visualize tool, publish the same as an Artifact page; failing that, a short Markdown
table.

After the card, the reply is two or three sentences: the headline and the first next step. Don't
repeat the card.

## Common mistakes

| Mistake                                    | Instead                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Reading a feature branch's milestone files | Always `origin/main`, freshly fetched                                   |
| Listing every done milestone               | One count; the maintainer wants what's open                             |
| “Next” from the table order alone          | Apply the rules: in flight, asked for, release, test round, small first |
| A long Markdown reply under the card       | Two or three sentences                                                  |
| Starting the suggested work                | This skill only shows; the maintainer chooses                           |
