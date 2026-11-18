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
});
