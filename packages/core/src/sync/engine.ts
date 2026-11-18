import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { subscriptions, syncState } from '../schema';
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
import { applyOps, collectOps, fillMissingSkips, type Handoff, type Op } from './ops';
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

/** What one sealed message holds. */
export type Envelope = { v: 1; device: string; name: string; ops: Op[] };

/**
 * A message's envelope: null when it is not one (it can never be applied anywhere), `newer` when
 * a newer version of Lelap wrote it.
 */
function readEnvelope(text: string | null): Envelope | 'newer' | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const envelope = parsed as Partial<Envelope> & { v?: unknown };
  if (envelope.v !== 1) return typeof envelope.v === 'number' ? 'newer' : null;
  if (!Array.isArray(envelope.ops)) return null;
  return {
    v: 1,
    device: typeof envelope.device === 'string' ? envelope.device : '',
    name: typeof envelope.name === 'string' ? envelope.name : '',
    ops: envelope.ops.filter((op): op is Op => typeof op === 'object' && op !== null),
  };
}

const STATE_KEY = 'membership';
/** Set when this device stopped syncing on its own: its group was reset, or its key was lost. */
const REMOVED_KEY = 'removed';
const OPS_PER_MESSAGE = 200;
/**
 * Plain text per message. Sealed and in base64 a message grows by a third, and the server takes
 * up to 256 KB; a change larger than this alone could never be sent, so it is left out.
 */
const MESSAGE_BYTES = 190_000;
/** Messages per push, as the server takes them. */
const MESSAGES_PER_PUSH = 50;
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

/** Whether this device joined a sync group, even one whose key can't be opened here. */
export function hasSyncMembership(db: Db): boolean {
  return readMembership(db) !== null;
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
 * Why this device stopped syncing without being asked: its group is gone (`reset`: another device
 * reset sync, or the server expired the group after no device synced for a long time), or the
 * group key did not come back with a restored backup (`restore`). Null otherwise.
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
      // The group is gone: another device reset sync, or it expired. Stop here; the data stays.
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
      const envelope = readEnvelope(open(enc, context, message.data));
      if (envelope === null || envelope === 'newer') continue;
      const handoffs = applyOps(db, envelope.ops, now, newId);
      result.pulled += envelope.ops.length;
      for (const h of handoffs) result.handoffs.push({ ...h, deviceName: envelope.name });
    }
    cursor = Math.max(cursor, page.last);
    if (page.messages.length < PULL_LIMIT) break;
  }

  // Once per device: shows a version before M45 kept without their intro and outro.
  if (!skipsFilled(db)) {
    await fillSkipsFromGroup(db, client, membership, token, enc, now).catch(() => {});
  }

  // Collected after the pull, so what just arrived is not sent straight back (much).
  const since = membership.pushedAt;
  const ops = collectOps(db, since);
  const messages = packMessages(ops, membership.deviceId, membership.deviceName).map((envelope) =>
    seal(enc, context, JSON.stringify(envelope), random),
  );
  // Before the push, so a full group gets room. Upkeep only: a failure is tried again tomorrow
  // and never fails the sync; the day is saved first, so a crash mid-way doesn't repeat it.
  let current: SyncMembership = { ...membership, cursor };
  if (now - (membership.compactCheckedAt ?? 0) >= COMPACT_CHECK_MS) {
    current = { ...current, compactCheckedAt: now };
    saveMembership(db, current, now);
    await compact(client, membership.groupId, token, enc, random).catch(() => false);
  }
  // In batches the server takes. A batch that fails leaves `pushedAt` as it was, so the next sync
  // sends everything again; applying a change twice changes nothing.
  let freed = false;
  for (let i = 0; i < messages.length; i += MESSAGES_PER_PUSH) {
    const batch = messages.slice(i, i + MESSAGES_PER_PUSH);
    const push = () => client.push(membership.groupId, token, membership.deviceId, batch);
    try {
      await push();
    } catch (error) {
      // The group is full: whatever is old enough goes into a snapshot, then try once more.
      if (freed || !(error instanceof SyncError && error.status === 413)) throw error;
      freed = await compact(client, membership.groupId, token, enc, random, 0).catch(() => false);
      if (!freed) throw error;
      await push();
    }
  }
  result.pushed = ops.length;

  saveMembership(db, { ...current, pushedAt: now, lastSyncAt: now }, now);
  return result;
}

const textBytes = (value: unknown) => utf8ToBytes(JSON.stringify(value)).length;

/**
 * Splits operations into envelopes of at most OPS_PER_MESSAGE operations and MESSAGE_BYTES of
 * text. A single change too large for any message is left out rather than stopping every sync.
 */
export function packMessages(ops: Op[], device: string, name: string): Envelope[] {
  const envelopes: Envelope[] = [];
  const empty = textBytes({ v: 1, device, name, ops: [] });
  let current: Op[] = [];
  let bytes = empty;
  for (const op of ops) {
    const size = textBytes(op) + 1;
    if (empty + size > MESSAGE_BYTES) continue;
    if (current.length >= OPS_PER_MESSAGE || bytes + size > MESSAGE_BYTES) {
      envelopes.push({ v: 1, device, name, ops: current });
      current = [];
      bytes = empty;
    }
    current.push(op);
    bytes += size;
  }
  if (current.length > 0) envelopes.push({ v: 1, device, name, ops: current });
  return envelopes;
}

/** Set once this device has looked for intro and outro values it missed (M68). */
const SKIPS_KEY = 'skipsFilled';

function skipsFilled(db: Db): boolean {
  return db.select().from(syncState).where(eq(syncState.key, SKIPS_KEY)).get() !== undefined;
}

/**
 * Reads the group's snapshot and log once, for `fillMissingSkips`. Only when some show here reads
 * 0 and 0, which is the only case it can change; this device's own messages count too, since a
 * newer change from here wins over another device's older one.
 */
async function fillSkipsFromGroup(
  db: Db,
  client: SyncClient,
  { groupId, pushedAt }: SyncMembership,
  token: string,
  enc: Uint8Array,
  now: number,
): Promise<void> {
  // A device that never pushed has nothing older than the group to fill in.
  const unset =
    pushedAt > 0 &&
    db
      .select({ at: subscriptions.updatedAt })
      .from(subscriptions)
      .where(and(eq(subscriptions.skipIntroMs, 0), eq(subscriptions.skipOutroMs, 0)))
      .get();
  if (unset) {
    const ops: Op[] = [];
    const keep = (list: Op[]) => {
      for (const op of list) {
        if (op.type === 'subscription' || (op.type === 'delete' && op.kind === 'subscription')) {
          ops.push(op);
        }
      }
    };
    let after = 0;
    for (;;) {
      let page: Awaited<ReturnType<SyncClient['pull']>>;
      try {
        page = await client.pull(groupId, token, after, PULL_LIMIT);
      } catch (error) {
        if (!(error instanceof SyncError && error.status === 410) || after > 0) throw error;
        const snapshot = await readSnapshot(client, groupId, token, enc);
        for (const entry of snapshot.entries) keep(entry.ops);
        after = snapshot.covers;
        continue;
      }
      for (const message of page.messages) {
        const envelope = readEnvelope(open(enc, groupId, message.data));
        if (envelope !== null && envelope !== 'newer') keep(envelope.ops);
      }
      after = Math.max(after, page.last);
      if (page.messages.length < PULL_LIMIT) break;
    }
    fillMissingSkips(db, ops, pushedAt);
  }
  db.insert(syncState)
    .values({ key: SKIPS_KEY, value: '1', updatedAt: now })
    .onConflictDoNothing()
    .run();
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
  let opened = info.snapshot !== null;
  let unreadable = false;
  read: for (;;) {
    const page = await client.pull(groupId, token, after, PULL_LIMIT);
    for (const message of page.messages) {
      // Servers before M52 don't date messages; those never get here (no info above).
      if (message.at === undefined || message.at >= cutoff) break read;
      const envelope = readEnvelope(open(enc, groupId, message.data));
      // A newer version's message waits for a version that can read it.
      if (envelope === 'newer') return false;
      // One that doesn't open with the group's key, or isn't an envelope, no device can apply
      // (sync skips it too), so it may go.
      if (envelope === null) unreadable = true;
      else {
        opened = true;
        reducer.add(message.device, envelope.name, envelope.ops);
      }
      covers = message.seq;
    }
    after = page.last;
    if (page.messages.length < PULL_LIMIT) break;
  }
  // Nothing opened at all: rather a fault here than a group whose every message is unreadable.
  if (covers === from || (unreadable && !opened)) return false;

  const upload = toHex(random(16));
  const sealed = sealSnapshot(enc, groupId, covers, upload, reducer.entries(), random);
  for (let i = 0; i < sealed.length; i += SNAPSHOT_UPLOAD) {
    const parts = sealed.slice(i, i + SNAPSHOT_UPLOAD);
    await client.putSnapshotParts(groupId, token, upload, covers, i, parts);
  }
  return client.commitSnapshot(groupId, token, upload, covers, sealed.length);
}
