import { describe, expect, it } from 'vitest';

import {
  dateText,
  dayMonthText,
  firstDayFromTable,
  firstDayOfWeek,
  localeTag,
  longDateText,
  monthText,
  numberText,
  spokenDayText,
  timeText,
  weekdayText,
} from './locale';

const evening = new Date(2026, 10, 18, 21, 5, 12);

describe('locale', () => {
  it('pairs the profile’s language with the phone’s region', () => {
    expect(localeTag('en', 'da-DK')).toBe('en-DK');
    expect(localeTag('ms', 'da-DK')).toBe('ms-DK');
    expect(localeTag('en', 'en-GB')).toBe('en-GB');
    expect(localeTag('ms', 'ms-MY')).toBe('ms-MY');
    expect(localeTag('en', 'zh-Hant-TW')).toBe('en-TW');
    expect(localeTag('en', 'es-419')).toBe('en-419');
    // No region on the phone: the language alone.
    expect(localeTag('en', 'da')).toBe('en');
    expect(localeTag('en', 'da-u-ca-gregory')).toBe('en');
    expect(localeTag('en', undefined)).toBe('en');
    // A catalog with its own region wins over the phone's.
    expect(localeTag('pt-BR', 'pt-PT')).toBe('pt-BR');
  });

  it('keeps the region’s date order', () => {
    const day = evening.getTime();
    // An English profile on a Danish phone: day first, never the US order.
    expect(dateText(day, localeTag('en', 'da-DK'))).toBe('18/11/2026');
    expect(dateText(day, localeTag('ms', 'ms-MY'))).toBe('18/11/2026');
    expect(weekdayText(evening, localeTag('ms', 'da-DK'))).toBe('Rab');
  });

  it('writes dates and times in English and Malay', () => {
    expect(dateText(evening.getTime(), 'en')).toBe('11/18/2026');
    expect(dateText(evening.getTime(), 'en-GB')).toBe('18/11/2026');
    expect(dateText(evening.getTime(), 'ms')).toBe('18/11/2026');
    expect(timeText(evening.getTime(), 'en')).toBe('9:05:12 PM');
    expect(timeText(evening.getTime(), 'ms')).toBe('9:05:12 PTG');
  });

  it('names weekdays in English and Malay', () => {
    expect(weekdayText(evening, 'en')).toBe('Wed');
    expect(weekdayText(evening, 'ms')).toBe('Rab');
  });

  it('writes days and months in English and Malay', () => {
    expect(dayMonthText(evening, 'en-GB')).toBe('18 Nov');
    expect(dayMonthText(evening, 'en-US')).toBe('Nov 18');
    expect(dayMonthText(evening, 'ms')).toBe('18 Nov');
    expect(longDateText(evening, 'en-GB')).toBe('18 November 2026');
    expect(spokenDayText(evening, 'en-GB')).toBe('Wednesday 18 November');
    expect(spokenDayText(evening, 'ms')).toBe('Rabu, 18 November');
    expect(monthText(0, 'en')).toBe('Jan');
    expect(monthText(7, 'ms', 'long')).toBe('Ogos');
  });

  it('starts the week on the region’s first day', () => {
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('ms-MY')).toBe(1);
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('ms-EG')).toBe(6);
    // Without `Intl.Locale` week info, as on Hermes, the table agrees.
    for (const tag of ['en-GB', 'ms-MY', 'en-US', 'ms-EG', 'en-DK', 'en-JP', 'en-AE', 'en-BR']) {
      expect(firstDayFromTable(tag)).toBe(firstDayOfWeek(tag));
    }
    expect(firstDayFromTable('en')).toBe(1);
    expect(firstDayFromTable('en-u-ca-gregory')).toBe(1);
  });

  it('writes numbers with the language’s separators', () => {
    expect(numberText(1234.56, 'en', 1)).toBe('1,234.6');
    expect(numberText(1234.56, 'ms', 1)).toBe('1,234.6');
    expect(numberText(1234.56, 'de', 1)).toBe('1.234,6');
    expect(numberText(2.5, 'en')).toBe('3');
    expect(numberText(2, 'en', 1)).toBe('2.0');
  });
});
