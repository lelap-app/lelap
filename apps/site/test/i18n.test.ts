// The Malay home page must have a line for every English text it shows, and no leftovers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { html } from '../src/i18n';
import { ms } from '../src/i18n/ms';
import { site } from '../src/site';

const src = new URL('../src', import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : files(path);
    return /\.(astro|ts)$/.test(name) ? [path] : [];
  });

// t(lang, '…') and t(lang, "…"), also when the formatter put the text on its own line; html(lang, …) the same.
const literal = /\b(?:t|html)\(\s*lang\s*,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const anyCall = /\b(?:t|html)\(\s*lang\s*,\s*([^\s,)]+)/g;
// Texts that live in site.ts and reach t() through a variable.
const fromSite: Record<string, string> = {
  'site.tagline': site.tagline,
  'site.descriptor': site.descriptor,
};

const used = new Set<string>();
const unknown: string[] = [];
for (const file of files(src)) {
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(literal)) used.add(m[1].slice(1, -1).replace(/\\(.)/g, '$1'));
  for (const m of code.matchAll(anyCall)) {
    const arg = m[1];
    if (arg.startsWith("'") || arg.startsWith('"')) continue;
    if (arg in fromSite) used.add(fromSite[arg]);
    else unknown.push(`${file}: t(lang, ${arg})`);
  }
}

const holes = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

describe('Malay catalog', () => {
  it('finds the texts', () => {
    expect(used.size).toBeGreaterThan(100);
    // A t() call on anything but a literal can't be checked; add it to fromSite above.
    expect(unknown).toEqual([]);
  });

  it('has a line for every English text', () => {
    expect([...used].filter((key) => !(key in ms)).sort()).toEqual([]);
  });

  it('has no lines the site no longer uses', () => {
    expect(Object.keys(ms).filter((key) => !used.has(key))).toEqual([]);
  });

  it('keeps the {holes} of the English', () => {
    const differ = Object.entries(ms).filter(([key, line]) => holes(key) !== holes(line));
    expect(differ.map(([key]) => key)).toEqual([]);
  });

  it('keeps the inline tags of the English', () => {
    const tags = (s: string) => [...s.matchAll(/<\/?(\w+)/g)].map((m) => m[1]).join(',');
    const differ = Object.entries(ms).filter(([key, line]) => tags(key) !== tags(line));
    expect(differ.map(([key]) => key)).toEqual([]);
  });
});

describe('html()', () => {
  it('keeps the line’s tags and escapes what fills the holes', () => {
    const out = html('en', '<b>Get</b> <a href="{info}">it</a>', { info: 'x"><script>&' });
    expect(out).toBe('<b>Get</b> <a href="x&quot;&gt;&lt;script&gt;&amp;">it</a>');
  });
});
