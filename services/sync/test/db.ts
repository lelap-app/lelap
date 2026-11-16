import { type Db, schema } from '@lelap/core';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs from 'sql.js';

const SQL = await initSqlJs();
const migrationsFolder = decodeURIComponent(
  new URL('../../../packages/core/drizzle', import.meta.url).pathname,
);

/** An app database in memory, for driving the real sync engine against this server. */
export function appDb(): Db {
  const db = drizzle(new SQL.Database(), { schema });
  migrate(db, { migrationsFolder });
  db.run('pragma foreign_keys = on');
  return db;
}
