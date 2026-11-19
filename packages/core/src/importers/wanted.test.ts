import type { Manifest, MetaPreview } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import { addWanted, listWanted, rememberWanted } from '../addons/availability';
import type { Fetcher, InstalledAddon } from '../addons/client';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import type { GoodreadsBook } from './goodreads';
import { isSameBook, lookUpWanted, wantedFromGoodreads } from './wanted';

const book = (title: string, author: string, shelf = 'to-read', isbn: string | null = null) =>
  ({ title, authors: [author], isbn, shelves: [shelf], readAt: null }) satisfies GoodreadsBook;

const catalog: InstalledAddon = {
  id: 'catalog',
  url: 'https://catalog.example/manifest.json',
  builtin: false,
  manifest: {
    id: 'app.example.catalog',
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
  } satisfies Manifest,
};

const ORWELL: MetaPreview = {
  type: 'audiobook',
  id: 'ol:OL1W',
  name: 'Nineteen Eighty-Four',
  author: 'George Orwell',
};
const RESULTS: Record<string, MetaPreview[]> = {
  '9780141036144': [
    { type: 'audiobook', id: 'ol:OL1W', name: 'Nineteen Eighty-Four', author: 'George Orwell' },
  ],
  'Dune Frank Herbert': [
    { type: 'audiobook', id: 'ol:OL2W', name: 'Dune Messiah', author: 'Frank Herbert' },
    { type: 'audiobook', id: 'ol:OL3W', name: 'Dune', author: 'Frank Herbert' },
  ],
};

describe('Want to read from Goodreads', () => {
  it('takes the to-read books the library lacks', () => {
    const db = createTestDb();
    seedBook(db, 'Walden', [{ location: 'walden/1.mp3', durationMs: 1 }]);
    const items = [
      book('Walden', 'Thoreau'),
      book('Dune', 'Frank Herbert'),
      book('Emma', 'Austen', 'read'),
    ];
    expect(wantedFromGoodreads(db, ME, items).map((b) => b.title)).toEqual(['Dune']);
  });

  it('finds a book by ISBN, else by title and author, and says what it could not find', async () => {
    const asked: string[] = [];
    const fetcher: Fetcher = async (url) => {
      const query = decodeURIComponent(/search=([^/]+)\.json/.exec(url)?.[1] ?? '');
      asked.push(query);
      return new Response(JSON.stringify({ metas: RESULTS[query] ?? [] }));
    };
    const found = await lookUpWanted(
      fetcher,
      [catalog],
      [
        book('1984', 'George Orwell', 'to-read', '9780141036144'),
        book('Dune', 'Frank Herbert'),
        book('Unknown', 'Nobody'),
      ],
    );
    // By ISBN whatever the title; by title and author, the same title only.
    expect(found.found.map((m) => m.id)).toEqual(['ol:OL1W', 'ol:OL3W']);
    expect(found.missing).toEqual(['Unknown']);
    expect(asked).toContain('Dune Frank Herbert');
    expect(isSameBook(ORWELL, book('Nineteen Eighty-Four', 'Orwell'))).toBe(true);
  });

  it('keeps imported works when the shelves change', () => {
    const db = createTestDb();
    addWanted(db, ME, [{ type: 'audiobook', id: 'ol:OL3W', name: 'Dune' }], 'goodreads', 1);
    expect(
      addWanted(db, ME, [{ type: 'audiobook', id: 'ol:OL3W', name: 'Dune' }], 'goodreads', 2),
    ).toBe(0);
    rememberWanted(db, ME, [], 3);
    expect(listWanted(db, ME).map((w) => [w.id, w.from])).toEqual([['ol:OL3W', 'goodreads']]);
  });
});
