import type { Message, SyncStore } from './store';

/** The sync store on Cloudflare D1. */
export function d1Store(db: D1Database): SyncStore {
  return {
    async createGroup(id, authHash, now) {
      const result = await db
        .prepare('INSERT OR IGNORE INTO groups (id, auth_hash, created_at) VALUES (?, ?, ?)')
        .bind(id, authHash, now)
        .run();
      return result.meta.changes > 0;
    },
    async group(id) {
      const row = await db
        .prepare('SELECT auth_hash, bytes FROM groups WHERE id = ?')
        .bind(id)
        .first<{ auth_hash: string; bytes: number }>();
      return row ? { authHash: row.auth_hash, bytes: row.bytes } : null;
    },
    async deleteGroup(id) {
      await db.batch([
        db.prepare('DELETE FROM messages WHERE group_id = ?').bind(id),
        db.prepare('DELETE FROM groups WHERE id = ?').bind(id),
      ]);
    },
    async append(id, device, messages, now) {
      const bytes = messages.reduce((sum, m) => sum + m.length, 0);
      await db.batch([
        ...messages.map((data) =>
          db
            .prepare(
              'INSERT INTO messages (group_id, device, data, created_at) VALUES (?, ?, ?, ?)',
            )
            .bind(id, device, data, now),
        ),
        db.prepare('UPDATE groups SET bytes = bytes + ? WHERE id = ?').bind(bytes, id),
      ]);
    },
    async read(id, after, limit) {
      const { results } = await db
        .prepare(
          'SELECT seq, device, data FROM messages WHERE group_id = ? AND seq > ? ORDER BY seq LIMIT ?',
        )
        .bind(id, after, limit)
        .all<Message>();
      return results;
    },
    async putPairing(lookup, blob, expiresAt, now) {
      await db.prepare('DELETE FROM pairings WHERE expires_at < ?').bind(now).run();
      const result = await db
        .prepare('INSERT OR IGNORE INTO pairings (lookup, blob, expires_at) VALUES (?, ?, ?)')
        .bind(lookup, blob, expiresAt)
        .run();
      return result.meta.changes > 0;
    },
    async takePairing(lookup, now) {
      const row = await db
        .prepare('DELETE FROM pairings WHERE lookup = ? RETURNING blob, expires_at')
        .bind(lookup)
        .first<{ blob: string; expires_at: number }>();
      return row && row.expires_at >= now ? row.blob : null;
    },
  };
}
