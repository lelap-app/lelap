import { describe, expect, it } from 'vitest';

import { dateText, localeTag, numberText, timeText, weekdayText } from './locale';

const evening = new Date(2026, 10, 18, 21, 5, 12);

describe('locale', () => {
  it('keeps the phone’s region only for the same language', () => {
    expect(localeTag('en', 'en-GB')).toBe('en-GB');
    expect(localeTag('ms', 'en-GB')).toBe('ms');
    expect(localeTag('ms', 'ms-MY')).toBe('ms-MY');
    expect(localeTag('en', undefined)).toBe('en');
    // A catalog with its own region wins over the phone's.
    expect(localeTag('pt-BR', 'pt-PT')).toBe('pt-BR');
    // `en` is not a prefix of `enx`.
    expect(localeTag('en', 'enx-US')).toBe('en');
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

  it('writes numbers with the language’s separators', () => {
    expect(numberText(1234.56, 'en', 1)).toBe('1,234.6');
    expect(numberText(1234.56, 'ms', 1)).toBe('1,234.6');
    expect(numberText(1234.56, 'de', 1)).toBe('1.234,6');
    expect(numberText(2.5, 'en')).toBe('3');
    expect(numberText(2, 'en', 1)).toBe('2.0');
  });
});
