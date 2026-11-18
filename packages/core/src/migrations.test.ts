import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { migrateSafely } from './db';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { saveProgress } from './progress';
import * as schema from './schema';
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

describe('0002_addons', () => {
  it('keeps M2 books, files, places and bookmarks', async () => {
    // The migrations as they were at the end of M2.
    const source = fileURLToPath(new URL('../drizzle', import.meta.url));
    const m2 = mkdtempSync(join(tmpdir(), 'lelap-m2-'));
    cpSync(source, m2, { recursive: true });
    const journalPath = join(m2, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag < '0002');
    writeFileSync(journalPath, JSON.stringify(journal));

    const SQL = await initSqlJs();
    const db = drizzle(new SQL.Database(), { schema });
    migrate(db, { migrationsFolder: m2 });
    db.run(sql`pragma foreign_keys = on`);
    db.run(
      sql`insert into library_roots values ('root', 'content://r', 'Audiobooks', 'primary:A', 0, null, 0)`,
    );
    db.run(sql`insert into books (id, root_id, location, kind, title, author, cover_path, duration_ms, missing_since, added_at, updated_at)
      values ('book', 'root', 'primary:A/Novel', 'folder', 'Novel', 'Someone', null, 2000, null, 0, 0)`);
    db.run(sql`insert into book_files (id, location, root_id, book_id, idx, uri, rel_path, name, size, modified_at, duration_ms, chapters_json, updated_at)
      values ('f1', 'primary:A/Novel/01.mp3', 'root', 'book', 0, 'content://1', 'Novel/01.mp3', '01.mp3', 1, 1, 1000, '[]', 0)`);
    // As M2's saveProgress wrote them; today's code knows columns M2 didn't have.
    db.run(sql`insert into progress values (${ME}, 'book', 'primary:A/Novel/01.mp3', 500, 500, 1)`);
    db.run(sql`insert into library_entries values (${ME}, 'book', 1, 1, null, 1)`);
    db.run(
      sql`insert into bookmarks values ('bm', ${ME}, 'book', 'primary:A/Novel/01.mp3', 400, 400, 'note', 1, 1)`,
    );

    await migrateSafely(db, () => migrate(db, { migrationsFolder: source }));

    const book = db.select().from(schema.books).get();
    expect(book).toMatchObject({
      id: 'book',
      rootId: 'root',
      source: 'local',
      coverUrl: null,
      addonItem: null,
    });
    expect(db.select().from(schema.bookFiles).all()).toHaveLength(1);
    expect(db.select().from(progress).get()).toMatchObject({ bookId: 'book', filePositionMs: 500 });
    expect(db.select().from(schema.bookmarks).all()).toHaveLength(1);
    expect(db.select().from(schema.addons).all()).toEqual([]);
    expect(db.select().from(schema.bookFiles).get()?.downloadPath).toBeNull();
    expect(db.select().from(schema.downloads).all()).toEqual([]);
  });
});
