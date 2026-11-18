import { ms } from './ms';

// The home page in English and Bahasa Melayu, keyed by the English text as in the app:
// `t(lang, 'Sleep timer')` finds the Malay line. `{name}` holes are filled from `vars`.
// Docs, privacy, terms and the 404 page stay English only.

export const languages = {
  en: { name: 'English', short: 'EN', home: '/', locale: 'en_GB' },
  ms: { name: 'Bahasa Melayu', short: 'BM', home: '/ms/', locale: 'ms_MY' },
} as const;
export type Lang = keyof typeof languages;

const catalogs: Record<Lang, Record<string, string>> = { en: {}, ms };

export function t(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const line = catalogs[lang][text] ?? text;
  if (!vars) return line;
  return line.replace(/\{(\w+)\}/g, (hole, key: string) =>
    key in vars ? String(vars[key]) : hole,
  );
}

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** t() for lines that go into set:html: the line keeps its own tags, the holes are escaped. */
export function html(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const escaped =
    vars &&
    Object.fromEntries(
      Object.entries(vars).map(([key, value]) => [
        key,
        String(value).replace(/[&<>"']/g, (c) => entities[c] ?? c),
      ]),
    );
  return t(lang, text, escaped);
}
