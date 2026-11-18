# M55 follow-ups

Checked in the web preview (Chromium, dev server): every page (`/`, `/ms/`, the nine `/docs/`
pages, `/privacy`, `/terms`, the 404 page) with the system scheme emulated light and dark, at
1280 px and 375 px. A script measured the contrast of every visible text element against its
real background on all 14 pages in both themes: no element below AA (4.5:1, or 3:1 for large
text). The switch by keyboard (Enter and Space): it cycles system, the opposite of the system,
then the system's own scheme; the saved choice beats the system setting and carries over to other
pages and reloads; the `theme-color` metas follow it. The phone mock-ups keep the app's night
theme on the light page. The header stays on one row at 375 px with the switch.

Covered by tests: `apps/site/test/contrast.test.ts` reads the tokens from `global.css` and checks
every text pair of both themes against WCAG AA (lowest by day: amber text on `--surface-2` at
4.67:1, `--muted` at 5.28:1), that the fallback for browsers without `light-dark()` matches the
night colours, and that components add no colour literals of their own.

## Open in other browsers and on a phone

- <a id="no-flash"></a>Safari on a Mac and on an iPhone, and Firefox: with a saved choice opposite
  to the system's, a cold load of `/` and `/docs/` never shows the other theme, not even for a
  frame. With JavaScript turned off the page follows the system setting and there is no switch.
- <a id="phone"></a>On a phone at night and by day (system dark mode on and off): the browser bar
  takes the page's colour, the page reads well in sunlight, and the switch is easy to hit.
- <a id="screen-reader"></a>VoiceOver and TalkBack name the switch “Theme: follows the system”
  (in Malay on `/ms/`, “Tema: ikut sistem”); after a press they read the new state when the focus
  returns to it.
- <a id="old-safari"></a>Safari 17.4 or older (no `light-dark()`): the whole site shows the night
  theme and the switch is hidden.

## Minor review findings, not fixed here

- The switch's new name after a press may not be announced while the focus stays on it; an
  `aria-live` region or a tooltip would help. An icon-only button also has no tooltip for mouse
  users.
- Other open tabs keep the old theme until they reload (no `storage` listener).
- `.visually-hidden` in `Base.astro` repeats the rules of `.lang-name` and the manifest builder's
  copy; one shared class in `global.css` would do.
- `site.webmanifest` keeps the night colours, so the installed site's splash screen is dark in
  either theme.
- At 320 px the header wraps to two rows and the hero's phone mock-up is wider than the screen.
  Both were so before M55.
- Input borders in the manifest builder (`--line-strong` on `--surface`) are below 3:1 in both
  themes, as before M55.
