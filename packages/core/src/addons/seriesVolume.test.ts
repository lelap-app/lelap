import type { Manifest, Meta, MetaPreview } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import type { Fetcher, InstalledAddon } from './client';
import { findSeriesVolume, rankVolumes } from './seriesVolume';

const manifest: Manifest = {
  id: 'catalog',
  version: '1.0.0',
  protocol: 1,
  name: 'Catalog',
  description: '',
  types: ['audiobook'],
  resources: ['catalog', 'meta'],
  idPrefixes: ['ol:'],
  catalogs: [
    {
      type: 'audiobook',
      id: 'search',
      name: 'Search',
      extra: [{ name: 'search', isRequired: true }],
    },
  ],
};
const addon: InstalledAddon = {
  id: '1',
  url: 'https://catalog.example/manifest.json',
  builtin: true,
  manifest,
};

const preview = (id: string, name: string, author = 'Frank Herbert'): MetaPreview => ({
  id,
  type: 'audiobook',
  name,
  author,
});

function fakeFetcher(metas: MetaPreview[], full: Record<string, Partial<Meta>>) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    asked.push(url);
    const body = url.includes('/catalog/')
      ? { metas }
      : (() => {
          const id = decodeURIComponent(
            url.split('/meta/audiobook/')[1]?.replace(/\.json$/, '') ?? '',
          );
          const found = metas.find((m) => m.id === id);
          return found ? { meta: { ...found, ...full[id] } } : {};
        })();
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetcher, asked };
}

describe('a series volume in the catalogs', () => {
  it('finds the work whose meta names the series at that number', async () => {
    const { fetcher, asked } = fakeFetcher(
      [
        preview('ol:1', 'Dune'),
        preview('ol:2', 'Dune Messiah'),
        preview('ol:3', 'Dune', 'Someone Else'),
      ],
      {
        'ol:1': { series: [{ name: 'Dune', position: '1' }] },
        'ol:2': {
          series: [{ name: 'The Dune Series', position: '2' }],
          cover: 'https://c.example/2.jpg',
        },
      },
    );
    const found = await findSeriesVolume(fetcher, [addon], {
      name: 'Dune',
      author: 'Frank Herbert',
      number: 2,
    });
    expect(found).toEqual({
      type: 'audiobook',
      id: 'ol:2',
      name: 'Dune Messiah',
      author: 'Frank Herbert',
      cover: 'https://c.example/2.jpg',
    });
    // The search names the series and its author, nothing else.
    expect(decodeURIComponent(asked[0] ?? '')).toContain('search=Dune Frank Herbert');
    // A work by someone else is never read.
    expect(asked.some((u) => u.includes('ol%3A3') || u.includes('ol:3'))).toBe(false);
  });

  it('finds nothing when no meta names that number', async () => {
    const { fetcher } = fakeFetcher([preview('ol:1', 'Dune')], {
      'ol:1': { series: [{ name: 'Dune', position: '1' }] },
    });
    expect(
      await findSeriesVolume(fetcher, [addon], { name: 'Dune', author: null, number: 4 }),
    ).toBeNull();
  });

  it('survives an add-on that fails', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 500, json: async () => ({}) });
    expect(
      await findSeriesVolume(fetcher, [addon], { name: 'Dune', author: null, number: 2 }),
    ).toBeNull();
  });

  it('searches by the listed title, and takes a meta with that title (M127)', async () => {
    const { fetcher, asked } = fakeFetcher(
      [
        preview('ol:7', 'Fasandræberne', 'Jussi Adler-Olsen'),
        preview('ol:8', 'Kvinden i buret', 'Jussi Adler-Olsen'),
      ],
      {},
    );
    const found = await findSeriesVolume(fetcher, [addon], {
      name: 'Afdeling Q',
      author: 'Jussi Adler-Olsen',
      number: 2,
      titles: ['Fasandræberne', 'The Absent One'],
    });
    expect(found?.id).toBe('ol:7');
    expect(decodeURIComponent(asked[0] ?? '')).toContain('search=Fasandræberne Jussi Adler-Olsen');
  });

  it('looks for a book without a number by its title only', async () => {
    const { fetcher, asked } = fakeFetcher([preview('ol:9', 'Elsewhere', 'Someone')], {});
    expect(
      await findSeriesVolume(fetcher, [addon], {
        name: 'Harry Potter',
        author: null,
        number: null,
        titles: ['Harry Potter and the Cursed Child'],
      }),
    ).toBeNull();
    expect(asked.filter((u) => u.includes('/catalog/'))).toHaveLength(1);
  });

  it('reads titles that carry the number first', () => {
    const ranked = rankVolumes(
      [preview('a', 'Dune'), preview('b', 'Dune Messiah (Dune, #2)'), preview('c', 'Other', 'X Y')],
      ['Frank Herbert'],
      2,
    );
    expect(ranked.map((m) => m.id)).toEqual(['b', 'a']);
  });
});
