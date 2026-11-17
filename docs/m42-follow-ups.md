# M42 follow-ups

Covered by tests: `pnpm --filter @lelap/app test` runs `scripts/check-accessibility.mjs`, which
fails when a `Pressable` has no role, or neither text nor `accessibilityLabel`; when a
`TextInput` or `Switch` has no `accessibilityLabel`; when a control is under 48 points (thin
padding and no minimum height); when layout uses left and right (`ml-`, `pr-`, `left:`,
`marginLeft`…) instead of start and end; and when a text colour of the theme falls below WCAG AA
on `night` or `raised` (4.5:1), or `muted` on `line` below 3:1. The widget's names are in
`ModelsTest` (`./gradlew :lelap-widget:testDebugUnitTest`).

Checked in the web preview (375×812, through the accessibility tree and screenshots): Home,
Discover, Search, Podcasts, Library, Player, Settings, Stats, Profiles, Sync, Add-ons,
Downloads, Up Next and Add a server. Every control has a name, screen titles and section titles
are headings, the scrubber is a slider with its time as text (“0:03 of 30:00”), and no row
holds a button inside a button. With every text doubled in size (the largest Android font
size), nothing is clipped on those screens apart from titles that end in “…” on purpose
(see below); the Home header now wraps, the scrubber's middle note wraps between the two times,
and the Player scrolls when it no longer fits. With `dir="rtl"`, rows, margins and chips flip;
the scrubber and its times stay left to right, as a time line does in every language.

Not checkable in the web preview: TalkBack itself, Android's font scale (the web has none), the
tab bar's height at large font sizes, the chevrons turning round (they follow
`I18nManager.isRTL`, which is never true on the web), reduced motion, and the widget, tile and
notification.

## Decisions to confirm

- **Right to left stays off on Android for now.** Layouts use start and end and were checked in
  the web preview, but `supportsRTL` is not turned on: with only English and Malay, an Arabic or
  Hebrew phone would mirror English text. It goes on with the first right-to-left language.
- **Long titles may end in “…”.** Book and episode titles in lists, tiles and the mini player
  keep their line limits at large sizes; the full title is still read by TalkBack and shown on
  the item page. Text that is not a title wraps instead.
- **The Player's tool labels shrink to fit** (Android's `adjustsFontSizeToFit`) rather than wrap,
  since up to seven tools share one row. Each tool's full name is its accessibility label.
- **The skip buttons say the real interval** (“Back 15 seconds”) instead of always 30.

## TalkBack walk-through, per screen

Turn TalkBack on, then swipe right through each screen from the top. Each control should be
read with its name and what it is (button, switch, slider, heading, selected or checked), and
nothing should be read twice or skipped.

- **Who’s listening** (with two profiles): “Who’s listening?, heading”, then each profile as a
  button with its name (and “PIN” when it has one). One with a PIN: the PIN field is read as
  “PIN”, a wrong PIN is announced at once, “Back” is a button.
- **Home**: “Lelap, heading”; the add-ons button with its count; “Switch profile”, “Listening
  stats”, “Settings”; the Continue card as a button that says it plays from where you stopped;
  each catalog row's title with “More” as one button, then its tiles (title, author and where it
  plays from). The notifications question: “Not now” and “Allow” buttons.
- **Discover**: heading, the catalog chips with the current one “selected”, “Playable only” as a
  switch with its state, genre chips, then the tiles.
- **Search**: heading, the field read as “Search”; after a search the status line (“Searching…”,
  results) is announced without moving focus; each section title is a heading.
- **Podcasts**: heading, “Up Next”, the feed field “Feed address (RSS)”, “Add”, “Import OPML”,
  “Export OPML”, then each subscription as a button.
- **Library**: heading, the sort chips with the current one selected, tag chips, lists and “New
  list”; each book as a button (double tap and hold for the menu). The folder banners are buttons.
- **Item page**: “Back”, the title as a heading, the sources as radio buttons with the chosen one
  checked, Play or Continue, Download, “Show all n”, “More about this book” as a link.
- **Podcast page**: “Back”, “Support this show” and people as links, Subscribe or the
  auto-download switch read as “Auto-download” with its state, the keep chips with the current one
  selected, “Unsubscribe”; each episode as a button with “Download episode” after it.
- **Player**: “Close player”, “Chapter n of m”, “Car mode”; the title; the chapter title as a
  button that opens the chapters; “Add bookmark”; the scrubber as “Position, slider, 12:30 of
  45:00”: swiping up and down moves a twentieth of the range and the new time is read; the elapsed
  time (“Jump to a time”) and the whole-book note as buttons; “Back 30 seconds” (or the set
  interval), “Previous chapter”, “Play”/“Pause”, “Next chapter”, “Forward 30 seconds”; then
  “Speed, 1×”, “Sound”, “Sleep”, “Chapters”, “Transcript”, bookmarks and “Cast”.
- **Player sheets**: each sheet's title is a heading and the dimmed area above is a “Close”
  button. Chapters: the current chapter is “selected”. Bookmarks: each bookmark has a “Delete”
  action in TalkBack's actions menu. Speed, Sleep, Jump to (its field is “Time to jump to”) and
  Sound (switches named by their row). Cast: “Volume down”, “Volume up”, the playing device
  “selected”.
- **Transcript**: each line is a button that plays from its time; a new speaker's name is read
  before the line.
- **Car mode**: the title, “Leave car mode”, then the five big buttons with full names (“Back 30
  seconds”, “Sleep timer off”).
- **Settings**: “Back”, “Settings, heading”, “About the language”, the language chips; each
  section title is a heading; each switch is named by its row (“Download only on Wi-Fi, switch,
  on”); each short button says its row after a pause (“Open, button, Downloads and storage”);
  the skip interval chips as “30 seconds, selected”; bedtime: the switch, then “From, 30 minutes
  earlier” and “later” with the new time announced.
- **Profiles and a profile**: each profile as a button; the name field “Name”; the avatars as
  radio buttons with their names (“Owl”, “Fox”, “First letter of the name”) and the current one
  checked; the PIN field, “Set PIN”, “Remove PIN”, the kids switch, each catalog switch by its
  add-on name, “Delete this profile”.
- **Sync, Add-ons, Add a server, Downloads, Up Next, Stats, Convert**: every field is read with
  its label (not its placeholder), “Configure {add-on}”, “Move up”, “Move down”, “Remove from Up
  Next”; Stats reads the week chart as one sentence (“Last 7 days: …”).
- **Dialogs** (remove, delete): Android's own dialogs, read by TalkBack as usual.

Open on a phone:

- **TalkBack**: the walk-through above on every screen.
- **Largest font size** (Settings → Display → Font size at the largest, and Display size at the
  largest): every screen above without clipped text; the tab bar labels are whole; the Player
  scrolls and fine scrubbing (moving the finger up) still works there; the tool labels shrink
  rather than overlap.
- **Touch targets**: Accessibility Scanner on Home, Library, Player and Settings finds no target
  under 48 dp.
- **Remove animations** (Settings → Accessibility): sheets, dialogs, the Player and car mode open
  without sliding or fading; the transcript jumps to the current line without scrolling.
- **Right to left** (Developer options → Force RTL layout direction, after `supportsRTL` is
  turned on in a test build): rows and chips flip, Back and the “›” chevrons point the other way,
  the scrubber and the skip buttons stay as they are.
- **Widget**: TalkBack reads the widget as “title, chapter. Opens the player.”, then “Back 30
  seconds”, “Play”/“Pause”, “Forward 30 seconds”; each control is 48 dp.
- **Quick Settings tile and notification**: TalkBack reads the tile as “title, Playing/Paused”, and
  the notification's buttons with names (back, forward, sleep timer).

## Deferred review findings

- `Pill` puts the chip's classes on an inner view, so the pressed colour (`active:bg-raised`) of
  the tag and add-ons chips no longer shows; the whole chip dims instead.
- `TextButton` has no weight option: “Allow”, “Continue” and “Try again” lost their semibold.
- The checker counts `py-3` with one line of text as tall enough; it is about 44 points.
- Web: `accessibilityHint` and TalkBack actions (bookmark delete, scrubber steps) have no web
  equivalent in react-native-web, and the scrubber can't be moved with the keyboard.
- Untranslated text outside the controls touched here remains (the headphone battery banner, the
  no-audio card on the item page, the widget, tile and notification, which are English only).
