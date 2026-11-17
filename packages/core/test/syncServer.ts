import { type GroupInfo, type PulledMessage, type SyncClient, SyncError } from '../src/sync/client';
import { authHash } from '../src/sync/crypto';

type Group = {
  authHash: string;
  log: (PulledMessage & { at: number })[];
  snapshot: { covers: number; parts: string[] } | null;
  uploads: Map<number, string[]>;
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
    info: async (id, token, before): Promise<GroupInfo> => {
      const g = group(id, token);
      const older = g.log.filter((m) => m.at < before);
      const snapshotBytes = g.snapshot?.parts.reduce((sum, p) => sum + p.length, 0) ?? 0;
      return {
        bytes: bytesOf(g.log) + snapshotBytes,
        snapshot: g.snapshot ? { covers: g.snapshot.covers, parts: g.snapshot.parts.length } : null,
        older: { messages: older.length, bytes: bytesOf(older) },
      };
    },
    snapshot: async (id, token, from, limit) => {
      const g = group(id, token);
      if (!g.snapshot) return null;
      const { covers, parts } = g.snapshot;
      return { covers, parts: parts.length, data: parts.slice(from, from + limit) };
    },
    putSnapshotParts: async (id, token, covers, from, parts) => {
      const g = group(id, token);
      if (g.snapshot && covers <= g.snapshot.covers) throw new SyncError(409, 'Newer here.');
      const upload = g.uploads.get(covers) ?? [];
      parts.forEach((p, i) => (upload[from + i] = p));
      g.uploads.set(covers, upload);
    },
    commitSnapshot: async (id, token, covers, count) => {
      const g = group(id, token);
      const upload = g.uploads.get(covers);
      const last = g.log.at(-1)?.seq ?? 0;
      if (!upload || (g.snapshot && covers <= g.snapshot.covers) || covers > last) return false;
      const parts = upload.slice(0, count);
      if (parts.length !== count || parts.some((p) => p === undefined)) return false;
      g.snapshot = { covers, parts };
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
