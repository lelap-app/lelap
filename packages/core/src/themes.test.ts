import { describe, expect, it } from 'vitest';

import {
  ACCENT_IDS,
  builtInTheme,
  carPalette,
  carTheme,
  contrast,
  parseThemeFile,
  resolveTheme,
  THEME_IDS,
  themeProblems,
  themeToFile,
} from './themes';

describe('themes', () => {
  it('passes every colour pair on every theme with every accent', () => {
    for (const id of THEME_IDS)
      for (const accent of ACCENT_IDS)
        expect(themeProblems(builtInTheme(id, accent)), `${id} ${accent}`).toEqual([]);
  });

  it('keeps the night theme with amber as it was', () => {
    expect(builtInTheme('night', 'amber').colors).toMatchObject({
      night: '#0d0e11',
      paper: '#f4f1ea',
      amber: '#f5b041',
      ink: '#1a1305',
    });
  });

  it('holds text to 7:1 and borders to 3:1 in high contrast', () => {
    for (const accent of ACCENT_IDS) {
      const { colors } = builtInTheme('contrast', accent);
      for (const fg of ['paper', 'soft', 'muted', 'amber'] as const)
        expect(contrast(colors[fg], colors.night)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.line, colors.night)).toBeGreaterThanOrEqual(3);
    }
  });

  it('follows the system for “system”, and falls back to night without a file', () => {
    expect(resolveTheme('system', 'teal', null, true).id).toBe('day');
    expect(resolveTheme('system', 'teal', null, false).id).toBe('night');
    expect(resolveTheme('custom', 'amber', null, false).id).toBe('night');
  });

  it('keeps car mode light by day and dark at night, whatever the theme', () => {
    const day = builtInTheme('day', 'rose');
    const dusk = builtInTheme('dusk', 'rose');
    expect(carTheme(dusk, 'rose', false)).toBe(dusk);
    expect(carTheme(dusk, 'rose', true).id).toBe('day');
    expect(carTheme(day, 'rose', true)).toBe(day);
    expect(carTheme(day, 'rose', false).id).toBe('night');
    expect(carPalette(carTheme(day, 'rose', false)).accent).toBe('#f292a6');
    const contrast = builtInTheme('contrast', 'rose');
    expect(carTheme(contrast, 'rose', true)).toBe(contrast);
  });
});

describe('theme files', () => {
  const file = (patch: Record<string, unknown> = {}, colors: Record<string, unknown> = {}) => {
    const base = themeToFile(builtInTheme('dusk', 'teal'), 'Dusk with teal');
    return JSON.stringify({ ...base, ...patch, colors: { ...base.colors, ...colors } });
  };

  it('reads back what it writes', () => {
    const read = parseThemeFile(file());
    expect(read).toEqual({
      ok: true,
      theme: { name: 'Dusk with teal', dark: true, colors: builtInTheme('dusk', 'teal').colors },
    });
  });

  it('takes colours only: no other keys, no fonts, no pictures', () => {
    expect(parseThemeFile(file({ font: 'Comic Sans' })).ok).toBe(false);
    expect(parseThemeFile(file({}, { image: 'https://example.com/a.png' })).ok).toBe(false);
    expect(parseThemeFile(file({}, { accent: 'url(https://example.com/a.png)' })).ok).toBe(false);
    expect(parseThemeFile(file({}, { accent: 'red' })).ok).toBe(false);
    expect(parseThemeFile(file({ version: 2 })).ok).toBe(false);
    expect(parseThemeFile('not json').ok).toBe(false);
    expect(parseThemeFile(' '.repeat(5000)).ok).toBe(false);
  });

  it('refuses a theme whose text would be hard to read, and says which pair', () => {
    const read = parseThemeFile(file({}, { muted: '#3c4459' }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problems[0]).toMatch(/^muted on background is/);
  });

  it('lower-cases colours, so the same theme is stored the same way', () => {
    const read = parseThemeFile(file({}, { text: '#EEF1F7' }));
    expect(read.ok && read.theme.colors.paper).toBe('#eef1f7');
  });
});
