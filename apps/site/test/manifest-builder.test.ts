import { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import {
  adviseManifest,
  buildManifest,
  checkManifest,
  type Draft,
  splitList,
  starterCode,
} from '../src/lib/manifest-builder';

const draft: Draft = {
  id: 'org.example.readings',
  version: '1.0.0',
  name: 'Example Readings',
  description: 'Public-domain books read by volunteers.',
  logo: '',
  configurable: false,
  types: ['audiobook'],
  resources: [
    { name: 'catalog', types: [], idPrefixes: [] },
    { name: 'meta', types: [], idPrefixes: [] },
    { name: 'stream', types: [], idPrefixes: ['example:', 'ol:'] },
  ],
  idPrefixes: ['example:'],
  catalogs: [
    {
      type: 'audiobook',
      id: 'new',
      name: 'New releases',
      extras: [
        { name: 'genre', isRequired: false, options: ['poetry', 'mystery'] },
        { name: 'skip', isRequired: false, options: [] },
      ],
    },
    {
      type: 'audiobook',
      id: 'search',
      name: 'Search',
      extras: [{ name: 'search', isRequired: true, options: [] }],
    },
  ],
};

// Manifests the checker must judge exactly as the SDK's zod schema does.
const cases: [string, unknown][] = [
  ['valid', buildManifest(draft)],
  ['valid with logo', { ...buildManifest(draft), logo: 'https://example.com/logo.png' }],
  ['valid, configurable', { ...buildManifest(draft), configurable: true }],
  ['valid, no catalogs', { ...buildManifest(draft), catalogs: [] }],
  ['valid, empty description', { ...buildManifest(draft), description: '' }],
  ['valid, prerelease version', { ...buildManifest(draft), version: '1.2.3-beta.1' }],
  ['short id', { ...buildManifest(draft), id: 'ab' }],
  ['no version', { ...buildManifest(draft), version: '' }],
  ['loose version', { ...buildManifest(draft), version: '1.0' }],
  ['other protocol', { ...buildManifest(draft), protocol: 2 }],
  ['empty name', { ...buildManifest(draft), name: '' }],
  ['missing description', { ...buildManifest(draft), description: undefined }],
  ['ftp logo', { ...buildManifest(draft), logo: 'ftp://example.com/logo.png' }],
  ['relative logo', { ...buildManifest(draft), logo: '/logo.png' }],
  ['no types', { ...buildManifest(draft), types: [] }],
  ['unknown type', { ...buildManifest(draft), types: ['movie'] }],
  ['no resources', { ...buildManifest(draft), resources: [] }],
  ['unknown resource', { ...buildManifest(draft), resources: ['subtitles'] }],
  [
    'resource object',
    { ...buildManifest(draft), resources: [{ name: 'meta', types: ['podcast'] }] },
  ],
  ['bad resource types', { ...buildManifest(draft), resources: [{ name: 'meta', types: ['x'] }] }],
  [
    'empty resource prefix',
    { ...buildManifest(draft), resources: [{ name: 'meta', idPrefixes: [''] }] },
  ],
  ['empty prefix', { ...buildManifest(draft), idPrefixes: [''] }],
  ['no catalogs list', { ...buildManifest(draft), catalogs: undefined }],
  [
    'catalog without id',
    { ...buildManifest(draft), catalogs: [{ type: 'audiobook', id: '', name: 'A' }] },
  ],
  [
    'catalog without name',
    { ...buildManifest(draft), catalogs: [{ type: 'audiobook', id: 'a', name: '' }] },
  ],
  [
    'catalog of unknown type',
    { ...buildManifest(draft), catalogs: [{ type: 'x', id: 'a', name: 'A' }] },
  ],
  [
    'extra without name',
    {
      ...buildManifest(draft),
      catalogs: [{ type: 'audiobook', id: 'a', name: 'A', extra: [{ name: '' }] }],
    },
  ],
  [
    'extra options not strings',
    {
      ...buildManifest(draft),
      catalogs: [
        { type: 'audiobook', id: 'a', name: 'A', extra: [{ name: 'genre', options: [1] }] },
      ],
    },
  ],
  ['configurable not boolean', { ...buildManifest(draft), configurable: 'yes' }],
  ['not an object', ['a']],
];

describe('checkManifest', () => {
  it.each(cases)('agrees with the SDK schema: %s', (_, manifest) => {
    expect(checkManifest(manifest).length === 0).toBe(Manifest.safeParse(manifest).success);
  });
});

describe('buildManifest', () => {
  it('writes resources as names unless they narrow types or prefixes', () => {
    const manifest = buildManifest(draft);
    expect(manifest.resources).toEqual([
      'catalog',
      'meta',
      { name: 'stream', idPrefixes: ['example:', 'ol:'] },
    ]);
    expect(manifest).not.toHaveProperty('logo');
    expect(manifest).not.toHaveProperty('configurable');
    expect(Manifest.parse(manifest)).toEqual(manifest);
  });

  it('splits lists on commas, spaces and lines', () => {
    expect(splitList(' example:, ol:\nlibrivox: ')).toEqual(['example:', 'ol:', 'librivox:']);
  });
});

describe('adviseManifest', () => {
  it('is quiet about a sound manifest', () => {
    expect(adviseManifest(buildManifest(draft))).toEqual([]);
  });

  it('warns about prefixes, catalogs the app would never ask for and podcasts without episodes', () => {
    const messages = adviseManifest(
      buildManifest({
        ...draft,
        id: 'my addon',
        types: ['podcast'],
        idPrefixes: ['Example'],
        resources: [
          { name: 'catalog', types: [], idPrefixes: [] },
          { name: 'stream', types: [], idPrefixes: [] },
        ],
      }),
    ).map((issue) => issue.message);
    expect(messages.join('\n')).toMatch(/reverse DNS/);
    expect(messages.join('\n')).toMatch(/“Example” should look like/);
    expect(messages.join('\n')).toMatch(/streamed with the type episode/);
    expect(messages.join('\n')).toMatch(/isn’t among the catalog resource’s types/);
  });

  it('warns about duplicate catalogs and genres without options', () => {
    const catalog = draft.catalogs[1];
    if (!catalog) throw new Error('fixture');
    const messages = adviseManifest(
      buildManifest({
        ...draft,
        catalogs: [
          catalog,
          catalog,
          { ...catalog, id: 'g', extras: [{ name: 'genre', isRequired: false, options: [] }] },
        ],
      }),
    ).map((issue) => issue.message);
    expect(messages).toContain('Two audiobook catalogs share the ID “search”.');
    expect(messages).toContain('A genre extra needs options for the app to show as filters.');
  });
});

describe('starterCode', () => {
  it('embeds the manifest and stubs only the declared handlers', () => {
    const code = starterCode(buildManifest({ ...draft, resources: draft.resources.slice(0, 1) }));
    expect(code).toContain('"id": "org.example.readings"');
    expect(code).toContain('catalog: async');
    expect(code).not.toContain('meta: async');
  });
});
