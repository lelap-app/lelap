import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { books, profiles } from '../schema';
import { continueListening, getBook, listBooks, setFinished, setSpeed } from './queries';

const OTHER = 'other-profile';

describe('library queries', () => {
  let db: Db;
  let alpha: string;
  let beta: string;
  let gamma: string;

  beforeEach(() => {
    db = createTestDb();
    db.insert(profiles).values({ id: OTHER, name: 'Other', createdAt: 0, updatedAt: 0 }).run();
    alpha = seedBook(db, 'Alpha', [{ location: 'alpha/1', durationMs: 1000 }]);
    beta = seedBook(db, 'Beta', [{ location: 'beta/1', durationMs: 1000 }]);
    gamma = seedBook(db, 'Æsop', [{ location: 'gamma/1', durationMs: 1000 }]);
    db.update(books).set({ author: 'Zed' }).where(eq(books.id, alpha)).run();
    db.update(books).set({ author: 'Ann' }).where(eq(books.id, beta)).run();
    db.update(books).set({ author: 'Mo', addedAt: 5 }).where(eq(books.id, gamma)).run();
  });

  it('sorts by title with Danish letters last', () => {
    expect(listBooks(db, ME, 'title').map((b) => b.title)).toEqual(['Alpha', 'Beta', 'Æsop']);
  });

  it('sorts by author', () => {
    expect(listBooks(db, ME, 'author').map((b) => b.author)).toEqual(['Ann', 'Mo', 'Zed']);
  });

  it('sorts recent by last played, then newest added', () => {
    saveProgress(db, ME, { bookId: beta, fileLocation: 'beta/1', filePositionMs: 1, savedAt: 50 });
    expect(listBooks(db, ME, 'recent').map((b) => b.title)).toEqual(['Beta', 'Æsop', 'Alpha']);
  });

  it('reports the place and the missing state', () => {
    saveProgress(db, ME, {
      bookId: alpha,
      fileLocation: 'alpha/1',
      filePositionMs: 400,
      savedAt: 1,
    });
    db.update(books).set({ missingSince: 9 }).where(eq(books.id, beta)).run();
    const list = listBooks(db, ME, 'title');
    expect(list[0]).toEqual(expect.objectContaining({ bookPositionMs: 400, missing: false }));
    expect(list[1]).toEqual(expect.objectContaining({ bookPositionMs: 0, missing: true }));
  });

  it('continues the latest book that is neither finished nor missing', () => {
    saveProgress(db, ME, { bookId: alpha, fileLocation: 'alpha/1', filePositionMs: 1, savedAt: 1 });
    saveProgress(db, ME, { bookId: beta, fileLocation: 'beta/1', filePositionMs: 1, savedAt: 2 });
    saveProgress(db, ME, { bookId: gamma, fileLocation: 'gamma/1', filePositionMs: 1, savedAt: 3 });
    setFinished(db, ME, gamma, true, 4);
    db.update(books).set({ missingSince: 9 }).where(eq(books.id, beta)).run();
    expect(continueListening(db, ME)?.id).toBe(alpha);
  });

  it('keeps each profile’s places apart', () => {
    saveProgress(db, OTHER, {
      bookId: alpha,
      fileLocation: 'alpha/1',
      filePositionMs: 900,
      savedAt: 1,
    });
    expect(listBooks(db, ME, 'title')[0]?.bookPositionMs).toBe(0);
    expect(continueListening(db, ME)).toBeNull();
  });

  it('returns a book with its files, chapters and speed', () => {
    setSpeed(db, ME, alpha, 1.25, 1);
    expect(getBook(db, ME, alpha)).toEqual({
      book: expect.objectContaining({ id: alpha, title: 'Alpha' }),
      files: [
        expect.objectContaining({
          location: 'alpha/1',
          durationMs: 1000,
          uri: 'content://alpha/1',
        }),
      ],
      chapters: [],
      speed: 1.25,
    });
    expect(getBook(db, OTHER, alpha)?.speed).toBe(1);
    expect(getBook(db, ME, 'nope')).toBeNull();
  });

  it('marks a book finished and not finished', () => {
    setFinished(db, ME, alpha, true, 7);
    expect(listBooks(db, ME, 'title')[0]?.finishedAt).toBe(7);
    setFinished(db, ME, alpha, false, 8);
    expect(listBooks(db, ME, 'title')[0]?.finishedAt).toBeNull();
  });
});
