import { ms } from './ms';

// Lelap's UI text in English and Bahasa Melayu. English is the source and the key: `t('Sleep
// timer')` finds the Malay line, or shows the English when there is none yet, so nothing breaks
// while a translation catches up. `{name}` holes are filled from `vars`.

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ms', name: 'Bahasa Melayu' },
] as const;
export type Language = (typeof LANGUAGES)[number]['code'];
const CATALOGS: Record<Language, Record<string, string>> = { en: {}, ms };

// Each profile picks its own language (a settings key); English until it does.
let current: Language = 'en';
const listeners = new Set<() => void>();

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const l of listeners) l();
}

/** At start-up, while the root renders: it reads the language itself, so no one is told. */
export function loadLanguage(language: Language): void {
  current = language;
}

export const currentLanguage = (): Language => current;

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const line = CATALOGS[current][text] ?? text;
  if (!vars) return line;
  return line.replace(/\{(\w+)\}/g, (hole, key: string) =>
    key in vars ? String(vars[key]) : hole,
  );
}
