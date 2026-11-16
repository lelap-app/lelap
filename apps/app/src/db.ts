import { createIdGenerator, type Db, migrateSafely, schema } from '@lelap/core';
import migrations from '@lelap/core/migrations';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { getRandomBytes } from 'expo-crypto';
import { openDatabaseSync } from 'expo-sqlite';
import { useEffect, useState } from 'react';

const sqlite = openDatabaseSync('lelap.db');
sqlite.execSync('PRAGMA journal_mode = WAL;');

const expoDb = drizzle(sqlite, { schema });

export const db: Db = expoDb;

export const newId = createIdGenerator((n) => getRandomBytes(n));

/**
 * Runs pending migrations once, then switches foreign keys on (core relies on cascades when a
 * rescan regroups books). Screens wait for `ready`.
 */
export function useDbReady(): { ready: boolean; error: Error | null } {
  const [status, setStatus] = useState<{ ready: boolean; error: Error | null }>({
    ready: false,
    error: null,
  });
  useEffect(() => {
    migrateSafely(db, () => migrate(expoDb, migrations)).then(
      () => setStatus({ ready: true, error: null }),
      (error: unknown) =>
        setStatus({
          ready: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }, []);
  return status;
}
