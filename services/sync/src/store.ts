/** Where the sync server keeps its data: D1 on Workers, memory in tests. */
export type Message = { seq: number; device: string; data: string };

export type SyncStore = {
  createGroup(id: string, authHash: string, now: number): Promise<boolean>;
  group(id: string): Promise<{ authHash: string; bytes: number } | null>;
  deleteGroup(id: string): Promise<void>;
  append(id: string, device: string, messages: string[], now: number): Promise<void>;
  read(id: string, after: number, limit: number): Promise<Message[]>;
  putPairing(lookup: string, blob: string, expiresAt: number, now: number): Promise<boolean>;
  takePairing(lookup: string, now: number): Promise<string | null>;
};

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

export function memoryStore(): SyncStore {
  const groups = new Map<string, { authHash: string; bytes: number }>();
  const messages: (Message & { group: string })[] = [];
  const pairings = new Map<string, { blob: string; expiresAt: number }>();
  let seq = 0;
  return {
    createGroup: async (id, authHash) => {
      if (groups.has(id)) return false;
      groups.set(id, { authHash, bytes: 0 });
      return true;
    },
    group: async (id) => groups.get(id) ?? null,
    deleteGroup: async (id) => {
      groups.delete(id);
      for (let i = messages.length - 1; i >= 0; i--)
        if (messages[i]?.group === id) messages.splice(i, 1);
    },
    append: async (id, device, list) => {
      for (const data of list) messages.push({ seq: ++seq, group: id, device, data });
      const g = groups.get(id);
      if (g) g.bytes += list.reduce((sum, m) => sum + m.length, 0);
    },
    read: async (id, after, limit) =>
      messages
        .filter((m) => m.group === id && m.seq > after)
        .slice(0, limit)
        .map(({ seq: s, device, data }) => ({ seq: s, device, data })),
    putPairing: async (lookup, blob, expiresAt) => {
      if (pairings.has(lookup)) return false;
      pairings.set(lookup, { blob, expiresAt });
      return true;
    },
    takePairing: async (lookup, now) => {
      const found = pairings.get(lookup);
      pairings.delete(lookup);
      return found && found.expiresAt >= now ? found.blob : null;
    },
  };
}
