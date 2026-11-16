import { sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

/** A synchronous Drizzle SQLite database: expo-sqlite in the app, sql.js in tests. */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * Runs migrations with foreign keys off, then switches them on. drizzle-kit rebuilds tables to
 * change them, inside a transaction where turning foreign keys off has no effect, so with them on
 * dropping `books` would cascade into every saved place.
 */
export async function migrateSafely(db: Db, migrate: () => unknown): Promise<void> {
  db.run(sql`pragma foreign_keys = off`);
  await migrate();
  db.run(sql`pragma foreign_keys = on`);
}
