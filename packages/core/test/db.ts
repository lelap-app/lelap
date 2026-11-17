import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs, { type BindParams } from 'sql.js';

import type { Db } from '../src/db';
import * as schema from '../src/schema';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const SQL = await initSqlJs();

/** A fresh in-memory database with every migration applied and foreign keys on, like the app. */
export function createTestDb(): Db {
  return createPlannedDb().db;
}

/**
 * A test database that can tell how SQLite runs the queries a function makes: `plans` returns
 * each query with its `EXPLAIN QUERY PLAN` lines, such as `SEARCH episodes USING INDEX …`.
 */
export function createPlannedDb() {
  const sqlite = new SQL.Database();
  let log: { sql: string; params: unknown[] }[] | null = null;
  const database = drizzle(sqlite, {
    schema,
    logger: { logQuery: (sql, params) => log?.push({ sql, params }) },
  });
  migrate(database, { migrationsFolder });
  database.run('pragma foreign_keys = on');
  const db: Db = database;

  const plans = (run: () => unknown) => {
    log = [];
    run();
    const queries = log;
    log = null;
    return queries.map(({ sql, params }) => {
      const result = sqlite.exec(`explain query plan ${sql}`, params as BindParams)[0];
      return { sql, plan: (result?.values ?? []).map((row) => String(row[3])) };
    });
  };
  return { db, plans };
}
