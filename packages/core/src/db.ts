import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

/** A synchronous Drizzle SQLite database: expo-sqlite in the app, sql.js in tests. */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
