---
name: record-decision
description: Use when the user makes or changes a Lelap decision (a choice of technology, protocol, scope, naming, policy, or “we won't do X”), when a discussion ends in “let's go with…”, or when a decision is found only in a planning file, a milestone file or a pull request.
---

# Recording a decision

Decisions live in one place: the Decisions table in `docs/brief.md`. Anywhere else they get lost
or contradicted by a later plan. Record a decision in the same pull request as the change it
causes, or in its own small pull request when nothing else changes.

## Steps

1. **State it back** to the user in one sentence, with the reason, and confirm it is a decision
   (not an idea to try). Only the user makes decisions; an agent proposes.
2. **Search for conflicts:** `grep -rn` the topic's key words across `docs/`, `AGENTS.md`,
   `README.md` and `apps/site/src`. List every place that says otherwise, including planned
   milestones that the decision rules in or out.
3. **Write the row** in the Decisions table of `docs/brief.md`:
   `| Topic | Decision | Why |`. Topic is one or two words; Decision is what we do, in present
   tense; Why is the reason a newcomer would ask for. If it replaces an older decision, change
   that row instead of adding one, and say what it was before when that helps (“it was “Lull”
   until M1”).
4. **If it is architecture or a stack choice**, update that section of the brief too, and
   `AGENTS.md` when it changes a rule or a stack line (AGENTS.md says the stack can't change
   without the brief).
5. **Fix every conflict** from step 2: reword or delete the stale text, change the scope of a
   planned milestone file, or ask the user when a conflict is a judgement call (for example a
   milestone that would become pointless).
6. Run `pnpm format:check`; commit as `Brief: <decision in a few words>`.

## Example

The user says: “No guessed chapters, ever.”

- Brief row: `| Chapters | From tags, feeds and Audnexus only; never guessed from silence | A wrong chapter mark is worse than none. |`
- Conflict found: `docs/milestones/m45.md` plans chapters from silences. Ask whether M45 keeps
  only intro and outro skipping or goes away, then change the milestone file (never the roadmap
  table's order or rows without asking).
