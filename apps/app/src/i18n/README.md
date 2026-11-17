# Translations

Lelap's app speaks English and Bahasa Melayu. Each profile picks its own language in
Settings → Language; a new profile starts with the language of the profile that made it.

## How it works

The English text is the key. In code, write the English through `t()`:

```tsx
<Text>{t('Sleep timer')}</Text>;
t('No audio files in {name}.', { name: root.name });
```

`ms.ts` maps that English to Malay. A line that isn't there yet shows in English, so the app
never breaks while a translation catches up.

- Keep `{holes}` as they are; move them wherever the sentence needs them.
- Plurals: write both forms in code, such as `n === 1 ? t('1 book') : t('{n} books', { n })`.
- Brand and product names (Lelap, Jellyfin, Audiobookshelf, Podcast Index) stay as they are.
- When you change English text in code, change its key in `ms.ts` too.

## Checking

`pnpm --filter @lelap/app test` lists lines without a translation, and fails when `ms.ts` has a
key the app no longer uses or a translation whose `{holes}` differ from the English.

## Another language

Copy `ms.ts` to a new file named after the language code, translate it, and add it to
`LANGUAGES` and `CATALOGS` in `index.ts`, and to the `language` setting in
`packages/core/src/settings.ts`. Open a pull request; a native speaker's review is welcome on
every language.
