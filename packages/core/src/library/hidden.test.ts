import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import { exportLibrary, importLibrary } from '../backup';
import { carShelves } from '../car';
import type { Db } from '../db';
import { booksWithTag, setTags } from '../organise';
import { createProfile, DEFAULT_PROFILE_ID as ME } from '../profiles';
import { recommendationSeeds } from '../recommend';
import { books, type KindTags, libraryEntries } from '../schema';
import { applyOps, collectOps } from '../sync/ops';
import {
  hiddenCount,
  hideBooks,
  isHidden,
  markNotMusic,
  showInLibrary,
  unhideBooks,
} from './hidden';
import { musicSuggestions } from './musicSuggestions';
import { continueListening, getBook, listAllBooks, listBooks, setFinished } from './queries';
import type { ScannedFile } from './files';
import { applyScan, splitScanned, upsertRoot } from './scan';

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

const SONG = 'Example Song - Example Artist [XX0AB2400001].flac';
const NO_TAGS: KindTags = {
  genre: null,
  isrc: null,
  track: null,
  year: null,
  narrator: null,
  mediaKind: null,
};

const library = (): ScannedFile[] => [
  scanned('Novel/01.mp3', { durationMs: 3_600_000 }),
  scanned('Novel/02.mp3', { durationMs: 3_600_000 }),
  scanned(SONG, { durationMs: 200_000, kindTags: NO_TAGS }),
  scanned('Other Song.mp3', {
    durationMs: 180_000,
    album: 'Example Album',
    kindTags: { ...NO_TAGS, genre: 'Pop', track: '2', year: '2019' },
  }),
  scanned('Story.m4b', { durationMs: 200_000, kindTags: { ...NO_TAGS, isrc: 'XX0AB2400002' } }),
];

describe('hidden books', () => {
  let db: Db;
  let novel: string;
  let song: string;

  beforeEach(() => {
    db = createTestDb();
    scan(db, library());
    novel = idOf(db, `${ROOT}/Novel`);
    song = idOf(db, `${ROOT}/${SONG}`);
  });

  it('leaves hidden books out of every list, and keeps them for the player', () => {
    db.insert(libraryEntries)
      .values({ profileId: ME, bookId: song, lastPlayedAt: 50, updatedAt: 50 })
      .run();
    setTags(db, ME, song, ['loud'], 1);
    expect(continueListening(db, ME)?.id).toBe(song);

    hideBooks(db, ME, [song], 200);

    expect(listBooks(db, ME, 'title').map((b) => b.id)).not.toContain(song);
    expect(listAllBooks(db, ME).map((b) => b.id)).not.toContain(song);
    expect(listAllBooks(db, ME, 'all').map((b) => b.id)).toContain(song);
    expect(continueListening(db, ME)).toBeNull();
    expect(booksWithTag(db, ME, 'loud')).toEqual([]);
    expect(carShelves(db, ME).onPhone).not.toContain(song);
    expect(getBook(db, ME, song)?.book.id).toBe(song);
    expect(listBooks(db, ME, 'title', 'hidden').map((b) => b.id)).toEqual([song]);
    expect(hiddenCount(db, ME)).toBe(1);
    expect(isHidden(db, ME, song)).toBe(true);
    expect(isHidden(db, ME, novel)).toBe(false);
  });

  it('leaves hidden finished books out of recommendation seeds', () => {
    setFinished(db, ME, song, true, 10);
    expect(recommendationSeeds(db, ME).map((s) => s.bookId)).toContain(song);
    hideBooks(db, ME, [song], 20);
    expect(recommendationSeeds(db, ME)).toEqual([]);
  });

  it('is per profile', () => {
    const other = createProfile(db, { name: 'Other', avatar: null, kids: false }, 1, newId);
    hideBooks(db, ME, [song], 200);
    expect(listBooks(db, other, 'title').map((b) => b.id)).toContain(song);
  });

  it('keeps a book hidden through rescans, and when its files come back', () => {
    hideBooks(db, ME, [song], 200);
    scan(db, library(), 300);
    expect(idOf(db, `${ROOT}/${SONG}`)).toBe(song);
    expect(isHidden(db, ME, song)).toBe(true);

    // Gone, removed by a regrouping, and back with a new row ID: still hidden by its location.
    db.delete(books).where(eq(books.id, song)).run();
    scan(db, library(), 400);
    const again = idOf(db, `${ROOT}/${SONG}`);
    expect(again).not.toBe(song);
    expect(isHidden(db, ME, again)).toBe(true);
  });

  it('undoes a hide, and shows a book in the library again', () => {
    hideBooks(db, ME, [song], 200);
    unhideBooks(db, ME, [song], 210);
    expect(isHidden(db, ME, song)).toBe(false);
    // Undo doesn't say anything about music: it may still be suggested.
    expect(musicSuggestions(db, ME)).toContain(song);

    hideBooks(db, ME, [song], 220);
    showInLibrary(db, ME, [song], 230);
    expect(isHidden(db, ME, song)).toBe(false);
    expect(musicSuggestions(db, ME)).not.toContain(song);
    expect(hiddenCount(db, ME)).toBe(0);
  });

  it('never hides podcast episodes', () => {
    db.update(books).set({ source: 'feed' }).where(eq(books.id, novel)).run();
    hideBooks(db, ME, [novel], 200);
    expect(hiddenCount(db, ME)).toBe(0);
  });
});

describe('music suggestions', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
    scan(db, library());
  });

  it('suggests single files that look like music, never books', () => {
    const suggested = musicSuggestions(db, ME).map((id) => getBook(db, ME, id)?.book.title);
    // A single file is named after its album tag when it has one.
    expect(suggested.sort()).toEqual([
      'Example Album',
      'Example Song - Example Artist [XX0AB2400001]',
    ]);
  });

  it('never suggests again what was hidden or said not to be music', () => {
    const [first, second] = musicSuggestions(db, ME);
    hideBooks(db, ME, [first ?? ''], 200);
    markNotMusic(db, ME, [second ?? ''], 200);
    expect(musicSuggestions(db, ME)).toEqual([]);
    // Not music, but still hidden by hand.
    hideBooks(db, ME, [second ?? ''], 300);
    expect(hiddenCount(db, ME)).toBe(2);
  });

  it('suggests nothing from a book with chapters', () => {
    db = createTestDb();
    scan(db, [
      scanned(SONG, {
        durationMs: 200_000,
        kindTags: NO_TAGS,
        chapters: [
          { title: 'One', startMs: 0 },
          { title: 'Two', startMs: 100_000 },
        ],
      }),
    ]);
    expect(musicSuggestions(db, ME)).toEqual([]);
  });
});

describe('hidden books across devices', () => {
  it('syncs and exports the hidden mark by the book’s location', () => {
    const a = createTestDb();
    const b = createTestDb();
    scan(a, library());
    const song = idOf(a, `${ROOT}/${SONG}`);
    hideBooks(a, ME, [song], 200);
    markNotMusic(a, ME, [idOf(a, `${ROOT}/Other Song.mp3`)], 200);

    const ops = collectOps(a, 0).filter((op) => op.type === 'hidden');
    expect(ops).toEqual([
      expect.objectContaining({ key: `${ROOT}/${SONG}`, data: { hidden: true, notMusic: false } }),
      expect.objectContaining({ data: { hidden: false, notMusic: true } }),
    ]);

    // The other device has not scanned yet; the mark waits for the book.
    applyOps(b, ops, 300, newId);
    scan(b, library());
    expect(isHidden(b, ME, idOf(b, `${ROOT}/${SONG}`))).toBe(true);
    expect(musicSuggestions(b, ME)).toEqual([]);

    // An older change loses to a newer one.
    unhideBooks(b, ME, [idOf(b, `${ROOT}/${SONG}`)], 400);
    applyOps(b, ops, 500, newId);
    expect(hiddenCount(b, ME)).toBe(0);

    const c = createTestDb();
    importLibrary(c, exportLibrary(a, 600), 600, newId);
    scan(c, library());
    expect(hiddenCount(c, ME)).toBe(1);
  });

  it('skips a malformed hidden change', () => {
    const db = createTestDb();
    applyOps(
      db,
      [
        // @ts-expect-error: what a broken or hostile device could send
        { type: 'hidden', profile: ME, key: `${ROOT}/x`, at: 1, data: { hidden: 'yes' } },
      ],
      1,
      newId,
    );
    expect(collectOps(db, 0).filter((op) => op.type === 'hidden')).toEqual([]);
  });
});
