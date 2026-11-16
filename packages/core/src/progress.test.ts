import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import type { Db } from './db';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { resumePoint, saveProgress } from './progress';
import { bookFiles, libraryEntries, progress } from './schema';

const FILES = [
  { location: 'a', durationMs: 1000 },
  { location: 'b', durationMs: 2000 },
  { location: 'c', durationMs: 3000 },
];

describe('progress', () => {
  let db: Db;
  let bookId: string;

  beforeEach(() => {
    db = createTestDb();
    bookId = seedBook(db, 'Book', FILES);
  });

  it('resumes where it was saved', () => {
    saveProgress(db, ME, { bookId, fileLocation: 'b', filePositionMs: 500, savedAt: 10 });
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 1, location: 'b', positionMs: 500 });
    expect(db.select().from(progress).get()?.bookPositionMs).toBe(1500);
  });

  it('records when the book was last played', () => {
    saveProgress(db, ME, { bookId, fileLocation: 'a', filePositionMs: 1, savedAt: 42 });
    expect(db.select().from(libraryEntries).get()?.lastPlayedAt).toBe(42);
  });

  it('keeps the time of an unchanged place, so a newer synced place still wins', () => {
    saveProgress(db, ME, { bookId, fileLocation: 'b', filePositionMs: 500, savedAt: 10 });
    expect(
      saveProgress(db, ME, { bookId, fileLocation: 'b', filePositionMs: 500, savedAt: 99 }),
    ).toBe(false);
    expect(db.select().from(progress).get()?.updatedAt).toBe(10);
  });

  it('ignores an entry older than the stored progress', () => {
    saveProgress(db, ME, { bookId, fileLocation: 'c', filePositionMs: 100, savedAt: 20 });
    saveProgress(db, ME, { bookId, fileLocation: 'a', filePositionMs: 0, savedAt: 10 });
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 2, location: 'c', positionMs: 100 });
  });

  it('follows the saved file when the book’s files are reordered', () => {
    saveProgress(db, ME, { bookId, fileLocation: 'b', filePositionMs: 700, savedAt: 10 });
    db.update(bookFiles).set({ idx: 3 }).where(eq(bookFiles.location, 'b')).run();
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 2, location: 'b', positionMs: 700 });
  });

  it('falls back to the book offset when the saved file is gone', () => {
    saveProgress(db, ME, { bookId, fileLocation: 'b', filePositionMs: 700, savedAt: 10 });
    db.update(bookFiles).set({ missingSince: 11 }).where(eq(bookFiles.location, 'b')).run();
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 1, location: 'c', positionMs: 700 });
  });

  it('lets a save from the app win over a later clock reading', () => {
    saveProgress(
      db,
      ME,
      { bookId, fileLocation: 'c', filePositionMs: 100, savedAt: 2_000_000 },
      'journal',
    );
    saveProgress(
      db,
      ME,
      { bookId, fileLocation: 'b', filePositionMs: 5, savedAt: 1_000_000 },
      'app',
    );
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 1, location: 'b', positionMs: 5 });
  });

  it('keeps the book offset when saving in a file that is missing', () => {
    saveProgress(db, ME, { bookId, fileLocation: 'b', filePositionMs: 500, savedAt: 10 });
    db.update(bookFiles).set({ missingSince: 11 }).where(eq(bookFiles.location, 'b')).run();
    saveProgress(db, ME, { bookId, fileLocation: 'b', filePositionMs: 600, savedAt: 12 });
    expect(db.select().from(progress).get()?.bookPositionMs).toBe(1500);
  });

  it('starts a book without progress at the beginning', () => {
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 0, location: 'a', positionMs: 0 });
  });

  it('ignores a journal entry for an unknown book', () => {
    expect(() =>
      saveProgress(db, ME, {
        bookId: 'gone',
        fileLocation: 'nowhere',
        filePositionMs: 1,
        savedAt: 1,
      }),
    ).not.toThrow();
    expect(db.select().from(progress).all()).toEqual([]);
  });
});
