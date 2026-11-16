import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import {
  addonBase,
  browseCatalogs,
  type Fetcher,
  fetchCatalog,
  fetchManifest,
  fetchMeta,
  fetchStreams,
  type InstalledAddon,
  normalizeManifestUrl,
  searchAll,
  searchCatalogs,
} from './client';

const manifest = (id: string, extra: Partial<Manifest> = {}): Manifest => ({
  id,
  version: '1.0.0',
  protocol: 1,
  name: id,
  description: '',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  catalogs: [],
  ...extra,
});

const librivox: InstalledAddon = {
  id: '1',
  url: 'https://a.example/librivox/manifest.json',
  builtin: true,
  manifest: manifest('librivox', {
    idPrefixes: ['librivox:', 'ol:'],
    catalogs: [
      {
        type: 'audiobook',
        id: 'new',
        name: 'New',
        extra: [{ name: 'genre', options: ['poetry'] }],
      },
      {
        type: 'audiobook',
        id: 'search',
        name: 'Search',
        extra: [{ name: 'search', isRequired: true }],
      },
      { type: 'podcast', id: 'pods', name: 'Pods' },
    ],
  }),
};

const catalog: InstalledAddon = {
  id: '2',
  url: 'https://b.example/manifest.json',
  builtin: true,
  manifest: manifest('catalog', {
    resources: ['catalog', 'meta'],
    idPrefixes: ['ol:'],
    catalogs: [
      {
        type: 'audiobook',
        id: 'ol',
        name: 'Open Library',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
    ],
  }),
};

type Route = (url: string) => unknown;

/** A fake fetch: a function of the URL returning a body, a status number, or throwing. */
function fake(route: Route): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const body = route(url);
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  return Object.assign(fetcher, { calls });
}

const preview = (id: string) => ({ id, type: 'audiobook', name: id });

describe('URLs', () => {
  it('derives the base from the manifest URL', () => {
    expect(addonBase('https://a.example/librivox/manifest.json')).toBe(
      'https://a.example/librivox/',
    );
  });

  it('normalises pasted manifest URLs', () => {
    expect(normalizeManifestUrl('a.example/librivox')).toBe(
      'https://a.example/librivox/manifest.json',
    );
    expect(normalizeManifestUrl('https://a.example/')).toBe('https://a.example/manifest.json');
    expect(normalizeManifestUrl('lelap://a.example/manifest.json')).toBe(
      'https://a.example/manifest.json',
    );
    expect(normalizeManifestUrl('http://localhost:8787/manifest.json')).toBe(
      'http://localhost:8787/manifest.json',
    );
    expect(normalizeManifestUrl('not a url')).toBeNull();
  });
});

describe('catalog selection', () => {
  it('lists browsable catalogs for the types asked', () => {
    expect(browseCatalogs([librivox, catalog], ['audiobook']).map((r) => r.catalog.id)).toEqual([
      'new',
    ]);
  });

  it('lists search catalogs', () => {
    expect(searchCatalogs([librivox, catalog], ['audiobook']).map((r) => r.catalog.id)).toEqual([
      'search',
      'ol',
    ]);
  });
});

describe('requests', () => {
  it('validates the manifest', async () => {
    await expect(
      fetchManifest(
        fake(() => ({ hello: 1 })),
        'https://x.example/manifest.json',
      ),
    ).rejects.toThrow('not a Lelap add-on');
    expect(
      await fetchManifest(
        fake(() => librivox.manifest),
        'https://x.example/manifest.json',
      ),
    ).toEqual(librivox.manifest);
  });

  it('builds catalog URLs and drops invalid items', async () => {
    const fetcher = fake(() => ({ metas: [preview('librivox:1'), { id: 'broken' }] }));
    const [ref] = browseCatalogs([librivox], ['audiobook']);
    if (!ref) throw new Error('no catalog');
    const metas = await fetchCatalog(fetcher, ref, { genre: 'poetry', skip: '30' });
    expect(metas.map((m) => m.id)).toEqual(['librivox:1']);
    expect(fetcher.calls).toEqual([
      'https://a.example/librivox/catalog/audiobook/new/genre=poetry&skip=30.json',
    ]);
  });

  it('reports a failing add-on in search without failing the rest', async () => {
    const fetcher = fake((url) =>
      url.startsWith('https://b.example') ? 500 : { metas: [preview('librivox:1')] },
    );
    const results = await searchAll(fetcher, [librivox, catalog], 'garden', ['audiobook']);
    expect(results.map((r) => [r.ref.catalog.id, r.metas.length, r.error])).toEqual([
      ['search', 1, null],
      ['ol', 0, 'The add-on answered 500'],
    ]);
  });

  it('asks only add-ons that declare the prefix for meta, first answer wins', async () => {
    const fetcher = fake((url) =>
      url.startsWith('https://b.example')
        ? { meta: { ...preview('ol:OL1W'), name: 'From catalog' } }
        : 404,
    );
    const found = await fetchMeta(fetcher, [catalog, librivox], 'audiobook', 'ol:OL1W');
    expect(found?.meta.name).toBe('From catalog');
    expect(fetcher.calls).toEqual(['https://b.example/meta/audiobook/ol%3AOL1W.json']);

    const none = await fetchMeta(fetcher, [catalog], 'audiobook', 'librivox:1');
    expect(none).toBeNull();
  });

  it('falls through to the next add-on when one fails, and throws when all do', async () => {
    const fetcher = fake((url) =>
      url.startsWith('https://b.example') ? 503 : { meta: preview('ol:OL1W') },
    );
    expect((await fetchMeta(fetcher, [catalog, librivox], 'audiobook', 'ol:OL1W'))?.addon.id).toBe(
      '1',
    );
    await expect(
      fetchMeta(
        fake(() => 503),
        [catalog],
        'audiobook',
        'ol:OL1W',
      ),
    ).rejects.toThrow('503');
  });

  it('merges streams from every add-on that has them', async () => {
    const stream = (key: string) => ({
      sourceKey: key,
      name: key,
      url: 'https://audio.example/a.mp3',
    });
    const fetcher = fake(() => ({ streams: [stream('a'), { sourceKey: 'bad' }, stream('b')] }));
    const found = await fetchStreams(fetcher, [catalog, librivox], 'audiobook', 'ol:OL1W');
    expect(found.map((f) => f.stream.sourceKey)).toEqual(['a', 'b']);
    // The catalog add-on has no stream resource.
    expect(fetcher.calls).toEqual(['https://a.example/librivox/stream/audiobook/ol%3AOL1W.json']);
  });

  it('turns network errors into a readable message', async () => {
    const fetcher: Fetcher = async () => {
      throw new TypeError('Network request failed');
    };
    await expect(fetchManifest(fetcher, 'https://x.example/manifest.json')).rejects.toThrow(
      'could not be reached',
    );
  });
});
