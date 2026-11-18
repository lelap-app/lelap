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
