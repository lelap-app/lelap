import type { SqlAll } from '@lelap/core';
import { deserializeDatabaseAsync } from 'expo-sqlite';

/** Opens another app's SQLite export in memory, read only for our purposes. */
export async function openSqliteFile(
  bytes: Uint8Array,
): Promise<{ all: SqlAll; close: () => Promise<void> }> {
  const database = await deserializeDatabaseAsync(bytes);
  return {
    all: (sql) => database.getAllAsync<Record<string, unknown>>(sql),
    close: () => database.closeAsync(),
  };
}
