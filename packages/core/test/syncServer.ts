import { type GroupInfo, type PulledMessage, type SyncClient, SyncError } from '../src/sync/client';
import { authHash } from '../src/sync/crypto';

type Group = {
  authHash: string;
  log: (PulledMessage & { at: number })[];
  snapshot: { covers: number; upload: string; parts: string[] } | null;
  uploads: Map<string, { covers: number; parts: string[] }>;
};

/**
 * The sync server's behaviour, in memory: groups, an append-only log with snapshots that replace
 * the messages they cover, single-use pairings. `clock.now` dates the messages.
 */
export function fakeSyncServer(clock = { now: 0 }) {
  const groups = new Map<string, Group>();
  const pairings = new Map<string, string>();
  const group = (id: string, token: string) => {
    const g = groups.get(id);
    if (!g || g.authHash !== authHash(token)) throw new SyncError(403, 'Not allowed.');
    return g;
  };
  const bytesOf = (list: { data: string }[]) => list.reduce((sum, m) => sum + m.data.length, 0);
  let seq = 0;
  const client: SyncClient = {
    createGroup: async (id, hash) =>
      void groups.set(id, { authHash: hash, log: [], snapshot: null, uploads: new Map() }),
    push: async (id, token, device, messages) => {
      const g = group(id, token);
      // The real server's limits: 50 messages per push, 256 KB each.
      if (messages.length > 50 || messages.some((m) => m.length > 256 * 1024)) {
        throw new SyncError(400, 'Send a device ID and up to 50 sealed messages.');
      }
      for (const data of messages) g.log.push({ seq: ++seq, device, data, at: clock.now });
    },
    pull: async (id, token, after, limit) => {
      const g = group(id, token);
      if (g.snapshot && after < g.snapshot.covers) {
        throw new SyncError(410, 'Update Lelap to keep syncing.', g.snapshot.covers);
      }
      const messages = g.log.filter((m) => m.seq > after).slice(0, limit);
      return { messages, last: messages.at(-1)?.seq ?? after };
    },
    info: async (id, token, keepMs): Promise<GroupInfo> => {
      const g = group(id, token);
      const before = clock.now - keepMs;
      const older = g.log.filter((m) => m.at < before);
      const snapshotBytes = g.snapshot?.parts.reduce((sum, p) => sum + p.length, 0) ?? 0;
      return {
        bytes: bytesOf(g.log) + snapshotBytes,
        snapshot: g.snapshot ? { covers: g.snapshot.covers, parts: g.snapshot.parts.length } : null,
        before,
        older: { messages: older.length, bytes: bytesOf(older) },
      };
    },
    snapshot: async (id, token, from, limit) => {
      const g = group(id, token);
      if (!g.snapshot) return null;
      const { covers, upload, parts } = g.snapshot;
      return { covers, upload, parts: parts.length, data: parts.slice(from, from + limit) };
    },
    putSnapshotParts: async (id, token, upload, covers, from, parts) => {
      const g = group(id, token);
      if (g.snapshot && covers <= g.snapshot.covers) throw new SyncError(409, 'Newer here.');
      const staged = g.uploads.get(upload) ?? { covers, parts: [] };
      parts.forEach((p, i) => (staged.parts[from + i] = p));
      g.uploads.set(upload, staged);
    },
    commitSnapshot: async (id, token, upload, covers, count) => {
      const g = group(id, token);
      const staged = g.uploads.get(upload);
      const last = g.log.at(-1)?.seq ?? 0;
      if (!staged || staged.covers !== covers) return false;
      if ((g.snapshot && covers <= g.snapshot.covers) || covers > last) return false;
      const parts = staged.parts.slice(0, count);
      if (parts.length !== count || parts.some((p) => p === undefined)) return false;
      g.snapshot = { covers, upload, parts };
      g.uploads.clear();
      g.log = g.log.filter((m) => m.seq > covers);
      return true;
    },
    leave: async (id, token) => {
      group(id, token);
      groups.delete(id);
    },
    putPairing: async (lookup, blob) => void pairings.set(lookup, blob),
    takePairing: async (lookup) => {
      const blob = pairings.get(lookup) ?? null;
      pairings.delete(lookup);
      return blob;
    },
  };
  return {
    ...client,
    clock,
    /** Everything the server holds, sealed. */
    stored: () =>
      [...groups.values()].flatMap((g) => [
        ...g.log.map((m) => m.data),
        ...(g.snapshot?.parts ?? []),
      ]),
    log: (id: string) => groups.get(id)?.log ?? [],
  };
}
