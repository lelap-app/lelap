import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { books, workLinks } from '../schema';
import { applyOps, collectOps, type Op } from '../sync/ops';
import type { ScannedFile } from './files';
import {
  bookLinks,
  catalogCoverName,
  findYourCopy,
  linkedCoverUrls,
  type LinkableWork,
  linkBook,
  rejectLink,
  unlinkBook,
} from './links';
import { getBook, listBooks } from './queries';
import { applyScan, filesNeedingTags, splitScanned, upsertRoot } from './scan';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

function scan(db: Db, files: ScannedFile[]) {
  const rootId = upsertRoot(
    db,
    { uri: `content://${ROOT}`, name: 'Audiobooks', location: ROOT },
    1,
    newId,
  );
  const { listed, tags } = splitScanned(files);
  applyScan(db, {
    rootId,
    rootLocation: ROOT,
    listed,
    tags,
    folderCovers: new Map(),
    now: 1,
    newId,
  });
}

const idOf = (db: Db, location: string) =>
  db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.location, `${ROOT}/${location}`))
    .get()?.id ?? '';

const dune: LinkableWork = {
  type: 'audiobook',
  id: 'ol:OL893415W',
  title: 'Dune',
  author: 'Frank Herbert',
  externalIds: { ol: 'OL893415W', asin: 'B002V1OF70' },
};

describe('your copy', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
    scan(db, [
      // Tagged, under a folder name unlike its title.
      scanned('Sci-fi/hb-01/01.mp3', { album: 'Dune (Unabridged)', albumArtist: 'Herbert, Frank' }),
      scanned('Sci-fi/hb-01/02.mp3', { album: 'Dune (Unabridged)', albumArtist: 'Herbert, Frank' }),
      // An ASIN in the tags.
      scanned('Hail/book.m4b', {
        album: 'Project Hail Mary',
        albumArtist: 'Andy Weir',
        ids: ['asin:b08g9pruuz'],
      }),
      // No tags at all: only names.
      scanned('Ursula K. Le Guin - The Dispossessed/01.mp3'),
      // Tags that say something else than the folder name.
      scanned('Ursula K. Le Guin - The Lathe of Heaven/01.mp3', {
        album: 'Unrelated',
        albumArtist: 'Somebody',
      }),
      scanned('Series/Harry Potter, Book 2/01.mp3', {
        album: 'Harry Potter, Book 2',
        albumArtist: 'J.K. Rowling',
      }),
    ]);
  });

  it('offers the same title and author for one tap', () => {
    expect(findYourCopy(db, dune)).toMatchObject({
      bookId: idOf(db, 'Sci-fi/hb-01'),
      how: 'offer',
    });
  });

  it('links on an ASIN without asking', () => {
    const hail = { type: 'audiobook', id: 'asin:B08G9PRUUZ', title: 'Something else' };
    expect(findYourCopy(db, hail)).toMatchObject({ bookId: idOf(db, 'Hail'), how: 'id' });
  });

  it('reads folder names only when the files have no tags', () => {
    const dispossessed = {
      type: 'audiobook',
      id: 'ol:1',
      title: 'The Dispossessed',
      author: 'Ursula K. Le Guin',
    };
    expect(findYourCopy(db, dispossessed)?.how).toBe('offer');
    const lathe = {
      type: 'audiobook',
      id: 'ol:2',
      title: 'The Lathe of Heaven',
      author: 'Ursula K. Le Guin',
    };
    expect(findYourCopy(db, lathe)).toBeNull();
  });

  it('keeps other books of a series, other authors and podcasts apart', () => {
    const first = {
      type: 'audiobook',
      id: 'ol:3',
      title: 'Harry Potter',
      author: 'J. K. Rowling',
      series: 1,
    };
    expect(findYourCopy(db, first)).toBeNull();
    expect(findYourCopy(db, { ...first, series: 2 })?.how).toBe('offer');
    expect(findYourCopy(db, { ...dune, author: 'Brian Herbert' })).toBeNull();
    expect(findYourCopy(db, { ...dune, type: 'podcast' })).toBeNull();
  });

  it('remembers a yes, and the book shows first', () => {
    const bookId = idOf(db, 'Sci-fi/hb-01');
    linkBook(db, bookId, dune, 10);
    expect(findYourCopy(db, dune)).toMatchObject({ bookId, how: 'linked' });
    // Another page for the same work, by an ID the link knows.
    expect(findYourCopy(db, { type: 'audiobook', id: 'asin:B002V1OF70' })).toMatchObject({
      bookId,
      how: 'linked',
    });
  });

  it('remembers a no, and unlinking is one call', () => {
    const bookId = idOf(db, 'Sci-fi/hb-01');
    rejectLink(db, bookId, dune, 10);
    expect(findYourCopy(db, dune)).toBeNull();
    linkBook(db, bookId, dune, 20);
    expect(findYourCopy(db, dune)?.how).toBe('linked');
    unlinkBook(db, bookId, 30);
    expect(findYourCopy(db, dune)).toBeNull();
    expect(bookLinks(db, bookId)).toEqual([]);
  });

  it('a no on an ID match stops the automatic link too', () => {
    const hail = { type: 'audiobook', id: 'asin:B08G9PRUUZ' };
    rejectLink(db, idOf(db, 'Hail'), hail, 10);
    expect(findYourCopy(db, hail)).toBeNull();
  });

  it('Match with catalog shows the work’s title, author and cover', () => {
    const bookId = idOf(db, 'Ursula K. Le Guin - The Lathe of Heaven');
    linkBook(db, bookId, { type: 'audiobook', id: 'ol:OL59863W' }, 10, {
      title: 'The Lathe of Heaven',
      author: 'Ursula K. Le Guin',
      cover: 'https://covers.example/lathe.jpg',
    });
    expect(getBook(db, ME, bookId)?.book).toMatchObject({
      title: 'The Lathe of Heaven',
      author: 'Ursula K. Le Guin',
      coverUrl: 'https://covers.example/lathe.jpg',
    });
    expect(listBooks(db, ME, 'title').some((b) => b.title === 'Unrelated')).toBe(false);
    expect(linkedCoverUrls(db)).toEqual(['https://covers.example/lathe.jpg']);
    unlinkBook(db, bookId, 20);
    expect(getBook(db, ME, bookId)?.book.title).toBe('Unrelated');
    expect(linkedCoverUrls(db)).toEqual([]);
  });

  it('names a kept cover by its address alone', () => {
    const name = catalogCoverName('https://covers.example/lathe.jpg');
    expect(name).toMatch(/^[0-9a-f]{32}$/);
    expect(catalogCoverName('https://covers.example/lathe.jpg')).toBe(name);
    expect(catalogCoverName('https://covers.example/dune.jpg')).not.toBe(name);
  });

  it('a book is one work: linking it again moves the link', () => {
    const bookId = idOf(db, 'Sci-fi/hb-01');
    linkBook(db, bookId, dune, 10);
    linkBook(db, bookId, { type: 'audiobook', id: 'ol:OL1W' }, 20);
    expect(bookLinks(db, bookId).map((l) => l.workId)).toEqual(['ol:OL1W']);
  });
});

describe('links sync', () => {
  it('travel keyed on the book’s location, newest first', () => {
    const phone = createTestDb();
    const tablet = createTestDb();
    const files = [scanned('Sci-fi/hb-01/01.mp3', { album: 'Dune', albumArtist: 'Frank Herbert' })];
    scan(phone, files);
    linkBook(phone, idOf(phone, 'Sci-fi/hb-01'), dune, 10);
    // The tablet learns the link before it has scanned the folder, and uses it once it has.
    applyOps(tablet, collectOps(phone, 0), 100, newId);
    expect(findYourCopy(tablet, dune)).toBeNull();
    scan(tablet, files);
    expect(findYourCopy(tablet, dune)?.how).toBe('linked');

    unlinkBook(tablet, idOf(tablet, 'Sci-fi/hb-01'), 20);
    applyOps(phone, collectOps(tablet, 15), 100, newId);
    expect(findYourCopy(phone, dune)).toBeNull();
  });

  it('skips a link whose fields are not what they should be', () => {
    const db = createTestDb();
    // What another device might send: a state this version doesn't know, and no data at all.
    const sent = [
      {
        type: 'link',
        key: 'x',
        at: 1,
        data: { book: 'x', workType: 'audiobook', workId: 'ol:1', state: 'maybe', ids: [] },
      },
      { type: 'link', key: 'y', at: 1 },
    ] as unknown as Op[];
    applyOps(db, sent, 1, newId);
    expect(db.select().from(workLinks).all()).toEqual([]);
  });
});

describe('matching stays on the device', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes no request', () => {
    const fetch = vi.fn(() => {
      throw new Error('No request may leave the phone for matching.');
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', fetch);
    const db = createTestDb();
    scan(db, [
      scanned('Dune/01.mp3', {
        album: 'Dune',
        albumArtist: 'Frank Herbert',
        ids: ['isbn:0441013597'],
      }),
    ]);
    const bookId = idOf(db, 'Dune');
    const result = findYourCopy(db, { ...dune, externalIds: { isbn: '9780441013593' } });
    expect(result).toEqual(expect.objectContaining({ bookId, how: 'id' }));
    linkBook(db, bookId, dune, 1);
    rejectLink(db, bookId, dune, 2);
    unlinkBook(db, bookId, 3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('has no way to make one: the code is synchronous and names no network API', () => {
    const source = readFileSync(fileURLToPath(new URL('./links.ts', import.meta.url)), 'utf8');
    const sdk = readFileSync(
      fileURLToPath(new URL('../../../sdk/src/match.ts', import.meta.url)),
      'utf8',
    );
    for (const code of [source, sdk]) {
      expect(code).not.toMatch(
        /\bfetch\b|XMLHttpRequest|WebSocket|\basync\b|\bawait\b|from '\.\.\/addons\/client'/,
      );
    }
  });
});

describe('review cases', () => {
  it('keeps the series number of a folder name in each half', () => {
    const db = createTestDb();
    scan(db, [scanned('Frank Herbert - 02 - Dune Messiah/01.mp3'), scanned('02 - Dune/01.mp3')]);
    expect(findYourCopy(db, { ...dune, series: 1 })).toBeNull();
    expect(findYourCopy(db, { ...dune, series: 2 })).toBeNull();
  });

  it('leaves a book linked to another work out', () => {
    const db = createTestDb();
    scan(db, [
      scanned('Dune/01.mp3', {
        album: 'Dune',
        albumArtist: 'Frank Herbert',
        ids: ['isbn:0441013597'],
      }),
    ]);
    linkBook(db, idOf(db, 'Dune'), { type: 'audiobook', id: 'ol:OL9W' }, 1);
    expect(findYourCopy(db, { ...dune, externalIds: { isbn: '9780441013593' } })).toBeNull();
  });

  it('reads files from before M56 once more for their IDs', () => {
    const db = createTestDb();
    const files = [scanned('Dune/01.mp3', { album: 'Dune' })];
    scan(db, files);
    const { listed } = splitScanned(files);
    expect(filesNeedingTags(db, listed)).toEqual([]);
    expect(filesNeedingTags(db, listed, { readsIds: true })).toHaveLength(1);
    scan(db, [scanned('Dune/01.mp3', { album: 'Dune', ids: [] })]);
    expect(filesNeedingTags(db, listed, { readsIds: true })).toEqual([]);
  });
});
