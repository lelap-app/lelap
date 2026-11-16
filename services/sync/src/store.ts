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
