import type { SqlAll } from '@lelap/core';
import initSqlJs from 'sql.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasmUrl = require('sql.js/dist/sql-wasm.wasm') as string | { uri: string };

/** Opens another app's SQLite export in memory, read only for our purposes. */
export async function openSqliteFile(
  bytes: Uint8Array,
): Promise<{ all: SqlAll; close: () => Promise<void> }> {
  const SQL = await initSqlJs({
    locateFile: () => (typeof wasmUrl === 'string' ? wasmUrl : wasmUrl.uri),
  });
  const database = new SQL.Database(bytes);
  return {
    all: (sql) => {
      const [result] = database.exec(sql);
      const rows = result
        ? result.values.map((row) =>
            Object.fromEntries(result.columns.map((column, i) => [column, row[i] as unknown])),
          )
        : [];
      return Promise.resolve(rows);
    },
    close: () => {
      database.close();
      return Promise.resolve();
    },
  };
}
