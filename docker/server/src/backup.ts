import { copyFileSync, existsSync, linkSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * Copies the sync database to `target` while the server runs: SQLite's online backup, so the
 * copy is whole even when devices push during it.
 */
export async function backupSync(file: string, target?: string, now = new Date()): Promise<string> {
  const to = target ?? join(dirname(file), 'backups', `sync-${stamp(now)}.db`);
  if (existsSync(to)) throw new Error(`${to} exists already.`);
  mkdirSync(dirname(to), { recursive: true });
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    await backup(db, to);
  } finally {
    db.close();
  }
  // The copy inherits WAL mode, and SQLite can't open a WAL file in a read-only folder.
  const copy = new DatabaseSync(to);
  try {
    copy.exec('PRAGMA journal_mode = DELETE');
  } finally {
    copy.close();
  }
  return to;
}

/**
 * Throws unless `file` is an intact sync database. Never writes, so a read-only mount works.
 * With `known` (the image's migrations), also throws for a database from a newer image.
 */
export function verifySync(file: string, known?: readonly string[]): { groups: number } {
  if (!existsSync(file)) throw new Error(`${file} does not exist.`);
  // `immutable`: no locks and no -shm, even for a backup still in WAL mode.
  const db = new DatabaseSync(`file:${encodeURI(file)}?immutable=1`, { readOnly: true });
  try {
    const { integrity_check } = db.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string;
    };
    if (integrity_check !== 'ok') throw new Error(`${file} is damaged: ${integrity_check}`);
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((r) => r.name),
    );
    for (const name of ['groups', 'messages', 'pairings', '_migrations']) {
      if (!tables.has(name)) throw new Error(`${file} is not a sync database: no ${name} table.`);
    }
    if (known) {
      const newer = (db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
        .map((r) => r.name)
        .filter((name) => !known.includes(name));
      if (newer.length > 0) {
        throw new Error(
          `${file} comes from a newer Lelap (${newer.join(', ')}). Restore it with that version.`,
        );
      }
    }
    return db.prepare('SELECT COUNT(*) AS groups FROM groups').get() as { groups: number };
  } finally {
    db.close();
  }
}

/**
 * Throws when another process has the database open, as the sync server does while it runs.
 * Closing this connection, the last one, also folds the WAL into the file.
 */
function ensureStopped(file: string): void {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  } catch {
    throw new Error(`${file} is in use. Stop sync first: docker compose stop sync`);
  } finally {
    db.close();
  }
}

/**
 * Puts a backup in place of the sync database, with the sync server stopped. The database it
 * replaces stays next to it as `sync.db.replaced-<time>`.
 */
export function restoreSync(
  file: string,
  source: string,
  known?: readonly string[],
  now = new Date(),
): { groups: number } {
  const checked = verifySync(source, known);
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) ensureStopped(file);
  const incoming = `${file}.restoring`;
  copyFileSync(source, incoming);
  try {
    skipAhead(incoming);
    if (existsSync(file)) linkSync(file, `${file}.replaced-${stamp(now)}`);
    // Left behind, the old database's WAL would be applied to the new one.
    for (const suffix of ['-wal', '-shm']) rmSync(file + suffix, { force: true });
    // One rename: at every moment there is a whole sync.db, old or new.
    renameSync(incoming, file);
  } catch (error) {
    rmSync(incoming, { force: true });
    throw error;
  }
  return checked;
}

/** How far a restore moves message numbers ahead. */
export const RESTORE_SKIP = 1_000_000_000;

/**
 * Devices that synced after the backup have read message numbers the backup never reached. New
 * messages must come after those, or the devices would skip them as already read.
 */
function skipAhead(file: string): void {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = DELETE');
    const moved = db
      .prepare("UPDATE sqlite_sequence SET seq = seq + ? WHERE name = 'messages'")
      .run(RESTORE_SKIP);
    if (Number(moved.changes) === 0) {
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('messages', ?)").run(
        RESTORE_SKIP,
      );
    }
  } finally {
    db.close();
  }
}
