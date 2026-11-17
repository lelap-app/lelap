/** Where the sync server keeps its data: D1 on Workers, Node's SQLite in Docker. */
export type Message = { seq: number; device: string; data: string; at: number };

export type Group = {
  authHash: string;
  /** Messages and snapshot parts together, for the group cap. */
  bytes: number;
  /** The last message the snapshot covers; 0 without a snapshot. */
  snapshotSeq: number;
  snapshotParts: number;
  lastPushAt: number;
};

export type SyncStore = {
  createGroup(id: string, authHash: string, now: number): Promise<boolean>;
  group(id: string): Promise<Group | null>;
  deleteGroup(id: string): Promise<void>;
  append(id: string, device: string, messages: string[], now: number): Promise<void>;
  read(id: string, after: number, limit: number): Promise<Message[]>;
  /** How many messages, and how many bytes of them, arrived before `before`. */
  older(id: string, before: number): Promise<{ messages: number; bytes: number }>;
  /** Parts `from` up to `to` of the snapshot that covers `covers`, in order. */
  readParts(id: string, covers: number, from: number, to: number): Promise<string[]>;
  /**
   * Stores parts of a snapshot upload. False, storing nothing, when the upload would grow past
   * `maxBytes`.
   */
  stageParts(
    id: string,
    covers: number,
    from: number,
    parts: string[],
    maxBytes: number,
  ): Promise<boolean>;
  /**
   * Makes a complete upload the group's snapshot and drops the messages it covers and the
   * snapshot it replaces. False when it is not newer, not complete, or covers nothing.
   */
  commitSnapshot(id: string, covers: number, parts: number, now: number): Promise<boolean>;
  /** Deletes groups no device pushed to since `before`; returns how many. */
  expireIdle(before: number): Promise<number>;
  putPairing(lookup: string, blob: string, expiresAt: number, now: number): Promise<boolean>;
  takePairing(lookup: string, now: number): Promise<string | null>;
  dropExpiredPairings(now: number): Promise<void>;
};
