import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import { addBookmark, listAllBookmarks } from '../bookmarks';
import { exportLibrary, importLibrary } from '../backup';
import type { Db } from '../db';
import { createProfile, deleteProfile, DEFAULT_PROFILE_ID as ME } from '../profiles';
import { books, ownChapters } from '../schema';
import { applyOps, collectOps, type Op } from '../sync/ops';
import { chapterTitleAt } from './bookFiles';
import type { ScannedFile } from './files';
import {
  bookChapters,
  cleanChapters,
  getOwnChapters,
  resetOwnChapters,
  setOwnChapters,
} from './ownChapters';
import { getBook, saveFoundChapters } from './queries';
import { applyScan, splitScanned, upsertRoot } from './scan';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;
const untitled = (i: number) => `Chapter ${i}`;

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

const NOVEL = `${ROOT}/Novel`;
const novel = (durationMs = 3_600_000, modifiedAt = 1): ScannedFile[] => [
  scanned('Novel/01.mp3', {
    durationMs,
    modifiedAt,
    chapters: [
      { title: 'Opening', startMs: 0 },
      { title: 'Chapter 1', startMs: 600_000 },
    ],
  }),
];

describe('cleanChapters', () => {
  it('trims, orders, keeps inside the book and drops a second chapter at the same start', () => {
    expect(
      cleanChapters(
        [
          { title: '  Two ', startMs: 2_000.4 },
          { title: '', startMs: 0 },
          { title: 'Late', startMs: 99_999 },
          { title: 'Same start', startMs: 2_000 },
          { title: 'Before', startMs: -5 },
          { title: 'Bad', startMs: Number.NaN },
          { title: 7, startMs: 3_000 },
        ],
        10_000,
        untitled,
      ),
    ).toEqual([
      { title: 'Chapter 1', startMs: 0 },
      { title: 'Two', startMs: 2_000 },
      { title: 'Chapter 3', startMs: 3_000 },
      { title: 'Late', startMs: 9_999 },
    ]);
  });

  it('keeps any start when the length is not known', () => {
    expect(cleanChapters([{ title: 'A', startMs: 5e9 }], 0, untitled)).toEqual([
      { title: 'A', startMs: 5e9 },
    ]);
  });
});

describe('own chapters', () => {
  let db: Db;
  let bookId: string;

  beforeEach(() => {
    db = createTestDb();
    scan(db, novel());
    bookId = idOf(db, NOVEL);
  });

  it('take the place of the book’s chapters for that profile only', () => {
    const other = createProfile(db, { name: 'Sam', avatar: null, kids: false }, 100, newId);
    setOwnChapters(
      db,
      ME,
      bookId,
      [
        { title: 'Prologue', startMs: 0 },
        { title: 'The storm', startMs: 900_000 },
        { title: 'Ending', startMs: 3_000_000 },
      ],
      3_600_000,
      untitled,
      200,
    );
    const mine = getBook(db, ME, bookId);
    expect(mine?.chapters.map((c) => c.title)).toEqual(['Prologue', 'The storm', 'Ending']);
    expect(mine?.ownChapters).toBe(true);
    expect(chapterTitleAt(db, bookId, 1_000_000, ME)).toBe('The storm');
    expect(getBook(db, other, bookId)?.chapters.map((c) => c.title)).toEqual([
      'Opening',
      'Chapter 1',
    ]);
    expect(getBook(db, other, bookId)?.ownChapters).toBe(false);

    resetOwnChapters(db, ME, bookId, 300);
    expect(getBook(db, ME, bookId)?.chapters.map((c) => c.title)).toEqual(['Opening', 'Chapter 1']);
    expect(getOwnChapters(db, ME, bookId)).toBeNull();
  });

  it('are not kept when saved unchanged, and never start past the end', () => {
    setOwnChapters(
      db,
      ME,
      bookId,
      [
        { title: 'Opening', startMs: 0 },
        { title: 'Chapter 1', startMs: 600_000 },
      ],
      3_600_000,
      untitled,
      200,
    );
    expect(getOwnChapters(db, ME, bookId)).toBeNull();
    setOwnChapters(
      db,
      ME,
      bookId,
      [
        { title: 'A', startMs: 0 },
        { title: 'B', startMs: 9_000_000 },
      ],
      0,
      untitled,
      300,
    );
    expect(getBook(db, ME, bookId)?.chapters).toEqual([{ title: 'A', startMs: 0 }]);
  });

  it('may remove every chapter', () => {
    setOwnChapters(db, ME, bookId, [], 3_600_000, untitled, 200);
    expect(getBook(db, ME, bookId)?.chapters).toEqual([]);
    expect(getBook(db, ME, bookId)?.ownChapters).toBe(true);
  });

  it('survive a rescan that rebuilds the book', () => {
    setOwnChapters(db, ME, bookId, [{ title: 'Mine', startMs: 0 }], 3_600_000, untitled, 200);
    scan(db, [], 300);
    scan(db, novel(3_700_000, 2), 400);
    const again = idOf(db, NOVEL);
    expect(getBook(db, ME, again)?.chapters).toEqual([{ title: 'Mine', startMs: 0 }]);
    expect(bookChapters(db, again).map((c) => c.title)).toEqual(['Opening', 'Chapter 1']);
  });

  it('hide found chapters while they apply, which stay underneath', () => {
    db = createTestDb();
    scan(db, [scanned('Lecture.mp3', { durationMs: 3_600_000 })]);
    const lecture = idOf(db, `${ROOT}/Lecture.mp3`);
    saveFoundChapters(
      db,
      lecture,
      [
        { title: 'Part 1', startMs: 0 },
        { title: 'Part 2', startMs: 1_000_000 },
      ],
      100,
      newId,
    );
    expect(getBook(db, ME, lecture)?.foundChapters).toBe(true);
    setOwnChapters(db, ME, lecture, [{ title: 'Intro', startMs: 0 }], 3_600_000, untitled, 200);
    expect(getBook(db, ME, lecture)?.foundChapters).toBe(false);
    resetOwnChapters(db, ME, lecture, 300);
    expect(getBook(db, ME, lecture)?.foundChapters).toBe(true);
  });

  it('go when the profile is deleted', () => {
    const other = createProfile(db, { name: 'Sam', avatar: null, kids: false }, 100, newId);
    setOwnChapters(db, other, bookId, [{ title: 'A', startMs: 0 }], 0, untitled, 200);
    deleteProfile(db, other, 300);
    expect(db.select().from(ownChapters).all()).toEqual([]);
  });
});

describe('own chapters across devices', () => {
  it('sync by the book’s location, newest first, and so does a reset', () => {
    const a = createTestDb();
    const b = createTestDb();
    scan(a, novel());
    scan(b, novel());
    setOwnChapters(a, ME, idOf(a, NOVEL), [{ title: 'Mine', startMs: 5_000 }], 0, untitled, 200);
    const ops = collectOps(a, 0).filter((op) => op.type === 'chapters');
    expect(ops).toEqual([
      {
        type: 'chapters',
        profile: ME,
        key: NOVEL,
        at: 200,
        data: { chapters: [{ title: 'Mine', startMs: 5_000 }] },
      },
    ]);
    applyOps(b, ops, 300, newId);
    expect(getBook(b, ME, idOf(b, NOVEL))?.chapters).toEqual([{ title: 'Mine', startMs: 5_000 }]);

    // An older change loses.
    applyOps(b, [{ ...ops[0], at: 100, data: { chapters: [] } } as Op], 300, newId);
    expect(getBook(b, ME, idOf(b, NOVEL))?.chapters).toEqual([{ title: 'Mine', startMs: 5_000 }]);

    resetOwnChapters(a, ME, idOf(a, NOVEL), 400);
    applyOps(
      b,
      collectOps(a, 300).filter((op) => op.type === 'chapters'),
      500,
      newId,
    );
    expect(getBook(b, ME, idOf(b, NOVEL))?.ownChapters).toBe(false);
  });

  it('arrive before the book does, and are in an export', () => {
    const a = createTestDb();
    scan(a, novel());
    setOwnChapters(a, ME, idOf(a, NOVEL), [{ title: 'Mine', startMs: 0 }], 0, untitled, 200);
    const later = createTestDb();
    importLibrary(later, exportLibrary(a, 300), 300, newId);
    scan(later, novel(), 400);
    expect(getBook(later, ME, idOf(later, NOVEL))?.chapters).toEqual([
      { title: 'Mine', startMs: 0 },
    ]);
  });

  it('skips a malformed change and cleans what it keeps', () => {
    const db = createTestDb();
    scan(db, novel());
    applyOps(
      db,
      [
        { type: 'chapters', profile: ME, key: NOVEL, at: 1, data: { chapters: 'all' } },
        { type: 'chapters', profile: ME, key: '', at: 1, data: { chapters: [] } },
      ] as unknown as Op[],
      10,
      newId,
    );
    expect(db.select().from(ownChapters).all()).toEqual([]);
    applyOps(
      db,
      [
        {
          type: 'chapters',
          profile: ME,
          key: NOVEL,
          at: 2,
          data: { chapters: [{ title: ' B ', startMs: 20 }, null, { title: 'A', startMs: 10 }] },
        },
      ] as unknown as Op[],
      10,
      newId,
    );
    expect(getBook(db, ME, idOf(db, NOVEL))?.chapters).toEqual([
      { title: 'A', startMs: 10 },
      { title: 'B', startMs: 20 },
    ]);
  });
});

describe('all bookmarks', () => {
  it('lists every book’s bookmarks, newest first, with the book and chapter', () => {
    const db = createTestDb();
    scan(db, [...novel(), scanned('Other.mp3', { title: 'Other', durationMs: 60_000 })]);
    const book = idOf(db, NOVEL);
    const other = idOf(db, `${ROOT}/Other.mp3`);
    addBookmark(db, ME, newId, {
      bookId: book,
      fileLocation: `${NOVEL}/01.mp3`,
      filePositionMs: 700_000,
      note: 'Good line',
      now: 100,
    });
    addBookmark(db, ME, newId, {
      bookId: other,
      fileLocation: `${ROOT}/Other.mp3`,
      filePositionMs: 1_000,
      note: null,
      now: 200,
    });
    const list = listAllBookmarks(db, ME);
    expect(list.map((b) => [b.bookId, b.note, b.chapter])).toEqual([
      [other, null, null],
      [book, 'Good line', 'Chapter 1'],
    ]);
    expect(list[1]?.book.title).toBe('Novel');
    expect(listAllBookmarks(db, 'someone-else')).toEqual([]);
  });
});
