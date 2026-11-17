import type { CatalogDefinition, Manifest, MetaPreview } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { browseCatalogs, type Fetcher, fetchCatalog, type InstalledAddon } from './addons/client';
import { addStreamedBook } from './addons/streamed';
import type { Db } from './db';
import { addToShelf } from './kids';
import { setFinished } from './library/queries';
import { createProfile, DEFAULT_PROFILE_ID as ME } from './profiles';
import {
  authorKey,
  type Candidate,
  candidatesFrom,
  type Owned,
  recommend,
  recommendationCatalogs,
  recommendationSeeds,
  type Seed,
  suggestionRows,
} from './recommend';
import { books, downloads } from './schema';
import { recordListening } from './stats';

const LIBRIVOX = 'https://librivox.example/manifest.json';
const OTHER = 'https://other.example/manifest.json';

const meta = (id: string, name: string, author?: string, description?: string): MetaPreview => ({
  type: 'audiobook',
  id,
  name,
  ...(author ? { author } : {}),
  ...(description ? { description } : {}),
});

const seed = (title: string, author: string | null, extra: Partial<Seed> = {}): Seed => ({
  bookId: `b-${title}`,
  title,
  author,
  finishedAt: 1,
  addonUrl: null,
  genres: [],
  ...extra,
});

const none: Owned = { keys: new Set(), books: [] };
const candidates = (metas: MetaPreview[], addonUrl = LIBRIVOX): Candidate[] =>
  metas.map((m) => ({ meta: m, addonUrl }));

describe('recommend', () => {
  const pool = candidates([
    meta('ol:1', 'The Return of Sherlock Holmes', 'Arthur Conan Doyle'),
    meta('ol:2', 'Pride and Prejudice', 'Jane Austen'),
    meta('ol:3', 'The Lost World', 'Doyle, Arthur Conan'),
    meta('ol:4', 'Emma', 'Jane Austen'),
    meta('ol:5', 'Walden', 'Henry David Thoreau'),
  ]);

  it('suggests books by the same author and from the same series', () => {
    const rows = recommend({
      seeds: [seed('The Adventures of Sherlock Holmes', 'Arthur Conan Doyle')],
      candidates: pool,
      owned: none,
      authorListening: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.because.title).toBe('The Adventures of Sherlock Holmes');
    // Same author and shared title words first, then the same author alone.
    expect(rows[0]?.items.map((m) => m.id)).toEqual(['ol:1', 'ol:3']);
  });

  it('changes with what was finished last', () => {
    const rows = recommend({
      seeds: [
        seed('Sense and Sensibility', 'Austen, Jane', { finishedAt: 2 }),
        seed('A Study in Scarlet', 'Arthur Conan Doyle'),
      ],
      candidates: pool,
      owned: none,
      authorListening: new Map(),
    });
    expect(rows.map((r) => r.because.title)).toEqual([
      'Sense and Sensibility',
      'A Study in Scarlet',
    ]);
    expect(rows[0]?.items.map((m) => m.id)).toEqual(['ol:2', 'ol:4']);
  });

  it('never suggests what the library has, or a book twice', () => {
    const rows = recommend({
      seeds: [seed('Persuasion', 'Jane Austen'), seed('Mansfield Park', 'Jane Austen')],
      candidates: [...pool, ...candidates([meta('ol:4', 'Emma', 'Jane Austen')], OTHER)],
      owned: { keys: new Set(['audiobook\nol:2']), books: [{ title: 'Emma', author: null }] },
      authorListening: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it('leaves out weak matches and podcasts', () => {
    const rows = recommend({
      seeds: [seed('Walden', null, { addonUrl: LIBRIVOX })],
      candidates: [
        ...candidates([meta('ol:9', 'Moby Dick', 'Herman Melville')]),
        {
          meta: { ...meta('pod:1', 'Walden Pond', 'Henry David Thoreau'), type: 'podcast' },
          addonUrl: LIBRIVOX,
        },
      ],
      owned: none,
      authorListening: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it('weighs authors the profile listens to for hours, and genres from a download', () => {
    const rows = recommend({
      seeds: [
        seed('The Time Machine', 'H. G. Wells', {
          genres: ['Science fiction'],
          addonUrl: LIBRIVOX,
        }),
      ],
      candidates: candidates([
        meta('ol:20', 'Twenty Thousand Leagues', 'Jules Verne', 'A science fiction voyage.'),
        meta('ol:21', 'Frankenstein', 'Mary Shelley', 'Gothic science fiction.'),
      ]),
      owned: none,
      authorListening: new Map([[authorKey('Mary Shelley'), 10 * 3_600_000]]),
    });
    expect(rows[0]?.items.map((m) => m.id)).toEqual(['ol:21', 'ol:20']);
  });

  it('keeps to the row and item limits', () => {
    const many = candidates(
      Array.from({ length: 30 }, (_, i) => meta(`ol:${100 + i}`, `Tale ${i}`, 'Jane Austen')),
    );
    const rows = recommend({
      seeds: [seed('A', 'Jane Austen'), seed('B', 'Jane Austen'), seed('C', 'Jane Austen')],
      candidates: many,
      owned: none,
      authorListening: new Map(),
      maxRows: 2,
      perRow: 12,
    });
    expect(rows.map((r) => r.items.length)).toEqual([12, 12]);
  });
});

const addon = (url: string, catalogs: CatalogDefinition[]): InstalledAddon => {
  const manifest: Manifest = {
    id: url,
    version: '1.0.0',
    protocol: 1,
    name: url,
    description: '',
    types: ['audiobook', 'podcast'],
    resources: ['catalog'],
    catalogs,
  };
  return { id: url, url, builtin: false, manifest };
};

let n = 0;
const newId = () => `r-${++n}`;

function finishStreamed(db: Db, profile: string, item: MetaPreview, at: number): string {
  const bookId = addStreamedBook(db, {
    addonUrl: LIBRIVOX,
    meta: item,
    stream: { sourceKey: item.id, name: 'LibriVox', url: `https://audio.example/${at}.mp3` },
    now: at,
    newId,
  });
  setFinished(db, profile, bookId, true, at);
  return bookId;
}

describe('suggestionRows', () => {
  const pages = [
    [meta('ol:1', 'The Lost World', 'Arthur Conan Doyle'), meta('ol:2', 'Emma', 'Jane Austen')],
  ];
  const ref = recommendationCatalogs([
    addon(LIBRIVOX, [{ type: 'audiobook', id: 'top', name: 'Top' }]),
  ]);

  it('builds rows from the database and the loaded pages', () => {
    const db = createTestDb();
    finishStreamed(db, ME, meta('ol:9', 'A Study in Scarlet', 'Arthur Conan Doyle'), 5);
    recordListening(db, ME, { day: '2026-11-01', bookId: 'x', title: 'x', ms: 1 });
    const rows = suggestionRows(db, ME, candidatesFrom(ref, pages));
    expect(rows.map((r) => [r.because.title, r.items.map((m) => m.id)])).toEqual([
      ['A Study in Scarlet', ['ol:1']],
    ]);
  });

  it('reads genres from a download and skips books the profile has not finished', () => {
    const db = createTestDb();
    const bookId = finishStreamed(db, ME, meta('ol:9', 'Persuasion', 'Jane Austen'), 5);
    db.insert(downloads)
      .values({
        bookId,
        state: 'done',
        bytesTotal: 1,
        requestedAt: 1,
        updatedAt: 1,
        meta: { ...meta('ol:9', 'Persuasion', 'Jane Austen'), genres: ['Romance'] },
      })
      .run();
    expect(recommendationSeeds(db, ME).map((s) => s.genres)).toEqual([['Romance']]);
    setFinished(db, ME, bookId, false, 6);
    expect(recommendationSeeds(db, ME)).toEqual([]);
  });

  it('builds a kid’s rows only from what the kid may see', () => {
    const db = createTestDb();
    const kid = createProfile(db, { name: 'Ida', avatar: null, kids: true }, 1, newId);
    db.insert(books)
      .values({
        id: 'local-1',
        location: 'primary:Audiobooks/Scarlet',
        kind: 'folder',
        source: 'local',
        title: 'A Study in Scarlet',
        author: 'Arthur Conan Doyle',
        durationMs: 1,
        addedAt: 1,
        updatedAt: 1,
      })
      .run();
    setFinished(db, kid, 'local-1', true, 5);
    expect(suggestionRows(db, kid, candidatesFrom(ref, pages))).toEqual([]);
    addToShelf(db, kid, 'local-1', 6);
    expect(suggestionRows(db, kid, candidatesFrom(ref, pages))).toHaveLength(1);
  });
});

describe('what suggestions ask add-ons for', () => {
  const addons = [
    addon(LIBRIVOX, [
      { type: 'audiobook', id: 'top', name: 'Top', extra: [{ name: 'genre', options: ['x'] }] },
      {
        type: 'audiobook',
        id: 'search',
        name: 'Search',
        extra: [{ name: 'search', isRequired: true }],
      },
      { type: 'podcast', id: 'shows', name: 'Shows' },
    ]),
    addon(OTHER, [
      { type: 'audiobook', id: 'wanted', name: 'Want to read', shelf: 'want-to-read' },
      { type: 'audiobook', id: 'new', name: 'New' },
    ]),
  ];

  async function requestsFor(db: Db): Promise<string[]> {
    const urls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ metas: [] }) };
    };
    const refs = recommendationCatalogs(addons);
    const pages = await Promise.all(refs.map((r) => fetchCatalog(fetcher, r)));
    // Working the rows out reads only the database: it has no way to make a request.
    suggestionRows(db, ME, candidatesFrom(refs, pages));
    return urls;
  }

  it('makes only the first-page requests Home makes, whatever the profile finished', async () => {
    const home: string[] = [];
    const homeFetcher: Fetcher = async (url) => {
      home.push(url);
      return { ok: true, status: 200, json: async () => ({ metas: [] }) };
    };
    for (const ref of browseCatalogs(addons, ['audiobook', 'podcast'])) {
      await fetchCatalog(homeFetcher, ref);
    }

    const empty = createTestDb();
    const busy = createTestDb();
    finishStreamed(busy, ME, meta('ol:9', 'A Study in Scarlet', 'Arthur Conan Doyle'), 5);
    finishStreamed(busy, ME, meta('ol:8', 'Persuasion', 'Jane Austen'), 6);
    recordListening(busy, ME, { day: '2026-11-01', bookId: 'b', title: 'Persuasion', ms: 9e6 });

    const before = await requestsFor(empty);
    const after = await requestsFor(busy);
    expect(after).toEqual(before);
    expect(before).toEqual([
      'https://librivox.example/catalog/audiobook/top.json',
      'https://other.example/catalog/audiobook/new.json',
    ]);
    for (const url of after) {
      expect(home).toContain(url);
      expect(url).not.toMatch(/scarlet|doyle|persuasion|austen|ol:9|ol:8/i);
    }
  });
});
