import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { migrateSafely } from './db';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { saveProgress } from './progress';
import { progress } from './schema';

describe('migrateSafely', () => {
  // drizzle-kit changes a table by rebuilding it (copy, drop, rename) inside the migrator's
  // transaction, where its own `PRAGMA foreign_keys = OFF` has no effect.
  const rebuildBooks = (db: ReturnType<typeof createTestDb>) => () =>
    db.transaction((tx) => {
      tx.run(sql`pragma foreign_keys = off`);
      tx.run(sql`create table __new_books as select * from books`);
      tx.run(sql`drop table books`);
      tx.run(sql`alter table __new_books rename to books`);
    });

  it('keeps saved places when a migration rebuilds the books table', async () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Book', [{ location: 'a', durationMs: 1000 }]);
    saveProgress(db, ME, { bookId, fileLocation: 'a', filePositionMs: 500, savedAt: 1 });
    db.run(sql`pragma foreign_keys = on`);

    await migrateSafely(db, rebuildBooks(db));

    expect(db.select().from(progress).all()).toHaveLength(1);
  });

  it('switches foreign keys on afterwards', async () => {
    const db = createTestDb();
    await migrateSafely(db, () => {});
    expect(db.get<{ foreign_keys: number }>(sql`pragma foreign_keys`)?.foreign_keys).toBe(1);
  });
});
