import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inline, parseChangelog } from '../src/lib/changelog';

describe('inline', () => {
  it('finds code and pull request numbers', () => {
    expect(inline('Run `pnpm build` again. (#169, #170)')).toEqual([
      { kind: 'text', value: 'Run ' },
      { kind: 'code', value: 'pnpm build' },
      { kind: 'text', value: ' again. (' },
      { kind: 'pr', number: 169 },
      { kind: 'text', value: ', ' },
      { kind: 'pr', number: 170 },
      { kind: 'text', value: ')' },
    ]);
  });

  it('leaves a lone backtick and a number sign inside code alone', () => {
    expect(inline('a `#1` b ` c')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'code', value: '#1' },
      { kind: 'text', value: ' b ` c' },
    ]);
  });
});

describe('parseChangelog', () => {
  const sample = `# Changelog

What changed.

## 1.2.0 (2026-11-18)

Needs the new APK.

### New

- One thing
  that wraps.
- Another. (#7)

### Fixed

A paragraph.

- A fix.

## 1.1.0
`;

  it('reads releases, groups, paragraphs and wrapped list items', () => {
    const [first, second] = parseChangelog(sample);
    expect(first).toMatchObject({ id: 'v1-2-0', version: '1.2.0', date: '2026-11-18' });
    expect(first?.intro).toEqual([
      { kind: 'p', text: [{ kind: 'text', value: 'Needs the new APK.' }] },
    ]);
    expect(first?.groups.map((g) => g.title)).toEqual(['New', 'Fixed']);
    expect(first?.groups[0]?.blocks).toEqual([
      {
        kind: 'ul',
        items: [
          [{ kind: 'text', value: 'One thing that wraps.' }],
          [
            { kind: 'text', value: 'Another. (' },
            { kind: 'pr', number: 7 },
            { kind: 'text', value: ')' },
          ],
        ],
      },
    ]);
    expect(first?.groups[1]?.blocks.map((b) => b.kind)).toEqual(['p', 'ul']);
    expect(second).toMatchObject({ version: '1.1.0', date: null, groups: [] });
  });

  it('reads the real changelog', () => {
    const releases = parseChangelog(
      readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8'),
    );
    expect(releases.length).toBeGreaterThan(0);
    for (const release of releases) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(release.groups.length + release.intro.length).toBeGreaterThan(0);
    }
    expect(new Set(releases.map((r) => r.id)).size).toBe(releases.length);
  });

  it('meets no Markdown the page would show raw', () => {
    const markdown = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const texts = parseChangelog(markdown)
      .flatMap((r) => [...r.intro, ...r.groups.flatMap((g) => g.blocks)])
      .flatMap((b) => (b.kind === 'p' ? [b.text] : b.items))
      .flat()
      .flatMap((part) => (part.kind === 'text' ? [part.value] : []));
    // Links, bold and nested lists are not read by src/lib/changelog.ts; teach it first.
    expect(texts.filter((text) => /\]\(|\*\*/.test(text))).toEqual([]);
    expect(markdown.split('\n').filter((line) => /^\s+[-*] /.test(line))).toEqual([]);
  });
});
