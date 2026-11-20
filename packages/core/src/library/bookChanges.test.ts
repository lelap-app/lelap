import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import { type Db, migrateSafely } from '../db';
import { createProfile } from '../profiles';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { books, downloads } from '../schema';
import { booksChangedSince, latestBookChange, libraryBooks, watchBookChanges } from './bookChanges';
import { hideBooks, unhideBooks } from './hidden';
import { linkBook, unlinkBook } from './links';
import { type LibraryBook, listAllBooks, setFinished } from './queries';

const byId = (list: LibraryBook[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));

function setup() {
  const db = createTestDb();
  const ids = ['a', 'b', 'c'].map((name) =>
    seedBook(db, name, [{ location: name, durationMs: 1000 }]),
  ) as [string, string, string];
  const reader = libraryBooks(db);
  // The first read is a whole one and starts the triggers.
  reader.read(ME);
  // What a whole read says now, against what the reader patched.
  const same = (profile = ME) =>
    expect(byId(reader.read(profile))).toEqual(byId(listAllBooks(db, profile)));
  return { db, ids, reader, same };
}

const work = { type: 'audiobook', id: 'ol:OL1W', title: 'Dune' };

describe('libraryBooks', () => {
  it('gives the same array while nothing changed', () => {
    const { reader } = setup();
    expect(reader.read(ME)).toBe(reader.read(ME));
  });

  it('keeps the objects of books that did not change', () => {
    const { db, ids, reader } = setup();
    const before = reader.read(ME);
    saveProgress(db, ME, { bookId: ids[0], fileLocation: 'a', filePositionMs: 500, savedAt: 1 });
    const after = reader.read(ME);
    expect(after).not.toBe(before);
    expect(after.find((b) => b.id === ids[1])).toBe(before.find((b) => b.id === ids[1]));
    expect(after.find((b) => b.id === ids[0])?.bookPositionMs).toBe(500);
  });

  it('follows every writer a list shows', () => {
    const { db, ids, same } = setup();
    const [a, b, c] = ids;
    saveProgress(db, ME, { bookId: a, fileLocation: 'a', filePositionMs: 200, savedAt: 1 });
    same();
    setFinished(db, ME, b, true, 2);
    same();
    db.insert(downloads)
      .values({
        bookId: c,
        state: 'done',
        bytesTotal: 1,
        requestedAt: 3,
        completedAt: 3,
        updatedAt: 3,
      })
      .run();
    same();
    db.update(books).set({ title: 'Renamed', missingSince: 4 }).where(eq(books.id, a)).run();
    same();
    linkBook(db, b, work, 5, { title: 'Dune', author: 'Frank Herbert', cover: 'https://c/1.jpg' });
    same();
    expect(listAllBooks(db, ME).find((x) => x.id === b)?.title).toBe('Dune');
    unlinkBook(db, b, 6);
    same();
    hideBooks(db, ME, [c], 7);
    same();
    unhideBooks(db, ME, [c], 8);
    same();
    db.delete(downloads).where(eq(downloads.bookId, c)).run();
    db.delete(books).where(eq(books.id, a)).run();
    same();
    seedBook(db, 'd', [{ location: 'd', durationMs: 1 }]);
    same();
  });

  it('reads anew for another profile', () => {
    const { db, ids, reader, same } = setup();
    const other = createProfile(db, { name: 'Kid', avatar: null, kids: false }, 1, () => 'kid');
    saveProgress(db, other, { bookId: ids[0], fileLocation: 'a', filePositionMs: 900, savedAt: 1 });
    same(other);
    expect(reader.read(other).find((b) => b.id === ids[0])?.bookPositionMs).toBe(900);
    same(ME);
  });

  it('notes each changed book once, at its latest change', () => {
    const { db, ids } = setup();
    const start = latestBookChange(db);
    for (const at of [1, 2, 3]) {
      saveProgress(db, ME, { bookId: ids[0], fileLocation: 'a', filePositionMs: at, savedAt: at });
    }
    const { ids: changed, latest } = booksChangedSince(db, start);
    expect(changed).toEqual([ids[0]]);
    expect(latest).toBeGreaterThan(start);
    expect(booksChangedSince(db, latest).ids).toEqual([]);
  });

  it('lets a migration rebuild books, and watches again after it', async () => {
    const db: Db = createTestDb();
    watchBookChanges(db);
    await migrateSafely(db, () =>
      db.transaction((tx) => {
        tx.run(sql`create table __new_books as select * from books`);
        tx.run(sql`drop table books`);
        tx.run(sql`alter table __new_books rename to books`);
      }),
    );
    const triggers = db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'trigger' and name like 'book_changes_%'`,
    );
    expect(triggers).toHaveLength(18);
  });
});
