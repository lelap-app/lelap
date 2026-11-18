import { utf8ToBytes } from '@noble/ciphers/utils.js';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { open, type Random, seal } from './crypto';
import { bookKey } from './keys';
import { applyOps, type Handoff, knownOp, type Op } from './ops';

// A snapshot is the group's state up to one message, as operations: for each row only the newest
// change. The server keeps the newest snapshot and drops the messages it covers, so the log stops
// growing; a new device starts from the snapshot instead of replaying every message.

/** Operations one device sent, with the name it had then (for “Continue from …?”). */
export type SnapshotEntry = { device: string; name: string; ops: Op[] };

type Part = { v: 1; entries: SnapshotEntry[] };

/** Plain text per part; sealed and in base64 a part stays under the server's 256 KB. */
const PART_BYTES = 180_000;

const size = (value: unknown) => utf8ToBytes(JSON.stringify(value)).length;

/** The row an operation changes. A deletion is its own row, so a later re-add still wins. */
function rowOf(op: Op): string {
  if (op.type === 'delete') return `delete\u0000${op.kind}\u0000${op.profile}\u0000${op.key}`;
  return `${op.type}\u0000${'profile' in op ? op.profile : ''}\u0000${op.key}`;
}

/**
 * The row of an operation this version does not know, by the protocol's rule that the newest
 * change to a row wins; null when it doesn't look like a row change, so it is kept as it is.
 */
function unknownRowOf(op: Record<string, unknown>): string | null {
  const { type, profile, key, kind, at } = op;
  if (typeof type !== 'string' || typeof key !== 'string' || typeof at !== 'number') return null;
  const profilePart = typeof profile === 'string' ? profile : '';
  const kindPart = typeof kind === 'string' ? kind : '';
  return `?${type}\u0000${kindPart}\u0000${profilePart}\u0000${key}`;
}

/**
 * At most this many operations of unknown types stay in a snapshot, the newest. Only a version
 * that knows them can fold them; until one compacts, they would otherwise grow with every
 * snapshot an older version writes.
 */
export const MAX_UNKNOWN_OPS = 20_000;

type Held = { device: string; name: string; op: Op };

const newer = (a: Held, b: Held) => a.op.at > b.op.at;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Folds operations into the newest per row, with the result applying them in order would have:
 * on equal times the first stays, and fields a newer change leaves out (older app versions do)
 * keep their older value. Types this version does not know are folded the same way when they
 * look like row changes, and capped at MAX_UNKNOWN_OPS.
 */
export function snapshotReducer(maxUnknown = MAX_UNKNOWN_OPS) {
  const rows = new Map<string, Held>();
  const unknown: Held[] = [];
  const fold = (row: string, next: Held) => {
    const held = rows.get(row);
    if (held && !newer(next, held)) return;
    const { op } = next;
    const merged =
      held && 'data' in held.op && 'data' in op && isRecord(held.op.data) && isRecord(op.data)
        ? ({ ...op, data: { ...held.op.data, ...op.data } } as Op)
        : op;
    rows.set(row, { ...next, op: merged });
  };
  return {
    add(device: string, name: string, ops: Op[]): void {
      for (const op of ops) {
        if (typeof op !== 'object' || op === null) continue;
        if (knownOp(op)) {
          fold(rowOf(op), { device, name, op });
          continue;
        }
        const row = unknownRowOf(op as unknown as Record<string, unknown>);
        if (row === null) unknown.push({ device, name, op });
        else fold(row, { device, name, op });
      }
    },
    entries(): SnapshotEntry[] {
      const known: Held[] = [];
      const others: Held[] = [...unknown];
      for (const [row, held] of rows) (row.startsWith('?') ? others : known).push(held);
      // The newest stay; the order among them is the order they came in.
      let kept = others;
      if (others.length > maxUnknown) {
        const at = (h: Held) => (typeof h.op.at === 'number' ? h.op.at : 0);
        const cut = new Set([...others].sort((a, b) => at(b) - at(a)).slice(0, maxUnknown));
        kept = others.filter((h) => cut.has(h));
      }
      const byDevice = new Map<string, SnapshotEntry>();
      for (const { device, name, op } of [...known, ...kept]) {
        const id = `${device}\u0000${name}`;
        const entry = byDevice.get(id) ?? { device, name, ops: [] };
        entry.ops.push(op);
        byDevice.set(id, entry);
      }
      return [...byDevice.values()];
    },
  };
}

/**
 * Each part is bound to its group, the message it covers, its upload (a random ID, so parts of
 * two devices' snapshots never mix) and its place among the parts.
 */
const partContext = (
  groupId: string,
  covers: number,
  upload: string,
  index: number,
  count: number,
) => `${groupId} snapshot ${covers} ${upload} ${index}/${count}`;

/** The server's limit per part, as for messages. */
const MAX_SEALED = 256 * 1024;

/** Splits a snapshot into parts and seals each with the group's key. */
export function sealSnapshot(
  enc: Uint8Array,
  groupId: string,
  covers: number,
  upload: string,
  entries: SnapshotEntry[],
  random: Random,
): string[] {
  const parts: SnapshotEntry[][] = [];
  let current: SnapshotEntry[] = [];
  let bytes = 0;
  for (const { device, name, ops } of entries) {
    let entry: SnapshotEntry | null = null;
    for (const op of ops) {
      const opBytes = size(op) + 1;
      const header = entry ? 0 : size({ device, name, ops: [] }) + 1;
      if (bytes > 0 && bytes + header + opBytes > PART_BYTES) {
        parts.push(current);
        current = [];
        bytes = 0;
        entry = null;
      }
      if (!entry) {
        entry = { device, name, ops: [] };
        current.push(entry);
        bytes += size({ device, name, ops: [] }) + 1;
      }
      entry.ops.push(op);
      bytes += opBytes;
    }
  }
  // An empty group still gets one part, so the snapshot says “nothing before this”.
  if (current.length > 0 || parts.length === 0) parts.push(current);
  const sealed = parts.map((partEntries, i) =>
    seal(
      enc,
      partContext(groupId, covers, upload, i, parts.length),
      JSON.stringify({ v: 1, entries: partEntries } satisfies Part),
      random,
    ),
  );
  // One change alone larger than a part: the server would refuse it, so don't upload at all.
  if (sealed.some((part) => part.length > MAX_SEALED)) {
    throw new Error('A change is too large for a sync snapshot.');
  }
  return sealed;
}

/** The entries of a snapshot; throws when a part does not open or is from a newer version. */
export function openSnapshot(
  enc: Uint8Array,
  groupId: string,
  covers: number,
  upload: string,
  sealed: string[],
): SnapshotEntry[] {
  return sealed.flatMap((data, i) => {
    const text = open(enc, partContext(groupId, covers, upload, i, sealed.length), data);
    if (text === null) throw new Error('The sync snapshot did not open with this group’s key.');
    const part = JSON.parse(text) as Part;
    if (part.v !== 1) {
      throw new Error('The sync snapshot is from a newer version of Lelap. Update Lelap.');
    }
    return part.entries;
  });
}

/**
 * Applies a snapshot here. This device's own changes too: a row may hold fields another device
 * sent, and applying what this device already has changes nothing.
 */
export function applySnapshot(
  db: Db,
  entries: SnapshotEntry[],
  now: number,
  newId: IdGenerator,
): { pulled: number; handoffs: (Handoff & { deviceName: string })[] } {
  const ops: Op[] = [];
  const placeFrom = new Map<string, string>();
  for (const { name, ops: list } of entries) {
    for (const op of list) {
      ops.push(op);
      if (op.type === 'progress') placeFrom.set(`${op.profile}\u0000${op.key}`, name);
    }
  }
  // In one call: a book from one device must exist before another device's place in it.
  const handoffs = applyOps(db, ops, now, newId).map((h) => ({
    ...h,
    deviceName: placeFrom.get(`${h.profileId}\u0000${bookKey(db, h.bookId) ?? ''}`) ?? '',
  }));
  return { pulled: ops.length, handoffs };
}
