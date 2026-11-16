import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs from 'sql.js';

import type { Db } from '../src/db';
import * as schema from '../src/schema';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const SQL = await initSqlJs();

/** A fresh in-memory database with every migration applied. */
export function createTestDb(): Db {
  const db = drizzle(new SQL.Database(), { schema });
  db.run('pragma foreign_keys = on');
  migrate(db, { migrationsFolder });
  return db;
}
