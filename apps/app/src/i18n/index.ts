/// <reference types="expo/types" />
// Lelap's UI text. English is the source and the key: `t('Sleep timer')` finds the line in the
// profile's catalog, or shows the English when there is none yet, so nothing breaks while a
// translation catches up. `{name}` holes are filled from `vars`.

import { setChapterNames } from '@lelap/core';

/** A catalog file: English → translation, plus `@language`, the language's own name. */
type CatalogFile = Record<string, string>;

// Every `catalogs/<code>.json` is a language; adding the file is all a new one needs.
const files = require.context('./catalogs', false, /\.json$/);
const CATALOGS: Record<string, CatalogFile> = { en: {} };
const names: Record<string, string> = { en: 'English' };
for (const path of files.keys()) {
  const code = /([\w-]+)\.json$/.exec(path)?.[1];
  if (!code || code in CATALOGS) continue;
  const file = files<CatalogFile>(path);
  CATALOGS[code] = file;
  names[code] = file['@language'] ?? code;
}

export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  ...Object.keys(CATALOGS)
    .filter((code) => code !== 'en')
    .map((code) => ({ code, name: names[code] ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];

/** A language code; one without a catalog shows English. */
export type Language = string;

// Each profile picks its own language (a settings key); English until it does.
let current: Language = 'en';
const listeners = new Set<(language: Language) => void>();

const known = (language: Language): Language => (language in CATALOGS ? language : 'en');

export function setLanguage(language: Language): void {
  const next = known(language);
  if (next === current) return;
  current = next;
  for (const l of listeners) l(current);
}

/** At start-up, while the root renders: it reads the language itself, so no one is told. */
export function loadLanguage(language: Language): void {
  current = known(language);
}

export const currentLanguage = (): Language => current;

export function subscribeLanguage(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const line = CATALOGS[current]?.[text] || text; // An empty line is one not translated yet.
  if (!vars) return line;
  return line.replace(/\{(\w+)\}/g, (hole, key: string) =>
    key in vars ? String(vars[key]) : hole,
  );
}

// Untitled chapters are saved empty and named where they show, in the language current then.
setChapterNames({
  chapter: (n) => t('Chapter {n}', { n }),
  part: (n) => t('Part {n}', { n }),
});
