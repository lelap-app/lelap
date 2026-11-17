---
name: docs-audit
description: Use when Lelap's docs may have drifted from the code or from each other, when asked to tidy or audit docs, before a release, after a run of milestones, or when two docs seem to disagree about a decision, a status or what is shipped.
---

# Auditing Lelap's docs

Lelap's docs are many small files written milestone by milestone, so they drift: a plan that was
built, a decision reversed later, a status line nobody moved. An audit finds each stale or
contradicting claim and fixes it where it belongs.

## Where each kind of fact lives

Fix a fact in its home and link to it from elsewhere; don't keep copies in sync.

| Fact                                       | Home                                                   |
| ------------------------------------------ | ------------------------------------------------------ |
| Decisions, principles, architecture, stack | `docs/brief.md`                                        |
| Which milestones exist, in what order      | `docs/roadmap.md` (the table)                          |
| A milestone's scope, status, done-when     | `docs/milestones/mN.md`                                |
| Open checks for a milestone                | `docs/mN-follow-ups.md`, gathered in `docs/testing.md` |
| Rules for agents and contributors          | `AGENTS.md` and nested `AGENTS.md` files               |
| What users can do today                    | `README.md`, the landing page, `fastlane/` text        |
| Add-on protocol for developers             | `apps/site/src/pages/docs/` and `packages/sdk`         |

## Steps

1. **Collect claims.** Read the files above. For each, list claims of these kinds: a status
   (“in progress”, “planned”, “done”), a tense (“will”, “later”, “not yet”, “coming”), a number
   (counts of images, languages, milestones), a decision (“we use”, “never”, “not planned”), and a
   link with an anchor.
2. **Check each claim against the source of truth**, in this order: the code, then git history
   (`git log -S'<term>'`, merged pull requests), then the most recent dated doc. A milestone file
   saying “planned” loses to merged code.
3. **Find contradictions between docs**, especially decisions: `grep -rn` the key words of each
   brief decision and of each “Decisions on <date>” section across `docs/`. A later milestone that
   plans what a decision ruled out (or the other way round) is a contradiction.
4. **Check links:** every relative link and `#anchor` in `docs/`, `README.md` and `AGENTS.md`
   resolves (headings change when sections move).
5. **Report before fixing.** Give the user a table: file:line, the claim, what is true, the fix.
   Contradictions between two decisions are the user's call: ask which one stands, then record it
   with the `record-decision` skill.
6. **Fix** the rest: move facts to their home, delete duplicates and finished plans, update
   status lines in milestone files (never the roadmap table), and fix links. Run
   `pnpm format:check`.

## Common mistakes

| Mistake                                          | Instead                                                |
| ------------------------------------------------ | ------------------------------------------------------ |
| Updating both copies of a duplicated fact        | Keep it in its home; replace the copy with a link.     |
| Deciding a contradiction yourself                | Ask; the user owns decisions.                          |
| Trusting a milestone file over the code          | The code is the truth for “shipped”.                   |
| Deleting a planning doc that other files link to | `grep -rn '<file>.md'` first and fix every link.       |
| Rewriting history in follow-ups and test rounds  | Dated results stay as they were; add a new dated note. |
