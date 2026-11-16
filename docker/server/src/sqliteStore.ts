import type { DatabaseSync } from 'node:sqlite';

import type { Message, SyncStore } from '../../../services/sync/src/store';

/** The sync store on Node's built-in SQLite, for self-hosting without D1. */
export function sqliteStore(db: DatabaseSync): SyncStore {
  return {
    async createGroup(id, authHash, now) {
      const result = db
        .prepare('INSERT OR IGNORE INTO groups (id, auth_hash, created_at) VALUES (?, ?, ?)')
        .run(id, authHash, now);
      return Number(result.changes) > 0;
    },
    async group(id) {
      const row = db.prepare('SELECT auth_hash, bytes FROM groups WHERE id = ?').get(id) as
        { auth_hash: string; bytes: number } | undefined;
      return row ? { authHash: row.auth_hash, bytes: row.bytes } : null;
    },
    async deleteGroup(id) {
      db.prepare('DELETE FROM messages WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    },
    async append(id, device, messages, now) {
      const insert = db.prepare(
        'INSERT INTO messages (group_id, device, data, created_at) VALUES (?, ?, ?, ?)',
      );
      db.exec('BEGIN');
      try {
        for (const data of messages) insert.run(id, device, data, now);
        const bytes = messages.reduce((sum, m) => sum + m.length, 0);
        db.prepare('UPDATE groups SET bytes = bytes + ? WHERE id = ?').run(bytes, id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async read(id, after, limit) {
      return db
        .prepare(
          'SELECT seq, device, data FROM messages WHERE group_id = ? AND seq > ? ORDER BY seq LIMIT ?',
        )
        .all(id, after, limit) as Message[];
    },
    async putPairing(lookup, blob, expiresAt, now) {
      db.prepare('DELETE FROM pairings WHERE expires_at < ?').run(now);
      const result = db
        .prepare('INSERT OR IGNORE INTO pairings (lookup, blob, expires_at) VALUES (?, ?, ?)')
        .run(lookup, blob, expiresAt);
      return Number(result.changes) > 0;
    },
    async takePairing(lookup, now) {
      const row = db
        .prepare('DELETE FROM pairings WHERE lookup = ? RETURNING blob, expires_at')
        .get(lookup) as { blob: string; expires_at: number } | undefined;
      return row && row.expires_at >= now ? row.blob : null;
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
    db.exec(sql);
    db.prepare('INSERT INTO _migrations VALUES (?, ?)').run(name, Date.now());
  }
}
