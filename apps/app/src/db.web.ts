import { t } from './i18n';
import {
  ChunkedFile,
  type ChunkStore,
  createIdGenerator,
  type Db,
  migrateSafely,
  type SaveResult,
  schema,
} from '@lelap/core';
import migrations from '@lelap/core/migrations';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { drizzle } from 'drizzle-orm/sql-js';
import { getRandomBytes } from 'expo-crypto';
import { useEffect, useState } from 'react';
import initSqlJs, { type Database } from 'sql.js';

import { startupMark } from './startup';

// The web keeps SQLite in memory (sql.js) and saves it to the origin private file system (OPFS)
// shortly after each change, as chunk files of which only the changed ones are written (M67).
// expo-sqlite's web build needs cross-origin isolation, which would block covers and audio from
// other sites and does not work in Safari.
const FOLDER = 'library';
// The whole file, as saved before M67: read once, and removed after the first chunked save.
const OLD_FILE = 'lelap.db';
const SAVE_EVERY_MS = 1_000;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasmUrl = require('sql.js/dist/sql-wasm.wasm') as string | { uri: string };

let real: Db | null = null;
let sqlite: Database | null = null;
let saved: ChunkedFile | null = null;
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

async function readOldFile(root: FileSystemDirectoryHandle): Promise<Uint8Array | null> {
  try {
    const file = await (await root.getFileHandle(OLD_FILE)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

function chunkStore(dir: FileSystemDirectoryHandle): ChunkStore {
  return {
    read: async (name) => {
      try {
        const file = await (await dir.getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },
    write: async (name, bytes) => {
      // createWritable writes aside and swaps the file in on close, so it is never half new.
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    },
    remove: (name) => dir.removeEntry(name).catch(() => {}),
    list: async () => {
      const names: string[] = [];
      // `keys()` is in every browser with OPFS, but not yet in TypeScript's DOM types.
      for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
        names.push(name);
      }
      return names;
    },
  };
}

let saving: Promise<unknown> = Promise.resolve();

/** Saves the changed chunks, one save at a time: the timer and a hidden tab can both ask. */
function save(force = false): Promise<unknown> {
  saving = saving.then(() => saveNow(force)).catch(() => {});
  return saving;
}

async function saveNow(force: boolean): Promise<SaveResult | null> {
  if (!sqlite || !saved) return null;
  const changes = sqlite.exec('select total_changes()')[0]?.values[0]?.[0];
  if (typeof changes !== 'number' || (!force && changes === savedChanges)) return null;
  const result = await saved.save(sqlite.export());
  // Counted after the write, so a failed save is tried again on the next tick.
  savedChanges = changes;
  // For checking from the browser console how much a save wrote.
  if (__DEV__) Object.assign(globalThis, { lelapLastSave: result });
  return result;
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
    startupMark('db-open');
    if (!(await holdTabLock())) {
      throw new Error(t('Lelap is open in another tab or window. Close that one and reload this.'));
    }
    const SQL = await initSqlJs({
      locateFile: () => (typeof wasmUrl === 'string' ? wasmUrl : wasmUrl.uri),
    });
    startupMark('sqljs-ready');
    const root = await opfsRoot();
    saved = root
      ? new ChunkedFile(chunkStore(await root.getDirectoryHandle(FOLDER, { create: true })))
      : null;
    // A missing chunk throws here: starting empty would save over the rest of the library.
    const chunks = saved ? await saved.load() : null;
    const old = !chunks && root ? await readOldFile(root) : null;
    startupMark('db-read');
    sqlite = new SQL.Database(chunks ?? old ?? undefined);
    const database = drizzle(sqlite, { schema });
    real = database;
    // For poking at the library from the browser console while developing.
    if (__DEV__) Object.assign(globalThis, { lelapSql: sqlite });
    // The Expo migrator only uses Drizzle's dialect and session, which sql.js has as well.
    await migrateSafely(database, () =>
      migrate(database as unknown as ExpoSQLiteDatabase<typeof schema>, migrations),
    );
    startupMark('db-migrated');
    // In full when there are no chunks yet; otherwise only what the migrations changed.
    // Not through save(), which swallows errors: the old file goes only once the chunks are in.
    savedChanges = 0;
    await saveNow(chunks === null);
    // Also when an earlier start saved the chunks but closed before removing it.
    if (root) await root.removeEntry(OLD_FILE).catch(() => {});
    setInterval(() => void save(), SAVE_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void save();
    });
    // Ask the browser not to evict the library under storage pressure.
    void navigator.storage?.persist?.();
    startupMark('db-ready');
  })();
  return opening;
}

// Started as soon as this file loads, so reading the library overlaps the rest of the start
// instead of waiting for the first render (M106). The hook below reports how it went.
if (typeof window !== 'undefined') open().catch(() => {});

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
