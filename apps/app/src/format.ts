import { dateText, localeTag, numberText, timeText, weekdayText } from '@lelap/core';

import { currentLanguage, t } from './i18n';

const device = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
})();

/** The tag dates and numbers are written in: the profile's language, not the phone's. */
export const locale = (): string => localeTag(currentLanguage(), device);

/** `1:02:03` or `2:03`. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** `3 h 12 min left`, `12 min left`. */
export function formatLeft(ms: number): string {
  return t('{time} left', { time: formatDuration(ms) });
}

/** `9 h 8 min`, `42 min`. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('{n} min', { n: m });
  return m === 0 ? t('{n} h', { n: h }) : t('{h} h {m} min', { h, m });
}

/** `245 MB`, `1.2 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${numberText(Math.max(0, Math.round(bytes / 1e3)), locale())} kB`;
  if (bytes < 1e9) return `${numberText(Math.round(bytes / 1e6), locale())} MB`;
  return `${numberText(bytes / 1e9, locale(), bytes < 1e10 ? 1 : 0)} GB`;
}

/** `22:30` for minutes after midnight. */
export function formatTimeOfDay(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The name of an untitled chapter, `Chapter 3`, saved in the profile's language. */
export const chapterName = (n: number): string => t('Chapter {n}', { n });

/** A day, such as an episode's release, as the profile's language writes it. */
export const formatDate = (ms: number): string => dateText(ms, locale());

/** A time of day with seconds, as the profile's language writes it. */
export const formatTime = (ms: number): string => timeText(ms, locale());

/** `Wed`, or `Rab` in Malay. */
export const formatWeekday = (date: Date): string => weekdayText(date, locale());
