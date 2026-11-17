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

type Held = { device: string; name: string; op: Op };

/**
 * Folds operations into the newest per row, with the result applying them in order would have:
 * on equal times the first stays, and fields a newer change leaves out (older app versions do)
 * keep their older value. Types this version does not know are kept as they are.
 */
export function snapshotReducer() {
  const rows = new Map<string, Held>();
  const unknown: Held[] = [];
  return {
    add(device: string, name: string, ops: Op[]): void {
      for (const op of ops) {
        if (!knownOp(op)) {
          unknown.push({ device, name, op });
          continue;
        }
        const row = rowOf(op);
        const held = rows.get(row);
        if (held && op.at <= held.op.at) continue;
        const merged =
          held && 'data' in held.op && 'data' in op
            ? ({ ...op, data: { ...held.op.data, ...op.data } } as Op)
            : op;
        rows.set(row, { device, name, op: merged });
      }
    },
    entries(): SnapshotEntry[] {
      const byDevice = new Map<string, SnapshotEntry>();
      for (const { device, name, op } of [...rows.values(), ...unknown]) {
        const id = `${device}\u0000${name}`;
        const entry = byDevice.get(id) ?? { device, name, ops: [] };
        entry.ops.push(op);
        byDevice.set(id, entry);
      }
      return [...byDevice.values()];
    },
  };
}

/** Each part is bound to its group, the message it covers and its place among the parts. */
const partContext = (groupId: string, covers: number, index: number, count: number) =>
  `${groupId} snapshot ${covers} ${index}/${count}`;

/** Splits a snapshot into parts and seals each with the group's key. */
export function sealSnapshot(
  enc: Uint8Array,
  groupId: string,
  covers: number,
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
  return parts.map((partEntries, i) =>
    seal(
      enc,
      partContext(groupId, covers, i, parts.length),
      JSON.stringify({ v: 1, entries: partEntries } satisfies Part),
      random,
    ),
  );
}

/** The entries of a snapshot; throws when a part does not open or is from a newer version. */
export function openSnapshot(
  enc: Uint8Array,
  groupId: string,
  covers: number,
  sealed: string[],
): SnapshotEntry[] {
  return sealed.flatMap((data, i) => {
    const text = open(enc, partContext(groupId, covers, i, sealed.length), data);
    if (text === null) throw new Error('The sync snapshot did not open with this group’s key.');
    const part = JSON.parse(text) as Part;
    if (part.v !== 1) {
      throw new Error('The sync snapshot is from a newer version of Lelap. Update Lelap.');
    }
    return part.entries;
  });
}

/** Applies a snapshot here, leaving out what this device sent itself (it has that). */
export function applySnapshot(
  db: Db,
  entries: SnapshotEntry[],
  deviceId: string,
  now: number,
  newId: IdGenerator,
): { pulled: number; handoffs: (Handoff & { deviceName: string })[] } {
  const ops: Op[] = [];
  const placeFrom = new Map<string, string>();
  for (const { device, name, ops: list } of entries) {
    if (device === deviceId) continue;
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
