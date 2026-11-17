# M44 follow-ups

Covered by tests: `src/screen.test.ts` in `packages/core` checks when a window gets two panes
(phones upright and sideways stay on one), the player pane's width, the speed steps and which
key does what, including that a text field keeps every key, a focused button keeps Space and a
slider keeps the arrows.

Checked in the web preview: at 1280 × 800 and 1440 × 900 the tabs are a rail on the start edge,
the player stands beside Home, Discover, Library and an item page, the item page is a column in
the middle and Discover fills the width with more columns. At 800 × 1280 (tablet upright) the
Library list and the player sit side by side. At 390 × 844 the Library, the tab bar, the mini
player and the Player look as before. At 844 × 390 the Player shows the cover beside the
controls. `K` pauses and plays, `L` skips forward, `>` and `<` step the speed one step per press,
`/` opens Search with the field focused, `?` opens the list of shortcuts and Escape closes it.
The browser tool can't send media keys, so those are a browser check below.

Open on a tablet (Android):

- <a id="tablet"></a>On a 10-inch tablet, upright and sideways: the tabs are a rail, the player
  stands beside the list once a book plays, and tapping a book in the Library plays it there
  without opening the full-screen player.
- On the tablet, car mode and the full-screen player (from a notification) hide the pane, and
  Back returns to the two panes.
- A phone turned sideways: the Player shows the cover beside the controls, nothing is cut off
  under the camera cut-out, and turning it back gives the upright Player.
- TalkBack on the tablet reads the rail's tabs and the pane's controls in order: list first, then
  the player.

Open in a browser:

- <a id="media-keys"></a>Media keys on a laptop keyboard in Chrome, Firefox and Safari: Play/Pause
  plays and pauses with the tab in the background; ⏮ and ⏭ skip 30 s; the browser's media
  overlay shows the progress in the current file and can drag within it.
- Keyboard only: Tab moves through the rail, the list and the player pane; Space on a focused
  button presses it once and doesn't also play or pause.

## Deferred review findings (minor)

- The rail uses React Navigation's `tabBarPosition: 'left'`; check on a right-to-left language
  that it moves to the start edge.
- A large phone sideways at the smallest display size can reach about 1066 × 480 dp and pass the
  two-pane rule. If that happens on a real phone, raise `WIDE_MIN_HEIGHT` in
  `packages/core/src/screen.ts`.
- Discover rebuilds its grid (and scrolls to the top) when the player pane appears or the window
  is resized past a column, since the column count changes.
- Media Session's position state is for the current file, not the chapter or the book, and is not
  cleared when the book is unloaded.
- The list of shortcuts reads the skip interval when it renders; a change in Settings shows the
  next time it opens.
