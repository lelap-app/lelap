# M24 follow-ups

Checked in the web preview: playing a book adds it to the Stats screen, which shows today, the week
bars, the year, the streak, the goal card and the most listened books. Covered by tests: day totals,
streaks across days, the year's top books, books finished this year and the rule that seeks don't
count as listening.

Open on a phone:

- Listening with the screen off for half an hour shows about 30 min today.
- Listening with the app swiped away: the playback service keeps going without JavaScript, and
  that time is not counted yet. Decide whether the service should keep its own small tally that
  the app folds in, as it does with places (`takeJournal`).
- Skipping 30 s, seeking and changing speed don't inflate the time.
- The goal sheet sets and clears a goal; the bar fills as books are marked finished.
- A day starts at local midnight; check across midnight and after changing time zone.
