---
name: lelap-voice
description: Use when writing any English text for Lelap that a person reads, such as UI copy, landing page text, docs, README, changelog, store descriptions, commit messages, pull request titles and bodies, or code comments, or when reviewing such text.
---

# Lelap's voice

Lelap talks like a calm friend who knows audio: plain words, short sentences, concrete facts. The
same voice runs through the app, the site and the repository.

## The recipe

- **Plain words.** “Sleep timer”, not a coined name. “Download”, not “sync offline content”. Say
  what happens, not what the feature is called internally.
- **Short sentences.** One idea each. Split at “and” when both halves stand alone.
- **Concrete over general.** “Plays with the screen off and the app closed” beats “seamless
  background playback”. Numbers when you have them: “30 s”, “12-character code”.
- **Calm, not salesy.** No exclamation marks, no “amazing”, “powerful”, “simply”, “just”.
- **Colons and semicolons, not em dashes.** Lelap's text has none; use a colon for an explanation,
  a semicolon for two linked clauses, or two sentences.
- **Curly quotes in prose and UI:** “like this” and it’s; straight quotes only in code.
- **British spelling in prose:** organise, optimisation, colour. Code identifiers and CSS keep
  their own spelling (`color`).
- **Sentence case** for headings, buttons and titles: “Add-on settings”, not “Add-On Settings”.

## Per place

| Place                | Shape                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI text              | Through `t()`, with the Malay line in `apps/app/src/i18n/catalogs/ms.json`. Buttons are verbs: “Download”, “Jump to”.                                                                                                                                |
| Error messages       | What happened and what to do: “LibriVox did not answer. Try again later.” Never blame the user.                                                                                                                                                      |
| Commit and PR titles | No prefix types like `feat:`. Milestones: `M39 Precise seeking: marks, snapping, …`. Others: `Area: what changed` (`Landing page: a beta state that offers the Android beta`) or a plain sentence (`Keep the web app under the proxy's rate limit`). |
| PR bodies            | A bullet per user-visible change, then what was checked where, then what is left.                                                                                                                                                                    |
| Docs                 | The fact first, the reason after. Link instead of repeating.                                                                                                                                                                                         |
| Code comments        | The why, one or two lines, only where a reader would be surprised.                                                                                                                                                                                   |

## Example

Before: “🎉 Introducing our powerful new Smart Sleep feature — it seamlessly detects chapters!”

After: “The sleep timer can now stop at the end of the chapter.”

## Always

English everywhere. Never name piracy-related services, torrent indexes or file hosters, even as
a counter-example.
