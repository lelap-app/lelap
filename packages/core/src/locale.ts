// Dates and numbers in the profile's language rather than the phone's (M72), through `Intl`.

/**
 * The BCP 47 tag to format with for a profile in [language]: the language with the phone's
 * region, whatever the phone's language (`en-DK` on a Danish phone), so dates keep the region's
 * order while month and weekday names follow the profile. A language with its own region keeps
 * it; without a region on the phone, the language alone.
 */
export function localeTag(language: string, device: string | null | undefined): string {
  if (language.includes('-')) return language;
  for (const part of device?.split(/[-_]/).slice(1) ?? []) {
    // A one-letter subtag starts extensions such as `-u-ca-…`, which hold no region.
    if (part.length === 1) break;
    if (/^([A-Za-z]{2}|\d{3})$/.test(part)) return `${language}-${part.toUpperCase()}`;
  }
  return language;
}

/** `18/11/2026` or `11/18/2026`, as the language writes a date. */
export const dateText = (ms: number, tag: string): string => new Date(ms).toLocaleDateString(tag);

/** `9:05:12 PM`, `21:05:12` or `9:05:12 PTG`. */
export const timeText = (ms: number, tag: string): string => new Date(ms).toLocaleTimeString(tag);

/** The short weekday name: `Wed` in English, `Rab` in Malay. */
export const weekdayText = (date: Date, tag: string): string =>
  new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(date);

/** A number with [fractionDigits] decimals and the language's separators. */
export const numberText = (n: number, tag: string, fractionDigits = 0): string =>
  new Intl.NumberFormat(tag, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);

// Short months in three letters: British English writes September as “Sept” (M149). Only
// English and Malay, whose short months are otherwise three letters; French keeps “juin”.
const threeLetters = (month: string, tag: string): string =>
  /^(en|ms)\b/.test(tag) && /^\p{Script=Latin}{4,}$/u.test(month) ? month.slice(0, 3) : month;

/** `9 Nov` or `Nov 9`, as the language writes a day of a month. */
export const dayMonthText = (date: Date, tag: string): string =>
  new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' })
    .formatToParts(date)
    .map((part) => (part.type === 'month' ? threeLetters(part.value, tag) : part.value))
    .join('');

/** `9 November 2026`, for screen readers and the year overview. */
export const longDateText = (date: Date, tag: string): string =>
  new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);

/** `Wednesday 18 November`, a day as a screen reader should say it. */
export const spokenDayText = (date: Date, tag: string): string =>
  new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);

/** A month's name, `Nov` or `November`, for a month from 0 (January). */
export function monthText(month: number, tag: string, width: 'short' | 'long' = 'short'): string {
  const name = new Intl.DateTimeFormat(tag, { month: width }).format(new Date(2026, month, 1));
  return width === 'short' ? threeLetters(name, tag) : name;
}

// Where the week starts, from CLDR, for engines without `Intl.Locale` week info (Hermes on
// Android). Every region not listed starts on Monday.
const SUNDAY_REGIONS = new Set(
  (
    'AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX ' +
    'MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'
  ).split(' '),
);
const SATURDAY_REGIONS = new Set('AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '));

type WeekInfo = { firstDay?: number };

/** The first day of the week in [tag]'s region: 0 Sunday, 1 Monday … 6 Saturday. */
export function firstDayOfWeek(tag: string): number {
  // Without a region `Intl` guesses one (`en` → the US); the table's Monday is the same everywhere.
  if (!/^[A-Za-z]{2,3}(-[A-Za-z]{4})?[-_]([A-Za-z]{2}|\d{3})\b/.test(tag)) {
    return firstDayFromTable(tag);
  }
  try {
    const locale = new Intl.Locale(tag) as Intl.Locale & {
      getWeekInfo?: () => WeekInfo;
      weekInfo?: WeekInfo;
    };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    // `Intl` counts 1 Monday … 7 Sunday.
    if (typeof first === 'number') return first % 7;
  } catch {
    // No `Intl.Locale`: the table below.
  }
  return firstDayFromTable(tag);
}

/** [firstDayOfWeek] from the region table alone. */
export function firstDayFromTable(tag: string): number {
  const parts = tag.split(/[-_]/).slice(1);
  const extension = parts.findIndex((part) => part.length === 1);
  const region = (extension < 0 ? parts : parts.slice(0, extension))
    .find((part) => /^[A-Za-z]{2}$/.test(part))
    ?.toUpperCase();
  if (region && SUNDAY_REGIONS.has(region)) return 0;
  if (region && SATURDAY_REGIONS.has(region)) return 6;
  return 1;
}
