---
name: site-screenshots
description: Use when the landing page's app screenshots (apps/site/src/assets/screens) are out of date after a UI change, when asked to regenerate, retake or add screenshots of the Lelap app for the site, or when the demo library of made-up books needs a new book, row or screen.
---

# Site screenshots

The landing page shows the real app, never a drawing, and never a real library. One script builds
the web app against a local demo add-on, drives a headless Chrome through it like a person, and
writes WebP files that `apps/site/src/components/AppScreen.astro` imports.

## Run it

```sh
node .claude/skills/site-screenshots/shoot.mjs            # export the web app, then shoot en and ms
node .claude/skills/site-screenshots/shoot.mjs --reuse-export --lang ms --debug
```

Node 24 and Google Chrome (or `CHROME=/path/to/chrome`). The export takes a minute or two;
`--reuse-export` skips it when only the flow or the library changed, never after an app change.
`--debug` saves a picture after the first play; a failure always saves the last screen as
`failed.png` in the work folder (`--work`, default `$TMPDIR/lelap-site-screenshots`).

Then look at all four files before committing: Read each WebP and check the list below.

## What it does

| Step   | Where                         | What                                                                                                                                                                                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Export | `shoot.mjs` `exportApp`       | `expo export --platform web` with `EXPO_PUBLIC_LELAP_ADDONS` set to the demo add-on and the proxy, sync and downloads hosts set to the local server, so nothing reaches lelap.app.                                                   |
| Serve  | `shoot.mjs` `serve`           | One port (8197): the exported app, the demo add-on (`/demo/…`), covers, silent WAV audio made on the fly with range requests, and a stand-in for the proxy's `/cover` (the web app sends plain-http covers there, the player twice). |
| Seed   | `library.mjs`                 | The made-up library: Early Mornings at the Laksa Café by Janet Tay, six chapters, and the rows Self-improvement, Growing up, Horror and uncanny. Real shelf titles, our own drawn covers. English and Malay lines.                   |
| Covers | `library.mjs`, `renderCovers` | Chrome draws each cover to a 600 px PNG; the hero cover uses the site's own fonts.                                                                                                                                                   |
| Drive  | `shootLanguage`, `chrome.mjs` | A fresh browser context per language (empty OPFS, so no real data). Clicks go by the app's own labels from `apps/app/src/i18n/catalogs/<lang>.json`, so a renamed button fails loudly instead of shooting the wrong screen.          |
| Save   | `save`                        | `{home,player}-{en,ms}.webp`, 780 × 1688 (390 × 844 at 2×), quality 88. Astro's `<Picture>` makes the 300 and 600 px AVIF and WebP sizes.                                                                                            |

The flow: Home loads the add-on's rows; for Malay, Settings → language; open the Laksa book and
Play; jump (tap the elapsed time) to 53:56, which is chapter 3 at 12:04; reload; shoot Home with
Continue listening; tap it; speed 1.25×, sleep 30 minutes, jump again; shoot the Player.

## Before committing, check each picture

- Only made-up data: the demo add-on (badge “Demo”), the Laksa book, the drawn covers. No real
  covers, no file names, no other add-ons.
- The same state in English and Malay, and the Malay one fully in Malay apart from book titles.
- Covers loaded (no grey squares), no sheet or dialog left open, no error text.
- It still matches the alt texts in `AppScreen.astro` and their Malay lines in
  `apps/site/src/i18n/ms.ts`. If the screen now shows something else, change both.
- Then `pnpm --filter @lelap/site test`, `check` and `build`, and look at `/` and `/ms/`.

## Changing what is shot

- **A label changed in the app:** the run stops at “Timed out waiting for …”. Open `failed.png`,
  update the label in `shootLanguage`. Write the English text: it is the key, so there is no
  `en.json`; the Malay comes from `apps/app/src/i18n/catalogs/ms.json`.
- **A new screen:** add a step that ends in `shots.<name> = await page.screenshot()`, import the
  file in `AppScreen.astro` with an alt text through `t()` and a Malay line.
- **A new book or row:** add it in `library.mjs` with a drawn cover in `art`; keep the colours to
  the cover palette at the top, so amber stays the only accent.
- **A new language:** add its lines to `TEXT` in `library.mjs`; the app must have the catalog.

## Limits

- The app has one dark theme, so there is one set of pictures; the site shows them in the night
  frame in both of its themes.
- Expo web only. Android-only parts (downloads to an SD card, car mode, the widget, casting
  devices, skip silence) can't be shot here; they need an emulator, which this skill doesn't drive.
- Clocks keep running while the player plays, so the times differ by a second or two between runs.

## Common mistakes

| Mistake                                                        | Instead                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Taking screenshots by hand in the dev server or on a phone     | Run the script; a profile with your own library must never be in a picture. |
| `--reuse-export` after changing the app                        | Run without it, or the pictures show the old UI.                            |
| Committing after a run that printed page errors or timed out   | Fix the flow and run again; check every picture.                            |
| Real publisher covers or a real person's library for “realism” | Draw a cover in `library.mjs`.                                              |
| PNG files in `apps/site`                                       | The script writes WebP; Astro makes the smaller sizes.                      |
