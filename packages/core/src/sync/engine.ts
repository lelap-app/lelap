import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { syncState } from '../schema';
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
};

type Envelope = { v: 1; device: string; name: string; ops: Op[] };

const STATE_KEY = 'membership';
/** Set when the server no longer knows this device's group: another device reset sync. */
const REMOVED_KEY = 'removed';
const OPS_PER_MESSAGE = 200;
const PULL_LIMIT = 200;

export function getMembership(db: Db): SyncMembership | null {
  const row = db.select().from(syncState).where(eq(syncState.key, STATE_KEY)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SyncMembership;
  } catch {
    return null;
  }
}

function saveMembership(db: Db, membership: SyncMembership, now: number): void {
  const value = JSON.stringify(membership);
  db.insert(syncState)
    .values({ key: STATE_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: now } })
    .run();
}

/** Stops syncing on this device. The data stays; other devices keep syncing. */
export function leaveSync(db: Db): void {
  db.delete(syncState).where(eq(syncState.key, STATE_KEY)).run();
}

/** When this device was dropped because its group was reset elsewhere, or null. */
export function removedFromSyncAt(db: Db): number | null {
  const row = db.select().from(syncState).where(eq(syncState.key, REMOVED_KEY)).get();
  return row ? row.updatedAt : null;
}

function clearRemoved(db: Db): void {
  db.delete(syncState).where(eq(syncState.key, REMOVED_KEY)).run();
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
        leaveSync(db);
        db.insert(syncState)
          .values({ key: REMOVED_KEY, value: membership.groupId, updatedAt: now })
          .onConflictDoUpdate({ target: syncState.key, set: { updatedAt: now } })
          .run();
        return { pulled: 0, pushed: 0, handoffs: [] };
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
  await client.push(membership.groupId, token, membership.deviceId, messages);
  result.pushed = ops.length;

  saveMembership(db, { ...membership, cursor, pushedAt: now, lastSyncAt: now }, now);
  return result;
}
