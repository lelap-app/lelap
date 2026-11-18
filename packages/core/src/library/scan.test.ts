import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { resumePoint, saveProgress } from '../progress';
import { getBook, setFinished, setSpeed } from './queries';
import {
  bookFiles,
  bookmarks,
  books,
  chapters,
  libraryEntries,
  libraryRoots,
  progress,
} from '../schema';
import type { ScannedFile } from './files';
import { collectOps } from '../sync/ops';
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

  it('gives sync nothing to send after a rescan that finds no changes (M68)', () => {
    scan(db, twoBooks());
    const novel = bookByLocation(db, `${ROOT}/Novel`);
    const files = db.select().from(bookFiles).all();
    const chapterIds = db.select({ id: chapters.id }).from(chapters).all();
    saveProgress(
      db,
      ME,
      {
        bookId: novel?.id ?? '',
        fileLocation: files[1]?.location ?? '',
        filePositionMs: 500,
        savedAt: 150,
      },
      'app',
    );
    setSpeed(db, ME, novel?.id ?? '', 1.25, 150);
    // Only the default profile, made at the real time, is newer than the last push at 160.
    const pending = collectOps(db, 160);
    expect(pending.map((op) => op.type)).toEqual(['profile']);
    scan(db, twoBooks(), ROOT, 200);
    expect(collectOps(db, 160)).toEqual(pending);
    expect(db.select().from(bookFiles).all()).toEqual(files);
    expect(db.select({ id: chapters.id }).from(chapters).all()).toEqual(chapterIds);
  });

  it('reads single files once more for genre and ISRC (M77), not the parts of a book', () => {
    scan(db, [...twoBooks(), scanned('Song.flac', { durationMs: 1000 })]);
    const { listed } = splitScanned([...twoBooks(), scanned('Song.flac', { durationMs: 1000 })]);
    expect(filesNeedingTags(db, listed)).toEqual([]);
    expect(filesNeedingTags(db, listed, { readsKinds: true }).map((f) => f.relPath)).toEqual([
      'Memoir/memoir.mp3',
      'Song.flac',
    ]);
    const kindTags = {
      genre: null,
      isrc: null,
      track: null,
      year: null,
      narrator: null,
      mediaKind: null,
    };
    scan(db, [
      ...twoBooks().map((f) => ({ ...f, kindTags })),
      scanned('Song.flac', { durationMs: 1000, kindTags }),
    ]);
    expect(filesNeedingTags(db, listed, { readsKinds: true })).toEqual([]);
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

  it('rebuilds a book once when a file goes missing, not on every scan after', () => {
    const files = [
      scanned('Novel/01.mp3', { durationMs: 1000 }),
      scanned('Novel/02.mp3', { durationMs: 1000 }),
      scanned('Novel/03.mp3', { durationMs: 1000 }),
    ];
    scan(db, files);
    const chapterIds = () =>
      db
        .select({ id: chapters.id })
        .from(chapters)
        .all()
        .map((c) => c.id);
    const withoutSecond = [files[0], files[2]].flatMap((f) => (f ? [f] : []));
    scan(db, withoutSecond, ROOT, 200);
    const rebuilt = chapterIds();
    expect(rebuilt).toHaveLength(2);
    scan(db, withoutSecond, ROOT, 300);
    expect(chapterIds()).toEqual(rebuilt);
    // When the file comes back, the book is whole again.
    scan(db, files, ROOT, 400);
    expect(chapterIds()).toHaveLength(3);
  });

  it('adds a big first scan in one go, with every file in its book', () => {
    const files = Array.from({ length: 450 }, (_, i) =>
      scanned(`Book ${Math.floor(i / 3)}/${(i % 3) + 1}.mp3`, { durationMs: 1000 }),
    );
    expect(scan(db, files)).toEqual({ added: 150, missing: 0 });
    const rows = db.select().from(bookFiles).all();
    expect(rows).toHaveLength(450);
    expect(rows.every((f) => f.bookId !== null)).toBe(true);
    expect(db.select().from(chapters).all()).toHaveLength(450);
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

  it('keeps the place, bookmarks and speed on a missing file when its book regroups', () => {
    const chaptered = { chapters: [{ title: 'One', startMs: 0 }], durationMs: 1000 };
    scan(db, [
      scanned('Book/intro.mp3', { durationMs: 500 }),
      scanned('Book/y.m4b', chaptered),
      scanned('Book/z.m4b', chaptered),
    ]);
    const folder = bookByLocation(db, `${ROOT}/Book`)?.id ?? '';
    saveProgress(db, ME, {
      bookId: folder,
      fileLocation: `${ROOT}/Book/intro.mp3`,
      filePositionMs: 200,
      savedAt: 150,
    });
    setSpeed(db, ME, folder, 1.5, 150);
    db.insert(bookmarks)
      .values({
        id: 'bm',
        profileId: ME,
        bookId: folder,
        fileLocation: `${ROOT}/Book/intro.mp3`,
        filePositionMs: 200,
        bookPositionMs: 200,
        note: null,
        createdAt: 150,
        updatedAt: 150,
      })
      .run();

    scan(db, [scanned('Book/y.m4b', chaptered), scanned('Book/z.m4b', chaptered)], ROOT, 200);

    const y = bookByLocation(db, `${ROOT}/Book/y.m4b`)?.id;
    expect(db.select().from(progress).all()).toEqual([
      expect.objectContaining({ bookId: y, bookPositionMs: 200 }),
    ]);
    expect(db.select().from(bookmarks).all()).toEqual([expect.objectContaining({ bookId: y })]);
    expect(getBook(db, ME, y ?? '')?.speed).toBe(1.5);
  });

  it('carries the finished mark to every book a finished book splits into', () => {
    scan(db, [scanned('Set/a.m4b'), scanned('Set/b.m4b')]);
    setFinished(db, ME, bookByLocation(db, `${ROOT}/Set`)?.id ?? '', true, 150);
    const chaptered = { chapters: [{ title: 'One', startMs: 0 }], modifiedAt: 2 };
    scan(db, [scanned('Set/a.m4b', chaptered), scanned('Set/b.m4b', chaptered)], ROOT, 200);
    expect(db.select({ finishedAt: libraryEntries.finishedAt }).from(libraryEntries).all()).toEqual(
      [{ finishedAt: 150 }, { finishedAt: 150 }],
    );
  });

  it('saves a place for a book that was regrouped away into the book now holding the file', () => {
    scan(db, [scanned('Set/a.m4b'), scanned('Set/b.m4b')]);
    const old = bookByLocation(db, `${ROOT}/Set`)?.id ?? '';
    const chaptered = { chapters: [{ title: 'One', startMs: 0 }], modifiedAt: 2 };
    scan(db, [scanned('Set/a.m4b', chaptered), scanned('Set/b.m4b', chaptered)], ROOT, 200);
    expect(
      saveProgress(db, ME, {
        bookId: old,
        fileLocation: `${ROOT}/Set/b.m4b`,
        filePositionMs: 30,
        savedAt: 300,
      }),
    ).toBe(true);
    const b = bookByLocation(db, `${ROOT}/Set/b.m4b`)?.id ?? '';
    expect(resumePoint(db, ME, b)).toEqual({
      index: 0,
      location: `${ROOT}/Set/b.m4b`,
      positionMs: 30,
    });
  });

  it('asks again for tags of files whose duration is unknown', () => {
    const files = [scanned('Book/a.mp3', { durationMs: 0 })];
    scan(db, files);
    expect(filesNeedingTags(db, splitScanned(files).listed).map((f) => f.name)).toEqual(['a.mp3']);
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
