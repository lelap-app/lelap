---
name: site-screenshots
description: Use when the landing page's drawn phone screens (PhoneMockup.astro, CatalogMockup.astro) may have drifted from the app after a UI change, when asked for reference shots of the Lelap app with the demo library, or when the demo library needs a new book, row or screen.
---

# Site screenshots

The landing page draws the app in markup and CSS (`apps/site/src/components/PhoneMockup.astro`
and `CatalogMockup.astro`), sharp at any size. This skill makes reference shots of the real app
with a demo library, never a real one, to keep those drawings faithful. The shots are for
comparing, not for the site: never commit them. One script builds the web app against a local
demo add-on, drives a headless Chrome through it like a person, and writes PNG files to its work
folder.

## Run it

```sh
node .claude/skills/site-screenshots/shoot.mjs            # export the web app, then shoot en and ms
node .claude/skills/site-screenshots/shoot.mjs --reuse-export --lang ms --debug
```

`--lang` can be given more than once; `--out` changes where the PNG files go (default
`<work>/shots`); `--port` changes 8197 (the export bakes the port in, so change it only together
with a fresh export). Node 24 and Google Chrome (or
`CHROME=/path/to/chrome`). The export takes a minute or two;
`--reuse-export` skips it when only the flow or the library changed, never after an app change.
`--debug` saves a picture after the first play; a failure always saves the last screen as
`failed.png` in the work folder (`--work`, default `$TMPDIR/lelap-site-screenshots`).

Then put each shot beside the drawing on `/` and `/ms/` and check the list below.

## What it does

| Step   | Where                         | What                                                                                                                                                                                                                                                                                                                   |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export | `shoot.mjs` `exportApp`       | `expo export --platform web` with `EXPO_PUBLIC_LELAP_ADDONS` set to the demo add-on, the proxy, sync, downloads and updates hosts set to the local server, and the domain set to `demo.invalid`, so nothing reaches lelap.app.                                                                                         |
| Serve  | `shoot.mjs` `serve`           | One port (8197): the exported app, the demo add-on (`/demo/…`), covers, silent WAV audio made on the fly with range requests, and a stand-in for the proxy's `/cover` (the web app sends plain-http covers there, the player twice).                                                                                   |
| Seed   | `library.mjs`                 | The demo library: the made-up Early Mornings at the Laksa Café by Janet Tay, six chapters of silent audio, and the rows Self-improvement, Growing up, Horror and uncanny. Those shelves are real titles with our own drawn covers and no audio (metadata only, as a reading list's would be). English and Malay lines. |
| Covers | `library.mjs`, `renderCovers` | Chrome draws each cover to a 600 px PNG; the hero cover uses the site's own fonts.                                                                                                                                                                                                                                     |
| Drive  | `shootLanguage`, `chrome.mjs` | A fresh browser context per language (empty OPFS, so no real data). Clicks go by the app's own labels from `apps/app/src/i18n/catalogs/<lang>.json`, so a renamed button fails loudly instead of shooting the wrong screen.                                                                                            |
| Save   | `save`                        | `{home,player}-{en,ms}.png`, 896 × 1994: a Pixel 10 Pro XL screen (448 × 997 dp) at 2×, the same shape as the site's drawn phone.                                                                                                                                                                                      |

The flow: Skip on the welcome; Home loads the add-on's rows; for Malay, Settings → language; open the Laksa book and
Play; jump (tap the elapsed time) to 53:56, which is chapter 3 at 12:04; load `/` again, which
starts the app afresh; shoot Home with
Continue listening; tap it; speed 1.25×, sleep 30 minutes, jump again; shoot the Player.

## Compare with the drawings

- The shot is valid: only demo data, covers loaded (no grey squares), no sheet or dialog left
  open, no error text, and the same state in English and Malay.
- The drawing matches it: layout, spacing, type sizes, icons, colours and labels. Sizes in the
  drawings are the app's dp (`calc(N * var(--dp))`), so read them from the app's components
  (`PlayerView.tsx`, `Scrubber.tsx`, `ContinueCard.tsx`, `CatalogRow.tsx`, `MetaCard.tsx`) and
  copy new icons from `apps/app/src/components/Icon.tsx` into `AppIcon.astro`.
- A new label goes through `t()` with its Malay line in `apps/site/src/i18n/ms.ts`, the app's
  own Malay where it has one. If the screen now shows something else, update the picture labels
  in `PhoneMockup.astro` and `CatalogMockup.astro` too.
- Known differences: the drawing adds an Android status bar and gesture bar but keeps the web
  layout (no car mode button, no Cast tool), uses the site's Inter rather than the system font,
  and the player shows two bookmarks where the shot has none.
- Then `pnpm --filter @lelap/site test`, `check` and `build`, and look at `/` and `/ms/`.

## Changing what is shot

- **A label changed in the app:** the run stops at “Timed out waiting for …” (or “The app has no
  ms line for …” when the Malay line is missing). Open `failed.png`,
  update the label in `shootLanguage`. Write the English text: it is the key, so there is no
  `en.json`; the Malay comes from `apps/app/src/i18n/catalogs/ms.json`.
- **A new screen:** add a step that ends in `shots.<name> = await page.screenshot()`; draw it on
  the site like the other two.
- **A new book or row:** add it in `library.mjs` with a drawn cover in `art`, and the same
  drawing in `CatalogMockup.astro`; keep the colours to the cover palette at the top, so amber
  stays the only accent. A book with audio is made up; a real title stays metadata only.
- **A new language:** add its lines to `TEXT` in `library.mjs`; the app must have the catalog.

## Limits

- The app has one dark theme, so there is one set of shots; the site draws the phone in the night
  theme on both of its themes.
- Expo web only. Android-only parts (downloads to an SD card, car mode, the widget, casting
  devices, skip silence) can't be shot here; they need an emulator, which this skill doesn't drive.
- Clocks keep running while the player plays, so the times differ by a second or two between runs.

## Common mistakes

| Mistake                                                        | Instead                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Taking screenshots by hand in the dev server or on a phone     | Run the script; a profile with your own library must never be in a picture. |
| `--reuse-export` after changing the app                        | Run without it, or the shots show the old UI.                               |
| Comparing with a run that printed page errors or timed out     | Fix the flow and run again; check every shot.                               |
| Real publisher covers or a real person's library for “realism” | Draw a cover in `library.mjs`.                                              |
| Shots in `apps/site`                                           | The site draws the app; the shots are references and stay out of the repo.  |
