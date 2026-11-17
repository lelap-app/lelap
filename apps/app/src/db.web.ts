import { t } from './i18n';
import { createIdGenerator, type Db, migrateSafely, schema } from '@lelap/core';
import migrations from '@lelap/core/migrations';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { drizzle } from 'drizzle-orm/sql-js';
import { getRandomBytes } from 'expo-crypto';
import { useEffect, useState } from 'react';
import initSqlJs, { type Database } from 'sql.js';

// The web keeps SQLite in memory (sql.js) and writes the whole file to the origin private file
// system (OPFS) shortly after each change. expo-sqlite's web build needs cross-origin isolation,
// which would block covers and audio from other sites and does not work in Safari.
const FILE = 'lelap.db';
const SAVE_EVERY_MS = 1_000;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasmUrl = require('sql.js/dist/sql-wasm.wasm') as string | { uri: string };

let real: Db | null = null;
let sqlite: Database | null = null;
let savedChanges = 0;

// No setSecretBox here: browsers have no key store a page's own scripts can't read, so secrets
// stay as stored (core's plain box) and the Content-Security-Policy keeps other scripts out.

/** The database, usable once `useDbReady` says so; the same Drizzle API as on Android. */
export const db: Db = new Proxy({} as Db, {
  get(_, key) {
    if (!real) throw new Error('The database is not open yet.');
    const value: unknown = Reflect.get(real, key);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export const newId = createIdGenerator((n) => getRandomBytes(n));

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function readSaved(): Promise<Uint8Array | null> {
  const root = await opfsRoot();
  if (!root) return null;
  try {
    const file = await (await root.getFileHandle(FILE)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function save(): Promise<void> {
  if (!sqlite) return;
  const changes = sqlite.exec('select total_changes()')[0]?.values[0]?.[0];
  if (typeof changes !== 'number' || changes === savedChanges) return;
  const root = await opfsRoot();
  if (!root) return;
  const bytes = sqlite.export();
  // export() resets total_changes, so count from zero again.
  savedChanges = 0;
  const writable = await (await root.getFileHandle(FILE, { create: true })).createWritable();
  await writable.write(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  await writable.close();
}

/**
 * Each tab would keep its own copy in memory and overwrite the other's file, so only one tab
 * opens the library. The lock is held until the tab closes.
 */
function holdTabLock(): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request('lelap-library', { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      // Never settles: the lock goes when the tab does.
      return lock ? new Promise<void>(() => {}) : undefined;
    });
  });
}

let opening: Promise<void> | null = null;

function open(): Promise<void> {
  opening ??= (async () => {
    if (!(await holdTabLock())) {
      throw new Error(t('Lelap is open in another tab or window. Close that one and reload this.'));
    }
    const SQL = await initSqlJs({
      locateFile: () => (typeof wasmUrl === 'string' ? wasmUrl : wasmUrl.uri),
    });
    sqlite = new SQL.Database((await readSaved()) ?? undefined);
    const database = drizzle(sqlite, { schema });
    real = database;
    // For poking at the library from the browser console while developing.
    if (__DEV__) Object.assign(globalThis, { lelapSql: sqlite });
    // The Expo migrator only uses Drizzle's dialect and session, which sql.js has as well.
    await migrateSafely(database, () =>
      migrate(database as unknown as ExpoSQLiteDatabase<typeof schema>, migrations),
    );
    // Written only when the migrations changed something (on a new device they always do): a big
    // library is tens of megabytes, too much to export and write again on every start.
    savedChanges = 0;
    await save();
    setInterval(() => void save(), SAVE_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void save();
    });
    // Ask the browser not to evict the library under storage pressure.
    void navigator.storage?.persist?.();
  })();
  return opening;
}

export function useDbReady(): { ready: boolean; error: Error | null } {
  const [status, setStatus] = useState<{ ready: boolean; error: Error | null }>({
    ready: false,
    error: null,
  });
  useEffect(() => {
    open().then(
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
