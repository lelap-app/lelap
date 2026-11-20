import { sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { unwatchBookChanges, watchBookChanges } from './library/bookChanges';
import type * as schema from './schema';

/** A synchronous Drizzle SQLite database: expo-sqlite in the app, sql.js in tests. */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * Runs migrations with foreign keys off, then switches them on. drizzle-kit rebuilds tables to
 * change them, inside a transaction where turning foreign keys off has no effect, so with them on
 * dropping `books` would cascade into every saved place. The Library's change triggers (M126)
 * are dropped for the migrations and made again after.
 */
export async function migrateSafely(db: Db, migrate: () => unknown): Promise<void> {
  db.run(sql`pragma foreign_keys = off`);
  // Before the first migration there are no tables for the triggers yet.
  if (hasTable(db, 'book_changes')) unwatchBookChanges(db);
  await migrate();
  watchBookChanges(db);
  db.run(sql`pragma foreign_keys = on`);
}

const hasTable = (db: Db, name: string) =>
  db.all(sql`select 1 from sqlite_master where type = 'table' and name = ${name}`).length > 0;
