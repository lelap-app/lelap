// Every text colour of both themes must pass WCAG AA on the backgrounds it is used on. Reads the
// tokens from global.css, so a new shade is checked before it reaches a page; components may not
// bring colours of their own, or they would escape this check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = new URL('../src', import.meta.url).pathname;
const css = readFileSync(join(src, 'styles/global.css'), 'utf8');
const block = (selector: RegExp) => selector.exec(css)?.[1] ?? '';
const declarations = (body: string) =>
  [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]);

type Theme = 'light' | 'dark';
const tokens: Record<Theme, Record<string, string>> = { light: {}, dark: {} };
const unreadable: string[] = [];
for (const [name, value] of declarations(block(/^:root\s*\{([^}]*)\}/m))) {
  const pair = /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/i.exec(value);
  if (pair) {
    tokens.light[name] = pair[1];
    tokens.dark[name] = pair[2];
  } else if (/^#[0-9a-f]{6}$/i.test(value)) {
    tokens.light[name] = tokens.dark[name] = value;
  } else if (value.startsWith('light-dark(') && name !== 'shadow') {
    unreadable.push(`--${name}: ${value}`);
  }
}
const fallback = Object.fromEntries(
  declarations(
    block(/@supports not \(color: light-dark[^{]*\{\s*:root,\s*:root\[data-theme\]\s*\{([^}]*)\}/),
  ),
);

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const page = ['bg', 'bg-raised', 'surface', 'surface-2', 'surface-float', 'code-bg'];
// [text, backgrounds, minimum]. Amber also draws focus rings, which need 3:1; 4.5 covers that.
const pairs: [string, string[], number][] = [
  ['fg', [...page, 'accent-tint'], 4.5],
  ['fg-soft', [...page, 'accent-tint'], 4.5],
  ['muted', [...page, 'accent-tint'], 4.5],
  ['accent', [...page, 'accent-tint'], 4.5],
  ['accent-hover', [...page, 'accent-tint'], 4.5],
  ['accent-ink', ['accent-fill', 'accent-fill-hover'], 4.5],
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith('.astro') ? [path] : [];
  });
// Lori is a drawing with fixed fur colours; the theme-color metas name each theme's --bg; the
// catalog mock-up's progress shade sits inside the night-only phone.
const allowed = [
  /^components\/Lori\.astro: /,
  /^layouts\/Base\.astro: content="#/,
  /^components\/CatalogMockup\.astro: background: rgb\(/,
];

describe('theme tokens', () => {
  it('reads every colour token', () => {
    expect(unreadable).toEqual([]);
    for (const theme of ['light', 'dark'] as const)
      for (const [text, backgrounds] of pairs)
        for (const name of [text, ...backgrounds]) expect(tokens[theme][name], name).toMatch(/^#/);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes WCAG AA in the ${theme} theme`, () => {
      const failing: string[] = [];
      for (const [text, backgrounds, min] of pairs)
        for (const bg of backgrounds) {
          const ratio = contrast(tokens[theme][text], tokens[theme][bg]);
          if (ratio < min) failing.push(`--${text} on --${bg}: ${ratio.toFixed(2)} < ${min}`);
        }
      expect(failing).toEqual([]);
    });
  }

  it('gives browsers without light-dark() the night colours', () => {
    expect(Object.keys(fallback).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(fallback))
      if (value.startsWith('#')) expect(value, `--${name}`).toBe(tokens.dark[name]);
  });

  it('keeps colours in tokens, not in components', () => {
    const literal =
      /(?:color|fill|stroke|background|border|shadow|content)[^;\n]*?(?:#[0-9a-f]{3,8}\b|rgba?\()/gi;
    const found: string[] = [];
    for (const file of files(src))
      for (const line of readFileSync(file, 'utf8').split('\n'))
        for (const m of line.matchAll(literal)) {
          const hit = `${relative(src, file)}: ${m[0].trim()}`;
          if (!allowed.some((rule) => rule.test(hit))) found.push(hit);
        }
    expect(found).toEqual([]);
  });
});
