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

  it('keeps high contrast through a file, and holds it to 7:1', () => {
    const written = themeToFile(builtInTheme('contrast', 'blue'), 'High contrast, Blue');
    expect(written.highContrast).toBe(true);
    const read = parseThemeFile(JSON.stringify(written));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const theme = resolveTheme('custom', 'amber', read.theme, false);
    expect(theme.highContrast).toBe(true);
    expect(theme.colors).toEqual(builtInTheme('contrast', 'blue').colors);
    // Dusk passes at 4.5:1 but not at 7:1, so it can't call itself high contrast.
    const faint = parseThemeFile(file({ highContrast: true }));
    expect(faint.ok).toBe(false);
    if (!faint.ok) expect(faint.problems.some((p) => p.includes('below 7:1'))).toBe(true);
    expect(themeToFile(builtInTheme('dusk', 'teal'), 'Dusk').highContrast).toBeUndefined();
    expect(parseThemeFile(file({ highContrast: 'yes' })).ok).toBe(false);
  });
});

describe('a file theme in car mode', () => {
  const custom = (dark: boolean, accent: string) => {
    const base = builtInTheme(dark ? 'dusk' : 'day', 'teal');
    return resolveTheme(
      'custom',
      'rose',
      { name: 'Mine', dark, colors: { ...base.colors, amber: accent } },
      true,
    );
  };

  it('keeps the file’s accent as it is where it reads on the swapped theme', () => {
    // A file marked light whose accent also reads on Night's black.
    const marked = { ...custom(true, '#4fc4b6'), dark: false };
    const atNight = carTheme(marked, 'rose', false);
    expect(atNight.id).toBe('night');
    expect(atNight.colors.amber).toBe('#4fc4b6');
  });

  it('keeps the file’s hue in a lightness that reads, rather than the profile’s accent', () => {
    for (const [dark, accent] of [
      [true, '#4fc4b6'],
      [true, '#ff6fd8'],
      [false, '#11665d'],
      [false, '#6440a8'],
    ] as const) {
      const swapped = carTheme(custom(dark, accent), 'rose', dark);
      expect(swapped.id).toBe(dark ? 'day' : 'night');
      expect(swapped.colors.amber).not.toBe(accent);
      expect(swapped.colors.amber).not.toBe(builtInTheme(swapped.id as 'day', 'rose').colors.amber);
      expect(themeProblems(swapped), accent).toEqual([]);
    }
  });

  it('never draws car mode with a pair below its ratio, and leaves built-in themes as they were', () => {
    for (const accent of ['#777777', '#000000', '#ffffff', '#ff0000'])
      for (const dark of [true, false])
        expect(themeProblems(carTheme(custom(dark, accent), 'rose', dark))).toEqual([]);
    const builtIn = carTheme(builtInTheme('dusk', 'rose'), 'rose', true);
    expect(builtIn).toEqual(builtInTheme('day', 'rose'));
  });
});
