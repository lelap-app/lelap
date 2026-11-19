# Translations

Lelap's app speaks English and Bahasa Melayu. Each profile picks its own language in
Settings → Look and language; a new profile starts with the language of the profile that made it. The same
lines name the notifications, the home screen widget, the Quick Settings tile and Android Auto's
shelves.

## For translators

You need a GitHub account and a browser; nothing to install. Each language is one file in
[`catalogs/`](catalogs/), named after its language code (`ms.json`, `pt-BR.json`). In it, the
English on the left is the key, your translation on the right:

```json
{
  "@language": "Bahasa Melayu",
  "Sleep timer": "Pemasa tidur",
  "No audio files in {name}.": "Tiada fail audio dalam {name}."
}
```

**Fix a line.** Open the language's file on GitHub and press the pencil (“Edit this file”).
GitHub makes your own copy. Use the browser's find to reach the line, change the right-hand side,
then “Commit changes…” and “Propose changes”, and open the pull request.

**Add a language.** Open [`template.json`](template.json): it has every line the app uses, with
empty translations. Press “Raw”, copy everything, then in `catalogs/` choose “Add file” → “Create
new file”, name it after your language code (`de.json`) and paste. Fill in `@language` with the
language's name in that language (“Deutsch”), then translate as many lines as you like and propose
the file as above. A line left as `""` shows in English, so a half-done file is fine; it can grow
in later pull requests. Nothing else needs to change: the app finds the file by itself.

**Rather not use GitHub's editor?** Open a [translation issue](https://github.com/lelap-app/lelap/issues/new?template=translation.yml)
and list the lines there, or attach your copy of `template.json`.

The rules:

- Keep `{holes}` such as `{name}` or `{n}` exactly as they are; move them wherever the sentence
  needs them.
- Plurals come in pairs, such as `"1 book"` and `"{n} books"`: translate both, or neither.
- Brand and product names (Lelap, Jellyfin, Audiobookshelf, Podcast Index) stay as they are.
- Keep the quotes and the comma at the end of each line; the check below says where one is
  missing.

After you open the pull request, a check reads your file and points at any line with a problem:
holes that differ from the English, a plural with one form, a line the app no longer uses, or a
missing comma. A native speaker's review is welcome on every language, as a pull request or in a
translation issue.

## For developers

The English text is the key. In code, write the English through `t()`:

```tsx
<Text>{t('Sleep timer')}</Text>;
t('No audio files in {name}.', { name: root.name });
```

- Plurals: write both forms in code, such as `n === 1 ? t('1 book') : t('{n} books', { n })`.
- When you change English text in code, change its key in every catalog too, or the check fails.
- Native Android text (Kotlin) looks lines up by the same English through `NativeText` in
  `modules/text`. List each such line in `src/nativeText.ts`; the app hands them over whenever the
  language changes, and native code keeps the last set for when the app is closed.
- Dates and numbers: use `formatDate`, `formatTime`, `formatWeekday` and `formatBytes` from
  `src/format.ts`, which write them in the profile's language through `Intl`, never a bare
  `toLocaleDateString()`, which follows the phone.

`pnpm --filter @lelap/app test` checks every catalog against the code, Kotlin included, and
refreshes `template.json` (in CI it fails when the template is out of date). Add `--missing` to
the script to list the lines a catalog doesn't translate yet:

```sh
node apps/app/scripts/check-translations.mjs --missing
```
