import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { resumePoint, saveProgress } from '../progress';
import { bookFiles, bookmarks, books, chapters, libraryRoots, progress } from '../schema';
import type { ScannedFile } from './files';
import { applyScan, filesNeedingTags, type ListedFile, splitScanned, upsertRoot } from './scan';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

function scan(db: Db, files: ScannedFile[], rootLocation = ROOT, now = 100) {
  const rootId = upsertRoot(
    db,
    { uri: `content://${rootLocation}`, name: 'Audiobooks', location: rootLocation },
    now,
    newId,
  );
  const { listed, tags } = splitScanned(files);
  return applyScan(db, { rootId, rootLocation, listed, tags, folderCovers: new Map(), now, newId });
}

const bookByLocation = (db: Db, location: string) =>
  db.select().from(books).where(eq(books.location, location)).get();

const twoBooks = () => [
  scanned('Novel/01.mp3', { durationMs: 1000 }),
  scanned('Novel/02.mp3', { durationMs: 1000 }),
  scanned('Memoir/memoir.mp3', { durationMs: 5000, album: 'A Memoir' }),
];

describe('applyScan', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates books, files and chapters on the first scan', () => {
    expect(scan(db, twoBooks())).toEqual({ added: 2, missing: 0 });
    expect(
      db
        .select()
        .from(books)
        .all()
        .map((b) => [b.title, b.durationMs]),
    ).toEqual(
      expect.arrayContaining([
        ['Novel', 2000],
        ['A Memoir', 5000],
      ]),
    );
    const novel = bookByLocation(db, `${ROOT}/Novel`);
    expect(
      db
        .select()
        .from(chapters)
        .where(eq(chapters.bookId, novel?.id ?? ''))
        .all(),
    ).toHaveLength(2);
    expect(db.select().from(libraryRoots).get()?.lastScanAt).toBe(100);
  });

  it('keeps IDs and needs no tags on an identical second scan', () => {
    scan(db, twoBooks());
    const before = db.select({ id: books.id, location: books.location }).from(books).all();
    const { listed } = splitScanned(twoBooks());
    expect(filesNeedingTags(db, listed)).toEqual([]);
    expect(scan(db, twoBooks(), ROOT, 200)).toEqual({ added: 0, missing: 0 });
    expect(db.select({ id: books.id, location: books.location }).from(books).all()).toEqual(before);
  });

  it('asks for tags of new and changed audio files only', () => {
    scan(db, twoBooks());
    const { listed } = splitScanned([
      ...twoBooks().slice(1),
      scanned('Novel/01.mp3', { modifiedAt: 2 }),
      scanned('New/new.mp3'),
      scanned('New/cover.jpg'),
    ]);
    expect(filesNeedingTags(db, listed).map((f: ListedFile) => f.relPath)).toEqual([
      'Novel/01.mp3',
      'New/new.mp3',
    ]);
  });

  it('marks a removed book missing and keeps its progress and bookmarks', () => {
    scan(db, twoBooks());
    const novel = bookByLocation(db, `${ROOT}/Novel`);
    const bookId = novel?.id ?? '';
    saveProgress(db, ME, {
      bookId,
      fileLocation: `${ROOT}/Novel/02.mp3`,
      filePositionMs: 10,
      savedAt: 150,
    });
    db.insert(bookmarks)
      .values({
        id: 'bm',
        profileId: ME,
        bookId,
        fileLocation: `${ROOT}/Novel/02.mp3`,
        filePositionMs: 10,
        bookPositionMs: 1010,
        note: null,
        createdAt: 150,
        updatedAt: 150,
      })
      .run();

    expect(scan(db, twoBooks().slice(2), ROOT, 200)).toEqual({ added: 0, missing: 1 });
    expect(bookByLocation(db, `${ROOT}/Novel`)?.missingSince).toBe(200);
    expect(db.select().from(progress).all()).toHaveLength(1);
    expect(db.select().from(bookmarks).all()).toHaveLength(1);

    scan(db, twoBooks(), ROOT, 300);
    expect(bookByLocation(db, `${ROOT}/Novel`)?.missingSince).toBeNull();
    expect(resumePoint(db, ME, bookId)).toEqual({
      index: 1,
      location: `${ROOT}/Novel/02.mp3`,
      positionMs: 10,
    });
  });

  it('moves progress to the new book when a folder splits into per-file books', () => {
    scan(db, [
      scanned('Author/First.m4b', { durationMs: 1000 }),
      scanned('Author/Second.m4b', { durationMs: 1000 }),
    ]);
    const folder = bookByLocation(db, `${ROOT}/Author`);
    saveProgress(db, ME, {
      bookId: folder?.id ?? '',
      fileLocation: `${ROOT}/Author/Second.m4b`,
      filePositionMs: 300,
      savedAt: 150,
    });

    const chapters = [{ title: 'One', startMs: 0 }];
    scan(
      db,
      [
        scanned('Author/First.m4b', { durationMs: 1000, chapters, modifiedAt: 2 }),
        scanned('Author/Second.m4b', { durationMs: 1000, chapters, modifiedAt: 2 }),
      ],
      ROOT,
      200,
    );

    expect(bookByLocation(db, `${ROOT}/Author`)).toBeUndefined();
    const second = bookByLocation(db, `${ROOT}/Author/Second.m4b`);
    expect(db.select().from(progress).all()).toEqual([
      expect.objectContaining({ bookId: second?.id, filePositionMs: 300, bookPositionMs: 300 }),
    ]);
  });

  it('keeps book IDs when the library folder becomes its parent', () => {
    const fiction = `${ROOT}/Fiction`;
    const inFiction = (rel: string) => ({
      ...scanned(rel),
      location: `${fiction}/${rel}`,
      relPath: rel,
    });
    scan(db, [inFiction('Novel/01.mp3')], fiction);
    const before = bookByLocation(db, `${fiction}/Novel`);

    const fromParent = { ...inFiction('Novel/01.mp3'), relPath: 'Fiction/Novel/01.mp3' };
    scan(db, [fromParent], ROOT, 200);

    expect(db.select().from(libraryRoots).all()).toHaveLength(1);
    expect(bookByLocation(db, `${fiction}/Novel`)?.id).toBe(before?.id);
    expect(db.select().from(bookFiles).all()).toHaveLength(1);
  });
});
