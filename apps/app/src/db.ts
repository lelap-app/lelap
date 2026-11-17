import {
  createIdGenerator,
  type Db,
  migrateSafely,
  plainBox,
  schema,
  sealStoredSecrets,
  setSecretBox,
} from '@lelap/core';
import migrations from '@lelap/core/migrations';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { getRandomBytes } from 'expo-crypto';
import { openDatabaseSync } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { loadSecretBox } from './secrets';

const sqlite = openDatabaseSync('lelap.db');
sqlite.execSync('PRAGMA journal_mode = WAL;');

const expoDb = drizzle(sqlite, { schema });

export const db: Db = expoDb;

// Before anything reads the database, the UI and background runs alike. If the key store fails,
// sealed secrets stay unread this run and nothing is cleaned up, so nothing is lost.
let secretsLoaded = false;
try {
  setSecretBox(loadSecretBox());
  secretsLoaded = true;
} catch (error) {
  setSecretBox(plainBox);
  console.warn('The key store could not be read', error);
}

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
      () => {
        // Seals secrets older versions stored in plain text; notices ones this phone can't open.
        if (secretsLoaded) sealStoredSecrets(db, Date.now());
        setStatus({ ready: true, error: null });
      },
      (error: unknown) =>
        setStatus({
          ready: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }, []);
  return status;
}
