import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { syncState } from '../schema';
import { isSealed, secretBox } from '../secrets';
import { type SyncClient, SyncError } from './client';
import {
  authHash,
  authToken,
  deriveKeys,
  fromBase64Url,
  newPairingCode,
  normalizeCode,
  open,
  pairingKeys,
  type Random,
  seal,
  toBase64Url,
  toHex,
} from './crypto';
import { applyOps, collectOps, type Handoff, type Op } from './ops';
import {
  applySnapshot,
  openSnapshot,
  sealSnapshot,
  type SnapshotEntry,
  snapshotReducer,
} from './snapshot';

/** This device's membership: kept in `sync_state`, never synced. */
export type SyncMembership = {
  groupId: string;
  /** The group key, base64url. Whoever has it can read the group's data. */
  key: string;
  deviceId: string;
  deviceName: string;
  /** The last server sequence number applied here. */
  cursor: number;
  /** Changes after this time have not been pushed yet. */
  pushedAt: number;
  lastSyncAt: number | null;
  /** When this device last asked whether the group needs a snapshot. */
  compactCheckedAt?: number;
};

type Envelope = { v: 1; device: string; name: string; ops: Op[] };

const STATE_KEY = 'membership';
/** Set when this device stopped syncing on its own: its group was reset, or its key was lost. */
const REMOVED_KEY = 'removed';
const OPS_PER_MESSAGE = 200;
const PULL_LIMIT = 200;
const SNAPSHOT_PAGE = 20;
const SNAPSHOT_UPLOAD = 50;
const DAY_MS = 24 * 60 * 60_000;
/** A device asks at most once a day whether the group needs a snapshot. */
const COMPACT_CHECK_MS = DAY_MS;
/**
 * Messages younger than this stay in the log. Versions of the app from before snapshots can't
 * start from one (the server stops them instead, see services/sync), so a device on an old
 * version that syncs at least monthly never needs to.
 */
export const COMPACT_KEEP_MS = 30 * DAY_MS;
/** A snapshot is written once the messages older than COMPACT_KEEP_MS reach this size. */
export const COMPACT_MIN_BYTES = 1024 * 1024;

function readMembership(db: Db): SyncMembership | null {
  const row = db.select().from(syncState).where(eq(syncState.key, STATE_KEY)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SyncMembership;
  } catch {
    return null;
  }
}

/** This device's membership, with its group key opened; null when it can't be opened here. */
export function getMembership(db: Db): SyncMembership | null {
  const stored = readMembership(db);
  if (!stored) return null;
  const key = secretBox().open(stored.key);
  return key === null ? null : { ...stored, key };
}

function saveMembership(db: Db, membership: SyncMembership, now: number): void {
  const value = JSON.stringify({ ...membership, key: secretBox().seal(membership.key) });
  db.insert(syncState)
    .values({ key: STATE_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: now } })
    .run();
}

/** Stops syncing on this device. The data stays; other devices keep syncing. */
export function leaveSync(db: Db): void {
  db.delete(syncState).where(eq(syncState.key, STATE_KEY)).run();
}

/**
 * Why this device stopped syncing without being asked: another device reset sync (`reset`), or
 * the group key did not come back with a restored backup (`restore`). Null otherwise.
 */
export type SyncRemoval = { at: number; reason: 'reset' | 'restore' };

export function removedFromSync(db: Db): SyncRemoval | null {
  const row = db.select().from(syncState).where(eq(syncState.key, REMOVED_KEY)).get();
  if (!row) return null;
  return { at: row.updatedAt, reason: row.value === 'restore' ? 'restore' : 'reset' };
}

function markRemoved(db: Db, reason: SyncRemoval['reason'], now: number): void {
  leaveSync(db);
  db.insert(syncState)
    .values({ key: REMOVED_KEY, value: reason, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.key, set: { value: reason, updatedAt: now } })
    .run();
}

function clearRemoved(db: Db): void {
  db.delete(syncState).where(eq(syncState.key, REMOVED_KEY)).run();
}

/**
 * At start: seals a group key stored before sealing existed, and drops a membership whose key
 * this device can't open (restored on a new phone), so the Sync screen asks to pair again.
 */
export function sealMembership(db: Db, now: number): void {
  const stored = readMembership(db);
  if (!stored) return;
  const box = secretBox();
  if (box.open(stored.key) === null) markRemoved(db, 'restore', now);
  else if (box.sealing && !isSealed(stored.key)) saveMembership(db, stored, now);
}

function member(
  groupId: string,
  key: Uint8Array,
  deviceName: string,
  random: Random,
): SyncMembership {
  return {
    groupId,
    key: toBase64Url(key),
    deviceId: toHex(random(16)),
    deviceName,
    cursor: 0,
    pushedAt: 0,
    lastSyncAt: null,
  };
}

/** Starts a new sync group with this device in it. */
export async function startSync(
  db: Db,
  client: SyncClient,
  deviceName: string,
  random: Random,
  now: number,
): Promise<SyncMembership> {
  const key = random(32);
  const groupId = toHex(random(16));
  await client.createGroup(groupId, authHash(authToken(key)));
  const membership = member(groupId, key, deviceName, random);
  saveMembership(db, membership, now);
  clearRemoved(db);
  return membership;
}

/**
 * For a lost or sold device: moves this device to a new group with a new key and deletes the old
 * group on the server, so the old key opens nothing from now on. The next sync pushes everything
 * to the new group; the other devices stop syncing until they pair again with a code.
 */
export async function resetSync(
  db: Db,
  client: SyncClient,
  random: Random,
  now: number,
): Promise<SyncMembership> {
  const old = getMembership(db);
  if (!old) throw new Error('This device does not sync yet.');
  const key = random(32);
  const groupId = toHex(random(16));
  await client.createGroup(groupId, authHash(authToken(key)));
  try {
    await client.leave(old.groupId, authToken(fromBase64Url(old.key)));
  } catch (error) {
    // 403: the old group is already gone, which is what this is for.
    if (!(error instanceof SyncError && error.status === 403)) throw error;
  }
  const membership = member(groupId, key, old.deviceName, random);
  saveMembership(db, membership, now);
  return membership;
}

const PAIRING_CONTEXT = 'lelap pairing';

/**
 * Leaves the group secret on the server for ten minutes, sealed with a key from a new code. The
 * other device types the code to join.
 */
export async function offerPairing(db: Db, client: SyncClient, random: Random): Promise<string> {
  const membership = getMembership(db);
  if (!membership) throw new Error('This device does not sync yet.');
  const code = newPairingCode(random);
  const { lookup, key } = await pairingKeys(code);
  const secret = JSON.stringify({ groupId: membership.groupId, key: membership.key });
  await client.putPairing(lookup, seal(key, PAIRING_CONTEXT, secret, random));
  return code;
}

/** The group in an opened pairing; checked, since it becomes this device's sync identity. */
function parsePairingSecret(secret: string): { groupId: string; groupKey: Uint8Array } {
  try {
    const parsed = JSON.parse(secret) as { groupId?: unknown; key?: unknown };
    if (typeof parsed.groupId === 'string' && /^[0-9a-f]{32}$/.test(parsed.groupId)) {
      const groupKey = typeof parsed.key === 'string' ? fromBase64Url(parsed.key) : null;
      if (groupKey?.length === 32) return { groupId: parsed.groupId, groupKey };
    }
  } catch {
    // Falls through to the error below.
  }
  throw new Error('That pairing is damaged. Make a new one.');
}

/** Joins the group another device offered with `code`. */
export async function joinWithCode(
  db: Db,
  client: SyncClient,
  typed: string,
  deviceName: string,
  random: Random,
  now: number,
): Promise<SyncMembership> {
  const code = normalizeCode(typed);
  if (!code) throw new Error('That is not a pairing code. It looks like 7KQM-2XPA-9HRT.');
  const { lookup, key } = await pairingKeys(code);
  const blob = await client.takePairing(lookup);
  if (!blob) throw new Error('That code has expired or was already used. Make a new one.');
  const secret = open(key, PAIRING_CONTEXT, blob);
  if (!secret) throw new Error('That code did not open the pairing. Make a new one.');
  const { groupId, groupKey } = parsePairingSecret(secret);
  const membership = member(groupId, groupKey, deviceName, random);
  saveMembership(db, membership, now);
  clearRemoved(db);
  return membership;
}

export type SyncResult = {
  pulled: number;
  pushed: number;
  /** Places other devices saved that were newer than this device's. */
  handoffs: (Handoff & { deviceName: string })[];
};

/** Pulls what other devices sent, then pushes this device's changes. */
export async function syncNow(
  db: Db,
  client: SyncClient,
  random: Random,
  now: number,
  newId: IdGenerator,
): Promise<SyncResult> {
  const membership = getMembership(db);
  if (!membership) return { pulled: 0, pushed: 0, handoffs: [] };
  const groupKey = fromBase64Url(membership.key);
  const { enc } = deriveKeys(groupKey);
  const token = authToken(groupKey);
  const context = membership.groupId;
  const result: SyncResult = { pulled: 0, pushed: 0, handoffs: [] };

  let cursor = membership.cursor;
  for (;;) {
    let page: Awaited<ReturnType<SyncClient['pull']>>;
    try {
      page = await client.pull(membership.groupId, token, cursor, PULL_LIMIT);
    } catch (error) {
      // The group is gone: another device reset sync. Stop here; the data stays.
      if (error instanceof SyncError && error.status === 403) {
        markRemoved(db, 'reset', now);
        return { pulled: 0, pushed: 0, handoffs: [] };
      }
      // The messages after the cursor were merged into a snapshot: start from that.
      if (error instanceof SyncError && error.status === 410) {
        const snapshot = await readSnapshot(client, membership.groupId, token, enc);
        if (snapshot.covers <= cursor) throw error;
        const applied = applySnapshot(db, snapshot.entries, now, newId);
        result.pulled += applied.pulled;
        result.handoffs.push(...applied.handoffs);
        cursor = snapshot.covers;
        continue;
      }
      throw error;
    }
    for (const message of page.messages) {
      if (message.device === membership.deviceId) continue;
      const text = open(enc, context, message.data);
      if (!text) continue;
      const envelope = JSON.parse(text) as Envelope;
      if (envelope.v !== 1) continue;
      const handoffs = applyOps(db, envelope.ops, now, newId);
      result.pulled += envelope.ops.length;
      for (const h of handoffs) result.handoffs.push({ ...h, deviceName: envelope.name });
    }
    cursor = Math.max(cursor, page.last);
    if (page.messages.length < PULL_LIMIT) break;
  }

  // Collected after the pull, so what just arrived is not sent straight back (much).
  const since = membership.pushedAt;
  const ops = collectOps(db, since);
  const messages: string[] = [];
  for (let i = 0; i < ops.length; i += OPS_PER_MESSAGE) {
    const envelope: Envelope = {
      v: 1,
      device: membership.deviceId,
      name: membership.deviceName,
      ops: ops.slice(i, i + OPS_PER_MESSAGE),
    };
    messages.push(seal(enc, context, JSON.stringify(envelope), random));
  }
  // Before the push, so a full group gets room. Upkeep only: a failure is tried again tomorrow
  // and never fails the sync; the day is saved first, so a crash mid-way doesn't repeat it.
  let current: SyncMembership = { ...membership, cursor };
  if (now - (membership.compactCheckedAt ?? 0) >= COMPACT_CHECK_MS) {
    current = { ...current, compactCheckedAt: now };
    saveMembership(db, current, now);
    await compact(client, membership.groupId, token, enc, random).catch(() => false);
  }
  const push = () => client.push(membership.groupId, token, membership.deviceId, messages);
  try {
    await push();
  } catch (error) {
    // The group is full: whatever is old enough goes into a snapshot, then try once more.
    if (!(error instanceof SyncError && error.status === 413)) throw error;
    const freed = await compact(client, membership.groupId, token, enc, random, 0).catch(
      () => false,
    );
    if (!freed) throw error;
    await push();
  }
  result.pushed = ops.length;

  saveMembership(db, { ...current, pushedAt: now, lastSyncAt: now }, now);
  return result;
}

/** The group's snapshot, read and opened; throws when there is none or it does not open. */
async function readSnapshot(
  client: SyncClient,
  groupId: string,
  token: string,
  enc: Uint8Array,
): Promise<{ covers: number; upload: string; entries: SnapshotEntry[] }> {
  const sealed: string[] = [];
  let covers = 0;
  let upload = '';
  let parts = 1;
  while (sealed.length < parts) {
    const page = await client.snapshot(groupId, token, sealed.length, SNAPSHOT_PAGE);
    if (!page) throw new Error('The sync group has no snapshot.');
    // Replaced by a newer one while reading: the caller tries again on the next sync.
    if (sealed.length > 0 && (page.covers !== covers || page.upload !== upload)) {
      throw new Error('The sync snapshot changed while it was read.');
    }
    if (page.data.length === 0) throw new Error('The sync snapshot is incomplete.');
    covers = page.covers;
    upload = page.upload;
    parts = page.parts;
    sealed.push(...page.data);
  }
  return { covers, upload, entries: openSnapshot(enc, groupId, covers, upload, sealed) };
}

/**
 * Writes a new snapshot when the group's older messages have grown: the old snapshot plus the
 * messages older than COMPACT_KEEP_MS, folded to the newest change per row. The server then drops
 * those messages. Anything this version can't read stops it, so nothing is dropped unread.
 */
export async function compact(
  client: SyncClient,
  groupId: string,
  token: string,
  enc: Uint8Array,
  random: Random,
  minBytes = COMPACT_MIN_BYTES,
): Promise<boolean> {
  // The server's clock decides what is old enough, not this device's.
  const info = await client.info(groupId, token, COMPACT_KEEP_MS);
  const cutoff = info.before;
  if (info.older.messages === 0 || info.older.bytes < minBytes) return false;

  const reducer = snapshotReducer();
  let covers = 0;
  if (info.snapshot) {
    const base = await readSnapshot(client, groupId, token, enc);
    for (const entry of base.entries) reducer.add(entry.device, entry.name, entry.ops);
    covers = base.covers;
  }
  const from = covers;
  let after = covers;
  read: for (;;) {
    const page = await client.pull(groupId, token, after, PULL_LIMIT);
    for (const message of page.messages) {
      // Servers before M52 don't date messages; those never get here (no info above).
      if (message.at === undefined || message.at >= cutoff) break read;
      const text = open(enc, groupId, message.data);
      if (!text) return false;
      const envelope = JSON.parse(text) as Envelope;
      if (envelope.v !== 1) return false;
      reducer.add(message.device, envelope.name, envelope.ops);
      covers = message.seq;
    }
    after = page.last;
    if (page.messages.length < PULL_LIMIT) break;
  }
  if (covers === from) return false;

  const upload = toHex(random(16));
  const sealed = sealSnapshot(enc, groupId, covers, upload, reducer.entries(), random);
  for (let i = 0; i < sealed.length; i += SNAPSHOT_UPLOAD) {
    const parts = sealed.slice(i, i + SNAPSHOT_UPLOAD);
    await client.putSnapshotParts(groupId, token, upload, covers, i, parts);
  }
  return client.commitSnapshot(groupId, token, upload, covers, sealed.length);
}
