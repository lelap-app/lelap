// Dates and numbers in the profile's language rather than the phone's (M72), through `Intl`.

/**
 * The BCP 47 tag to format with for a profile in [language]. A phone set to the same language
 * keeps its own region (English on an en-GB phone writes 18/11/2026); otherwise the language
 * alone, as its catalog file is named.
 */
export function localeTag(language: string, device: string | null | undefined): string {
  if (!language.includes('-') && device?.toLowerCase().startsWith(`${language.toLowerCase()}-`))
    return device;
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
