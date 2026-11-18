import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import { EXPIRE_BATCH, type GroupRow, SQL, toGroup } from '../../../services/sync/src/sql';
import type { Message, SyncStore } from '../../../services/sync/src/store';

/** The sync store on Node's built-in SQLite, for self-hosting without D1. */
export function sqliteStore(db: DatabaseSync): SyncStore {
  const run = (sql: string, ...values: SQLInputValue[]) => db.prepare(sql).run(...values);
  /** Like a D1 batch: all or nothing. */
  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const dropGroup = (id: string) => {
    run(SQL.deleteMessages, id);
    run(SQL.deleteParts, id);
    run(SQL.deleteGroup, id);
  };
  return {
    async createGroup(id, authHash, now) {
      return Number(run(SQL.createGroup, id, authHash, now).changes) > 0;
    },
    async group(id) {
      const row = db.prepare(SQL.group).get(id) as GroupRow | undefined;
      return row ? toGroup(row) : null;
    },
    async deleteGroup(id) {
      transaction(() => dropGroup(id));
    },
    async append(id, device, messages, now) {
      transaction(() => {
        for (const data of messages) run(SQL.insertMessage, id, device, data, now);
        const bytes = messages.reduce((sum, m) => sum + m.length, 0);
        run(SQL.pushed, id, bytes, now);
      });
    },
    async read(id, after, limit) {
      return db.prepare(SQL.read).all(id, after, limit) as Message[];
    },
    async older(id, before) {
      return db.prepare(SQL.older).get(id, before) as { messages: number; bytes: number };
    },
    async readParts(id, upload, from, to) {
      const rows = db.prepare(SQL.readParts).all(id, upload, from, to) as { data: string }[];
      return rows.map((r) => r.data);
    },
    async stageParts(id, upload, covers, from, parts, maxBytes) {
      return transaction(() => {
        const staged = db.prepare(SQL.stagedBytes).get(id, upload, from, from + parts.length) as {
          bytes: number;
        };
        const size = parts.reduce((sum, p) => sum + p.length, 0);
        if (staged.bytes + size > maxBytes) return false;
        run(SQL.dropOtherUploads, id, covers, upload);
        parts.forEach((data, i) => run(SQL.putPart, id, upload, covers, from + i, data));
        run(SQL.recount, id);
        return true;
      });
    },
    async commitSnapshot(id, upload, covers, parts, now) {
      return transaction(() => {
        const committed = Number(run(SQL.commit, id, covers, parts, upload, now).changes) > 0;
        run(SQL.dropReplacedParts, id);
        run(SQL.dropCovered, id);
        run(SQL.recount, id);
        return committed;
      });
    },
    async expireIdle(before) {
      let removed = 0;
      for (;;) {
        const ids = db.prepare(SQL.idle).all(before, EXPIRE_BATCH) as { id: string }[];
        transaction(() => {
          for (const { id } of ids) {
            run(SQL.dropIdleMessages, id, before);
            run(SQL.dropIdleParts, id, before);
            removed += Number(run(SQL.dropIdleGroup, id, before).changes);
          }
        });
        if (ids.length < EXPIRE_BATCH) return removed;
      }
    },
    async putPairing(lookup, blob, expiresAt, now) {
      run(SQL.dropExpiredPairings, now);
      return Number(run(SQL.putPairing, lookup, blob, expiresAt).changes) > 0;
    },
    async takePairing(lookup, now) {
      const row = db.prepare(SQL.takePairing).get(lookup) as
        { blob: string; expires_at: number } | undefined;
      return row && row.expires_at >= now ? row.blob : null;
    },
    async dropExpiredPairings(now) {
      run(SQL.dropExpiredPairings, now);
    },
  };
}

/** Applies the D1 migrations that have not run yet. */
export function migrate(db: DatabaseSync, migrations: Record<string, string>): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)');
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  );
  for (const [name, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    if (applied.has(name)) continue;
    // In one transaction, so a migration that fails halfway runs again whole on the next start.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations VALUES (?, ?)').run(name, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
