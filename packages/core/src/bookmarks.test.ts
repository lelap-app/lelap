import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { addBookmark, deleteBookmark, listBookmarks } from './bookmarks';
import type { Db } from './db';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { profiles } from './schema';

describe('bookmarks', () => {
  let db: Db;
  let bookId: string;
  let n = 0;
  const newId = () => `bm-${++n}`;

  beforeEach(() => {
    db = createTestDb();
    bookId = seedBook(db, 'Book', [
      { location: 'a', durationMs: 1000 },
      { location: 'b', durationMs: 1000 },
    ]);
  });

  it('lists bookmarks by position with their notes', () => {
    addBookmark(db, ME, newId, {
      bookId,
      fileLocation: 'b',
      filePositionMs: 10,
      note: 'later',
      now: 1,
    });
    addBookmark(db, ME, newId, {
      bookId,
      fileLocation: 'a',
      filePositionMs: 20,
      note: null,
      now: 2,
    });
    expect(listBookmarks(db, ME, bookId).map((b) => [b.bookPositionMs, b.note])).toEqual([
      [20, null],
      [1010, 'later'],
    ]);
  });

  it('deletes a bookmark', () => {
    const id = addBookmark(db, ME, newId, {
      bookId,
      fileLocation: 'a',
      filePositionMs: 0,
      note: null,
      now: 1,
    });
    deleteBookmark(db, ME, id);
    expect(listBookmarks(db, ME, bookId)).toEqual([]);
  });

  it('shows only the profile’s own bookmarks', () => {
    db.insert(profiles).values({ id: 'other', name: 'Other', createdAt: 0, updatedAt: 0 }).run();
    const id = addBookmark(db, 'other', newId, {
      bookId,
      fileLocation: 'a',
      filePositionMs: 0,
      note: null,
      now: 1,
    });
    expect(listBookmarks(db, ME, bookId)).toEqual([]);
    deleteBookmark(db, ME, id);
    expect(listBookmarks(db, 'other', bookId)).toHaveLength(1);
  });
});
