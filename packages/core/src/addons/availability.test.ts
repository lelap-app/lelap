import type { Manifest } from '@lelap/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { books, downloads } from '../schema';
import { getSettings } from '../settings';
import {
  type Availability,
  checkWanted,
  listWanted,
  localLookup,
  rememberWanted,
  SourceCache,
  streamAvailability,
  type WorkRef,
} from './availability';
import type { Fetcher, InstalledAddon } from './client';
import { addStreamedBook } from './streamed';

const addon = (name: string): InstalledAddon => {
  const manifest: Manifest = {
    id: `org.example.${name.toLowerCase()}`,
    version: '1.0.0',
    protocol: 1,
    name,
    description: '',
    types: ['audiobook'],
    resources: ['stream'],
    catalogs: [],
    idPrefixes: ['ol:'],
  };
  return {
    id: name,
    url: `https://${name.toLowerCase()}.example/manifest.json`,
    builtin: false,
    manifest,
  };
};

function fake(route: (url: string) => unknown): Fetcher {
  return async (url: string) => {
    const body = route(decodeURIComponent(url));
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

const work = (id: string, name = id, author?: string): WorkRef => ({
  type: 'audiobook',
  id,
  name,
  ...(author ? { author } : {}),
});

describe('localLookup', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('finds finished downloads and books from library folders', () => {
    const bookId = addStreamedBook(db, {
      addonUrl: 'https://librivox.example/manifest.json',
      meta: { type: 'audiobook', id: 'ol:OL1W', name: 'Walden' },
      stream: { sourceKey: 'w', name: 'LibriVox', url: 'https://audio.example/w.mp3' },
      now: 1,
      newId: () => 'b1',
    });
    db.insert(downloads)
      .values({ bookId, state: 'done', bytesTotal: 1, requestedAt: 1, updatedAt: 1 })
      .run();
    db.insert(books)
      .values({
        id: 'b2',
        location: 'primary:Audiobooks/Dune',
        kind: 'folder',
        source: 'local',
        title: 'Dune (Dune, #1)',
        author: 'Frank Herbert',
        durationMs: 1,
        addedAt: 1,
        updatedAt: 1,
      })
      .run();
    const isLocal = localLookup(db, ME);
    expect(isLocal(work('ol:OL1W', 'Walden'))).toBe(true);
    expect(isLocal(work('ol:OL2W', 'Dune', 'Herbert, Frank'))).toBe(true);
    expect(isLocal(work('ol:OL3W', 'Emma'))).toBe(false);
  });

  it('does not count a streamed book that is not downloaded', () => {
    addStreamedBook(db, {
      addonUrl: 'https://librivox.example/manifest.json',
      meta: { type: 'audiobook', id: 'ol:OL1W', name: 'Walden' },
      stream: { sourceKey: 'w', name: 'LibriVox', url: 'https://audio.example/w.mp3' },
      now: 1,
      newId: () => 'b1',
    });
    expect(localLookup(db, ME)(work('ol:OL1W', 'Walden'))).toBe(false);
  });
});

describe('streamAvailability', () => {
  const librivox = addon('LibriVox');
  const shelf = addon('Shelf');

  it('names the first add-on with a stream', async () => {
    const fetcher = fake((url) =>
      url.includes('shelf')
        ? { streams: [{ sourceKey: 's', name: 'Shelf', url: 'https://audio.example/s.mp3' }] }
        : { streams: [] },
    );
    expect(await streamAvailability(fetcher, [librivox, shelf], 'audiobook', 'ol:OL1W')).toEqual({
      kind: 'stream',
      addon: 'Shelf',
    });
  });

  it('says none only when every add-on answered', async () => {
    const empty = fake(() => ({ streams: [] }));
    expect(await streamAvailability(empty, [librivox, shelf], 'audiobook', 'ol:OL1W')).toEqual({
      kind: 'none',
    });
    const half = fake((url) => (url.includes('shelf') ? 500 : { streams: [] }));
    expect(await streamAvailability(half, [librivox, shelf], 'audiobook', 'ol:OL1W')).toBeNull();
    const down = fake(() => 500);
    expect(await streamAvailability(down, [librivox], 'audiobook', 'ol:OL1W')).toBeNull();
  });

  it('asks again by the external IDs from the meta', async () => {
    const tracker: InstalledAddon = {
      ...addon('Tracker'),
      manifest: { ...addon('Tracker').manifest, resources: ['meta'], idPrefixes: ['hardcover:'] },
    };
    const fetcher = fake((url) => {
      if (url.includes('tracker.example/meta/audiobook/hardcover:1'))
        return {
          meta: { type: 'audiobook', id: 'hardcover:1', name: 'Emma', externalIds: { ol: 'OL1W' } },
        };
      if (url.includes('librivox.example/stream/audiobook/ol:OL1W'))
        return {
          streams: [{ sourceKey: 'e', name: 'LibriVox', url: 'https://audio.example/e.mp3' }],
        };
      return 404;
    });
    expect(
      await streamAvailability(fetcher, [tracker, librivox], 'audiobook', 'hardcover:1'),
    ).toEqual({
      kind: 'stream',
      addon: 'LibriVox',
    });
  });

  it('says none when no add-on can stream the ID at all', async () => {
    expect(
      await streamAvailability(
        fake(() => 500),
        [],
        'audiobook',
        'ol:OL1W',
      ),
    ).toEqual({
      kind: 'none',
    });
  });
});

describe('SourceCache', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('asks the newest items first, a few at a time, and caches answers', async () => {
    const asked: string[] = [];
    const gates: (() => void)[] = [];
    const cache = new SourceCache(
      (w) =>
        new Promise<Availability>((resolve) => {
          asked.push(w.id);
          gates.push(() => resolve({ kind: 'none' }));
        }),
      { concurrency: 1, spacingMs: 0, wait: async () => {} },
    );
    let changes = 0;
    cache.subscribe(() => changes++);
    cache.request([work('a'), work('b'), work('c')]);
    await flush();
    expect(asked).toEqual(['c']);
    gates.shift()?.();
    await flush();
    expect(asked).toEqual(['c', 'b']);
    expect(cache.get(work('c'))).toEqual({ kind: 'none' });
    expect(changes).toBe(1);
    cache.request([work('c')]);
    gates.shift()?.();
    await flush();
    gates.shift()?.();
    await flush();
    expect(asked).toEqual(['c', 'b', 'a']);
  });

  it('drops the oldest waiting items past the cap', async () => {
    const asked: string[] = [];
    const cache = new SourceCache(
      async (w) => {
        asked.push(w.id);
        return { kind: 'none' };
      },
      { concurrency: 1, spacingMs: 0, maxPending: 2, wait: async () => {} },
    );
    cache.request([work('a'), work('b'), work('c'), work('d')]);
    for (let i = 0; i < 6; i++) await flush();
    // Only the two newest are kept; the others scrolled out of sight before their turn.
    expect(asked).toEqual(['d', 'c']);
  });

  it('spaces requests out', async () => {
    const waits: number[] = [];
    const now = 1000;
    const cache = new SourceCache(async () => ({ kind: 'none' }), {
      concurrency: 3,
      spacingMs: 250,
      now: () => now,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    cache.request([work('a'), work('b'), work('c')]);
    await flush();
    expect(waits).toEqual([250, 500]);
  });

  it('forgets answers after their time and keeps unknowns unknown', async () => {
    let now = 0;
    let answer: Availability | null = null;
    const cache = new SourceCache(async () => answer, {
      spacingMs: 0,
      noneTtlMs: 100,
      foundTtlMs: 1000,
      now: () => now,
      wait: async () => {},
    });
    cache.request([work('a')]);
    await flush();
    expect(cache.get(work('a'))).toBeUndefined();
    answer = { kind: 'none' };
    cache.request([work('a')]);
    await flush();
    expect(cache.get(work('a'))).toEqual({ kind: 'none' });
    now = 150;
    expect(cache.get(work('a'))).toBeUndefined();
    cache.set(work('a'), { kind: 'stream', addon: 'LibriVox' });
    now = 900;
    expect(cache.get(work('a'))).toEqual({ kind: 'stream', addon: 'LibriVox' });
  });

  it('throws away answers that arrive after a reset', async () => {
    let release: () => void = () => {};
    const cache = new SourceCache(
      () =>
        new Promise<Availability>((resolve) => {
          release = () => resolve({ kind: 'none' });
        }),
      { spacingMs: 0, wait: async () => {} },
    );
    cache.request([work('a')]);
    await flush();
    cache.reset(async () => ({ kind: 'stream', addon: 'X' }));
    release();
    await flush();
    expect(cache.get(work('a'))).toBeUndefined();
  });
});

describe('wanted works', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('follows the shelf and stays out of the settings', () => {
    rememberWanted(db, ME, [work('ol:1', 'Emma'), work('ol:2', 'Dune')], 1);
    rememberWanted(db, ME, [work('ol:2', 'Dune'), work('ol:3', 'Ulysses')], 2);
    expect(listWanted(db, ME).map((w) => [w.id, w.addedAt])).toEqual([
      ['ol:2', 1],
      ['ol:3', 2],
    ]);
    expect(getSettings(db, ME)).not.toHaveProperty('wanted:audiobook:ol:2');
  });

  it('alerts once when a wanted book gets a source', async () => {
    rememberWanted(db, ME, [work('ol:1', 'Emma'), { ...work('ol:2', 'Dune'), playable: true }], 1);
    const asked: string[] = [];
    let has = false;
    const ask = async (w: WorkRef): Promise<Availability | null> => {
      asked.push(w.id);
      return has ? { kind: 'stream', addon: 'LibriVox' } : { kind: 'none' };
    };
    expect(await checkWanted(db, ME, ask, 10)).toEqual([]);
    has = true;
    // A book added after the first check plays from the start: no news either.
    rememberWanted(
      db,
      ME,
      [work('ol:1', 'Emma'), { ...work('ol:2', 'Dune'), playable: true }, work('ol:4', 'Ulysses')],
      15,
    );
    const news = await checkWanted(db, ME, ask, 20);
    expect(news.map((w) => w.name)).toEqual(['Emma']);
    expect(await checkWanted(db, ME, ask, 30)).toEqual([]);
    // Dune played from the start, so it is never asked about.
    expect(asked).toEqual(['ol:1', 'ol:4', 'ol:1']);
  });

  it('skips works whose add-ons did not answer, and asks the least recently checked first', async () => {
    rememberWanted(db, ME, [work('ol:1'), work('ol:2'), work('ol:3')], 1);
    const asked: string[] = [];
    await checkWanted(
      db,
      ME,
      async (w) => {
        asked.push(w.id);
        return w.id === 'ol:2' ? null : { kind: 'none' };
      },
      5,
      2,
    );
    await checkWanted(
      db,
      ME,
      async (w) => {
        asked.push(w.id);
        return { kind: 'none' };
      },
      6,
      2,
    );
    expect(asked).toEqual(['ol:1', 'ol:2', 'ol:2', 'ol:3']);
  });

  it('keeps works when a shelf could not be read', () => {
    rememberWanted(db, ME, [work('ol:1'), work('ol:2')], 1);
    rememberWanted(db, ME, [work('ol:2')], 2, { prune: false });
    expect(listWanted(db, ME)).toHaveLength(2);
  });

  it('marks a book playable when the shelf says it plays', () => {
    rememberWanted(db, ME, [work('ol:1')], 1);
    rememberWanted(db, ME, [{ ...work('ol:1'), playable: true }], 2);
    expect(listWanted(db, ME)[0]?.playable).toBe(true);
  });
});
