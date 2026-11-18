import { EXPIRE_BATCH, type GroupRow, SQL, toGroup } from './sql';
import type { Message, SyncStore } from './store';

/** The sync store on Cloudflare D1. A batch runs as one transaction. */
export function d1Store(db: D1Database): SyncStore {
  const q = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values);
  return {
    async createGroup(id, authHash, now) {
      const result = await q(SQL.createGroup, id, authHash, now).run();
      return result.meta.changes > 0;
    },
    async group(id) {
      const row = await q(SQL.group, id).first<GroupRow>();
      return row ? toGroup(row) : null;
    },
    async deleteGroup(id) {
      await db.batch([q(SQL.deleteMessages, id), q(SQL.deleteParts, id), q(SQL.deleteGroup, id)]);
    },
    async append(id, device, messages, now) {
      const bytes = messages.reduce((sum, m) => sum + m.length, 0);
      await db.batch([
        ...messages.map((data) => q(SQL.insertMessage, id, device, data, now)),
        q(SQL.pushed, id, bytes, now),
      ]);
    },
    async read(id, after, limit) {
      const { results } = await q(SQL.read, id, after, limit).all<Message>();
      return results;
    },
    async seen(id, now) {
      await q(SQL.seen, id, now).run();
    },
    async older(id, before) {
      const row = await q(SQL.older, id, before).first<{ messages: number; bytes: number }>();
      return row ?? { messages: 0, bytes: 0 };
    },
    async readParts(id, upload, from, to) {
      const { results } = await q(SQL.readParts, id, upload, from, to).all<{ data: string }>();
      return results.map((r) => r.data);
    },
    async stageParts(id, upload, covers, from, parts, maxBytes) {
      const staged = await q(SQL.stagedBytes, id, upload, from, from + parts.length).first<{
        bytes: number;
      }>();
      const size = parts.reduce((sum, p) => sum + p.length, 0);
      if ((staged?.bytes ?? 0) + size > maxBytes) return false;
      await db.batch([
        q(SQL.dropOtherUploads, id, covers, upload),
        ...parts.map((data, i) => q(SQL.putPart, id, upload, covers, from + i, data)),
        q(SQL.recount, id),
      ]);
      return true;
    },
    async commitSnapshot(id, upload, covers, parts, now) {
      const [commit] = await db.batch([
        q(SQL.commit, id, covers, parts, upload, now),
        q(SQL.dropReplacedParts, id),
        q(SQL.dropCovered, id),
        q(SQL.recount, id),
      ]);
      return (commit?.meta.changes ?? 0) > 0;
    },
    async expireIdle(before) {
      let removed = 0;
      for (;;) {
        const { results } = await q(SQL.idle, before, EXPIRE_BATCH).all<{ id: string }>();
        if (results.length === 0) return removed;
        const done = await db.batch(
          results.flatMap(({ id }) => [
            q(SQL.dropIdleMessages, id, before),
            q(SQL.dropIdleParts, id, before),
            q(SQL.dropIdleGroup, id, before),
          ]),
        );
        removed += done.filter((r, i) => i % 3 === 2 && r.meta.changes > 0).length;
        if (results.length < EXPIRE_BATCH) return removed;
      }
    },
    async putPairing(lookup, blob, expiresAt, now) {
      await q(SQL.dropExpiredPairings, now).run();
      const result = await q(SQL.putPairing, lookup, blob, expiresAt).run();
      return result.meta.changes > 0;
    },
    async takePairing(lookup, now) {
      const row = await q(SQL.takePairing, lookup).first<{ blob: string; expires_at: number }>();
      return row && row.expires_at >= now ? row.blob : null;
    },
    async dropExpiredPairings(now) {
      await q(SQL.dropExpiredPairings, now).run();
    },
  };
}
