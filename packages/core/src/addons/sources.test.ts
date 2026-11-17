import type { Manifest, Stream } from '@lelap/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { getSettings } from '../settings';
import type { Fetcher, FoundStream, InstalledAddon } from './client';
import {
  bookSourceChoice,
  findSources,
  getSourceChoice,
  pickSource,
  setSourceChoice,
  sourceLabel,
  sourceRequests,
  workIds,
} from './sources';
import { addStreamedBook } from './streamed';

const manifest = (name: string, extra: Partial<Manifest> = {}): Manifest => ({
  id: `org.example.${name.toLowerCase()}`,
  version: '1.0.0',
  protocol: 1,
  name,
  description: '',
  types: ['audiobook'],
  resources: ['stream'],
  catalogs: [],
  ...extra,
});

const addon = (name: string, idPrefixes: string[], resources?: Manifest['resources']) => ({
  id: name,
  url: `https://${name.toLowerCase()}.example/manifest.json`,
  builtin: false,
  manifest: manifest(name, { idPrefixes, ...(resources ? { resources } : {}) }),
});

const librivox: InstalledAddon = addon('LibriVox', ['librivox:', 'ol:']);
const server: InstalledAddon = addon('Shelf', ['ol:', 'asin:']);
const catalog: InstalledAddon = addon('Catalog', ['ol:'], ['catalog', 'meta']);

const stream = (sourceKey: string, title?: string): Stream => ({
  sourceKey,
  name: 'LibriVox',
  ...(title ? { title } : {}),
  url: `https://audio.example/${sourceKey}.mp3`,
});

/** A fake fetch: a function of the URL returning a body, a status number, or throwing. */
function fake(route: (url: string) => unknown): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(decodeURIComponent(url));
    const body = route(decodeURIComponent(url));
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  return Object.assign(fetcher, { calls });
}

describe('workIds', () => {
  it('lists the own ID first, then valid external IDs once', () => {
    expect(workIds('ol:OL1W', { ol: 'OL1W', asin: 'B00X', 'Bad Prefix': 'x' })).toEqual([
      'ol:OL1W',
      'asin:B00X',
    ]);
    expect(workIds('librivox:garden')).toEqual(['librivox:garden']);
  });
});

describe('sourceRequests', () => {
  it('asks each stream add-on once, for the first ID it takes', () => {
    const requests = sourceRequests(
      [catalog, librivox, server],
      'audiobook',
      workIds('librivox:garden', { librivox: '123', ol: 'OL1W' }),
    );
    expect(requests.map((r) => [r.addon.manifest.name, r.id])).toEqual([
      // Its own ID, not the look-alike `librivox:123`.
      ['LibriVox', 'librivox:garden'],
      ['Shelf', 'ol:OL1W'],
    ]);
  });

  it('skips add-ons that take none of the IDs', () => {
    expect(sourceRequests([server], 'audiobook', ['librivox:garden'])).toEqual([]);
  });
});

describe('findSources', () => {
  it('collects streams from every add-on and drops repeats', async () => {
    const fetcher = fake((url) => {
      if (url.startsWith('https://librivox.example/stream/audiobook/ol:OL1W'))
        return { streams: [stream('a', 'read by Kara'), stream('a'), stream('b')] };
      if (url.startsWith('https://shelf.example/stream/audiobook/ol:OL1W'))
        return { streams: [{ ...stream('a'), name: 'Shelf', title: '/Audiobooks/Garden' }] };
      return 404;
    });
    const result = await findSources(fetcher, [catalog, librivox, server], 'audiobook', 'ol:OL1W', {
      ol: 'OL1W',
    });
    expect(result.found.map(sourceLabel)).toEqual([
      'LibriVox · read by Kara',
      'LibriVox',
      'Shelf · /Audiobooks/Garden',
    ]);
    expect(result.asked).toEqual(['LibriVox', 'Shelf']);
    expect(result.failed).toEqual([]);
  });

  it('asks by external ID when the add-on does not take the own ID', async () => {
    const fetcher = fake((url) =>
      url.includes('asin:B00X') ? { streams: [stream('s')] } : { streams: [] },
    );
    const result = await findSources(fetcher, [server], 'audiobook', 'audnexus:B00X', {
      asin: 'B00X',
    });
    expect(result.found).toHaveLength(1);
    expect(fetcher.calls).toEqual(['https://shelf.example/stream/audiobook/asin:B00X.json']);
  });

  it('reports a failing add-on and keeps the others', async () => {
    const fetcher = fake((url) => (url.includes('shelf') ? 500 : { streams: [stream('a')] }));
    const result = await findSources(fetcher, [librivox, server], 'audiobook', 'ol:OL1W');
    expect(result.found).toHaveLength(1);
    expect(result.failed).toEqual(['Shelf']);
  });

  it('throws when no add-on answered', async () => {
    const fetcher = fake(() => 500);
    await expect(findSources(fetcher, [librivox], 'audiobook', 'ol:OL1W')).rejects.toThrow(
      'answered 500',
    );
  });

  it('finds nothing, without asking, when no add-on has streams for the work', async () => {
    const fetcher = fake(() => 500);
    const result = await findSources(fetcher, [catalog], 'audiobook', 'ol:OL1W');
    expect(result).toEqual({ found: [], asked: [], failed: [] });
    expect(fetcher.calls).toEqual([]);
  });
});

describe('choosing a source', () => {
  const found: FoundStream[] = [
    { addon: librivox, stream: stream('a') },
    { addon: librivox, stream: stream('b') },
    { addon: server, stream: stream('a') },
  ];

  it('picks the first choice still on offer', () => {
    expect(pickSource(found, [null, { addonUrl: server.url, sourceKey: 'a' }])).toBe(2);
    expect(
      pickSource(found, [
        { addonUrl: server.url, sourceKey: 'gone' },
        { addonUrl: librivox.url, sourceKey: 'b' },
      ]),
    ).toBe(1);
    expect(pickSource(found, [])).toBe(0);
  });

  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('remembers the choice per profile and work', () => {
    expect(getSourceChoice(db, ME, 'audiobook', 'ol:OL1W')).toBeNull();
    setSourceChoice(db, ME, 'audiobook', 'ol:OL1W', { addonUrl: librivox.url, sourceKey: 'a' }, 1);
    setSourceChoice(db, ME, 'audiobook', 'ol:OL1W', { addonUrl: server.url, sourceKey: 'a' }, 2);
    expect(getSourceChoice(db, ME, 'audiobook', 'ol:OL1W')).toEqual({
      addonUrl: server.url,
      sourceKey: 'a',
    });
    expect(getSourceChoice(db, ME, 'audiobook', 'ol:OL2W')).toBeNull();
    // Ordinary settings are unaffected.
    expect(Object.keys(getSettings(db, ME))).not.toContain('source:audiobook:ol:OL1W');
  });

  it('reads the source a library book plays', () => {
    let n = 0;
    const bookId = addStreamedBook(db, {
      addonUrl: librivox.url,
      meta: { id: 'ol:OL1W', type: 'audiobook', name: 'Garden' },
      stream: stream('b'),
      now: 1,
      newId: () => `id-${++n}`,
    });
    expect(bookSourceChoice(db, bookId)).toEqual({ addonUrl: librivox.url, sourceKey: 'b' });
    expect(bookSourceChoice(db, 'missing')).toBeNull();
  });
});
