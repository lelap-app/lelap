import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { ROOT, scanned } from '../test/files';
import type { Db } from './db';
import type { ScannedFile } from './library/files';
import { applyScan, splitScanned, upsertRoot } from './library/scan';
import {
  CLIP_MAX_MS,
  findPlaceBook,
  parsePlace,
  placeOfBook,
  placeUrl,
  type SharedPlace,
} from './placeLink';
import { books, workLinks } from './schema';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

function scan(db: Db, files: ScannedFile[], now = 100) {
  const rootId = upsertRoot(
    db,
    { uri: `content://${ROOT}`, name: 'Audiobooks', location: ROOT },
    now,
    newId,
  );
  const { listed, tags } = splitScanned(files);
  applyScan(db, { rootId, rootLocation: ROOT, listed, tags, folderCovers: new Map(), now, newId });
}

const idOf = (db: Db, location: string) => {
  const book = db.select().from(books).where(eq(books.location, location)).get();
  if (!book) throw new Error(`no book at ${location}`);
  return book.id;
};

const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

const dune: SharedPlace = {
  title: 'Dune',
  author: 'Frank Herbert',
  ids: ['isbn:9780441172719'],
  work: { type: 'audiobook', id: 'ol:OL893415W' },
  atMs: 8_070_400,
  toMs: 8_100_900,
};

describe('a shared place', () => {
  it('goes through a link and back, in whole seconds', () => {
    const url = placeUrl('https://listen.example.org/', dune);
    expect(url.startsWith('https://listen.example.org/place?')).toBe(true);
    expect(parsePlace(query(url))).toEqual({ ...dune, atMs: 8_070_000, toMs: 8_100_000 });
  });

  it('never carries the file, the folder or the audio', () => {
    const db = createTestDb();
    scan(db, [scanned('Private folder/Dune/01.mp3', { album: 'Dune', artist: 'Frank Herbert' })]);
    const bookId = idOf(db, `${ROOT}/Private folder/Dune`);
    const place = placeOfBook(db, bookId, 5_000);
    if (!place) throw new Error('no place');
    const url = placeUrl('https://listen.example.org', place);
    expect(url).not.toMatch(/Private|content|primary|mp3/);
    expect(query(url)).toEqual({ t: 'Dune', a: 'Frank Herbert', at: '5' });
  });

  it('turns down a link without a title or a time, and keeps a clip short', () => {
    expect(parsePlace({ at: '5' })).toBeNull();
    expect(parsePlace({ t: 'Dune', at: '-5' })).toBeNull();
    expect(parsePlace({ t: 'Dune', at: '1e9' })).toBeNull();
    const long = parsePlace({
      t: 'Dune',
      at: '10',
      to: '100000',
      w: 'Not a work',
      ids: 'x,isbn:1',
    });
    expect(long).toEqual({
      title: 'Dune',
      author: null,
      ids: [],
      work: null,
      atMs: 10_000,
      toMs: 10_000 + CLIP_MAX_MS,
    });
    expect(parsePlace({ t: 'Dune', at: '10', to: '5' })?.toMs).toBeNull();
  });

  it('names a linked book’s work and ISBN', () => {
    const db = createTestDb();
    scan(db, [scanned('Dune/01.mp3', { ids: ['isbn:0441172717'] })]);
    db.insert(workLinks)
      .values({
        bookKey: `${ROOT}/Dune`,
        workType: 'audiobook',
        workId: 'ol:OL893415W',
        state: 'linked',
        ids: ['ol:OL893415W'],
        meta: null,
        updatedAt: 1,
      })
      .run();
    const place = placeOfBook(db, idOf(db, `${ROOT}/Dune`), 1_000, 400_000);
    expect(place?.work).toEqual({ type: 'audiobook', id: 'ol:OL893415W' });
    expect(place?.ids).toEqual(['isbn:9780441172719', 'ol:OL893415W']);
    expect(place?.toMs).toBe(1_000 + CLIP_MAX_MS);
  });
});

describe('finding the listener’s own copy', () => {
  it('by ISBN, then by title and author, and not at all for another book', () => {
    const db = createTestDb();
    scan(db, [
      scanned('A/01.mp3', { ids: ['isbn:9780441172719'], album: 'Something else' }),
      scanned('B/01.mp3', { album: 'Dune', artist: 'Frank Herbert' }),
    ]);
    expect(findPlaceBook(db, dune)).toBe(idOf(db, `${ROOT}/A`));
    expect(findPlaceBook(db, { ...dune, ids: [], work: null })).toBe(idOf(db, `${ROOT}/B`));
    expect(
      findPlaceBook(db, { ...dune, title: 'Emma', author: 'Jane Austen', ids: [] }),
    ).toBeNull();
  });

  it('by the work it is linked to', () => {
    const db = createTestDb();
    scan(db, [scanned('Unnamed/01.mp3')]);
    db.insert(workLinks)
      .values({
        bookKey: `${ROOT}/Unnamed`,
        workType: 'audiobook',
        workId: 'ol:OL893415W',
        state: 'linked',
        ids: [],
        meta: null,
        updatedAt: 1,
      })
      .run();
    expect(findPlaceBook(db, { ...dune, ids: [] })).toBe(idOf(db, `${ROOT}/Unnamed`));
  });
});
