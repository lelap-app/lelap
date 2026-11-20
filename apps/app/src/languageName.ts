import { locale } from './format';

/** A language's name in the profile's; some engines lack `Intl.DisplayNames`, so fall back to the code. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([locale()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
