import { createIdGenerator, type Db, schema } from '@lelap/core';
import migrations from '@lelap/core/migrations';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { getRandomBytes } from 'expo-crypto';
import { openDatabaseSync } from 'expo-sqlite';

const sqlite = openDatabaseSync('lelap.db');
// Core relies on cascades when a rescan regroups books, so foreign keys must be on.
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const expoDb = drizzle(sqlite, { schema });

export const db: Db = expoDb;

export const newId = createIdGenerator((n) => getRandomBytes(n));

/** Runs pending migrations once; screens wait for `success`. */
export function useDbReady(): { ready: boolean; error: Error | null } {
  const { success, error } = useMigrations(expoDb, migrations);
  return { ready: success, error: error ?? null };
}
