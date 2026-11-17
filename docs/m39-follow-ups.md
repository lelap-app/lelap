# M39 follow-ups

Checked in the web preview: switching the bar to the whole book (chapter ticks), and Jump to with a
typed `10:00`. Covered by tests: parsing typed times, the scrub speeds and snapping.

Open on a phone (touch only):

- Drag the playhead and move the finger up: the label shows half, quarter and fine speed, and
  the playhead follows more slowly.
- Drag past a bookmark dot: the playhead snaps to it with a short buzz, once per mark.
- Jump to with the number keyboard: `2:14:30` and `+5 min` in a long book land where expected.
- TalkBack: the elapsed time says it opens Jump to; the note under the bar switches the range.
