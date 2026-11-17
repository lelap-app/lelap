import {
  authToken,
  compact,
  createSyncClient,
  DEFAULT_PROFILE_ID,
  deriveKeys,
  fromBase64Url,
  getMembership,
  getSettings,
  joinWithCode,
  offerPairing,
  setSetting,
  startSync,
  syncNow,
} from '@lelap/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp, LIMITS } from '../src/app';
import { d1Store } from '../src/d1';
import worker from '../src/index';
import { localD1 } from './d1';
import { appDb } from './db';

const GROUP = 'a'.repeat(32);
const OTHER = 'c'.repeat(32);
const DEVICE = 'b'.repeat(32);
const DAY = 24 * 60 * 60_000;
const UPLOAD = 'e'.repeat(32);
const OTHER_UPLOAD = 'f'.repeat(32);

let d1: Awaited<ReturnType<typeof localD1>>;
beforeAll(async () => {
  d1 = await localD1();
});
afterAll(() => d1.dispose());
beforeEach(() => d1.clear());

async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (method: string, body: unknown, token?: string): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

type Info = {
  bytes: number;
  snapshot: { covers: number; parts: number } | null;
  before: number;
  older: { messages: number; bytes: number };
};

/** A group with token `t` on a Worker backed by local D1, and its routes. */
async function withGroup(clock = { now: 1_000 }) {
  const app = createApp(d1Store(d1.db), () => clock.now);
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`https://sync.example${path}`, init);
  await call(`/v1/groups/${GROUP}`, json('PUT', { authHash: await hash('t') }));
  const auth = { headers: { Authorization: 'Bearer t' } };
  const route = `/v1/groups/${GROUP}`;
  const push = async (messages: string[]) =>
    (await call(`${route}/messages`, json('POST', { device: DEVICE, messages }, 't'))).status;
  const pull = (after: number) => call(`${route}/messages?after=${after}&limit=500`, auth);
  const seqs = async (after = 0) => {
    const page = await (await pull(after)).json<{ messages: { seq: number }[] }>();
    return page.messages.map((m) => m.seq);
  };
  const stage = async (covers: number, from: number, parts: string[], upload = UPLOAD) =>
    (await call(`${route}/snapshot/parts`, json('POST', { upload, covers, from, parts }, 't')))
      .status;
  const commit = async (covers: number, parts: number, upload = UPLOAD) =>
    (await call(`${route}/snapshot`, json('POST', { upload, covers, parts }, 't'))).status;
  /** Sizes, with messages older than `keep` before the server's now. */
  const info = async (keep = clock.now) => (await call(`${route}?keep=${keep}`, auth)).json<Info>();
  return { app, call, auth, push, pull, seqs, stage, commit, info, clock };
}

const must = (value: number | undefined) => {
  if (value === undefined) throw new Error('missing');
  return value;
};

describe('snapshots', () => {
  it('replace the messages they cover, and are read in pages', async () => {
    const g = await withGroup();
    await g.push(['aaaa', 'bbbb', 'cccc']);
    g.clock.now = 5_000;
    await g.push(['dddd']);
    const [one, two, three, four] = (await g.seqs()).map(must);
    expect(await g.info(0)).toEqual({
      bytes: 16,
      snapshot: null,
      before: 5_000,
      older: { messages: 3, bytes: 12 },
    });

    // Parts in two uploads; the snapshot covers the first three messages.
    const parts = Array.from({ length: 25 }, (_, i) => `part${i}`);
    expect(await g.stage(must(three), 0, parts.slice(0, 20))).toBe(204);
    expect(await g.commit(must(three), 25)).toBe(409);
    expect(await g.stage(must(three), 20, parts.slice(20))).toBe(204);
    expect(await g.commit(must(three), 25)).toBe(204);

    expect(await g.seqs(three)).toEqual([four]);
    const info = await g.info(0);
    expect(info.snapshot).toEqual({ covers: three, parts: 25 });
    expect(info.older).toEqual({ messages: 0, bytes: 0 });
    expect(info.bytes).toBe(4 + parts.join('').length);

    const first = await g.call(`/v1/groups/${GROUP}/snapshot`, g.auth);
    expect(await first.json()).toEqual({
      covers: three,
      upload: UPLOAD,
      parts: 25,
      data: parts.slice(0, 20),
    });
    const rest = await g.call(`/v1/groups/${GROUP}/snapshot?from=20&limit=100`, g.auth);
    expect((await rest.json<{ data: string[] }>()).data).toEqual(parts.slice(20));

    // Never an older or equal one, one past the last message, or one without its parts.
    expect(await g.stage(must(two), 0, ['x'])).toBe(409);
    expect(await g.commit(must(three), 1)).toBe(409);
    expect(await g.stage(must(four) + 1, 0, ['x'])).toBe(204);
    expect(await g.commit(must(four) + 1, 1)).toBe(409);
    expect(await g.commit(must(four), 1)).toBe(409);
    expect(one).toBeLessThan(must(three));
  });

  it('stop a device that is behind, with a reason older versions show', async () => {
    const g = await withGroup();
    await g.push(['aaaa', 'bbbb']);
    const [, two] = (await g.seqs()).map(must);
    await g.stage(must(two), 0, ['snap']);
    await g.commit(must(two), 1);

    for (const after of [0, must(two) - 1]) {
      const behind = await g.pull(after);
      expect(behind.status).toBe(410);
      expect(await behind.json()).toEqual({
        error: 'Older changes were merged into a snapshot. Update Lelap to keep syncing.',
        snapshot: two,
      });
    }
    // A device that had read up to the snapshot carries on, old version or not.
    expect((await g.pull(must(two))).status).toBe(200);
    expect(await g.push(['cccc'])).toBe(204);
  });

  it('never mix two uploads, and drop the one that started first', async () => {
    const g = await withGroup();
    await g.push(['aaaa', 'bbbb']);
    const [, two] = (await g.seqs()).map(must);
    // Two devices write a snapshot of the same point at once; uploads don't count until committed.
    await g.stage(must(two), 0, ['first0', 'first1'], UPLOAD);
    expect((await g.info()).bytes).toBe(8);
    await g.stage(must(two), 1, ['second1'], OTHER_UPLOAD);
    await g.stage(must(two), 0, ['second0'], OTHER_UPLOAD);
    expect(await g.commit(must(two), 2, UPLOAD)).toBe(409);
    expect(await g.commit(must(two), 2, OTHER_UPLOAD)).toBe(204);
    expect((await g.info()).bytes).toBe(14);

    // A late part from either upload never lands on the committed snapshot.
    expect(await g.stage(must(two), 0, ['late'], OTHER_UPLOAD)).toBe(409);
    expect(await g.stage(must(two), 0, ['late'], UPLOAD)).toBe(409);
    const read = await g.call(`/v1/groups/${GROUP}/snapshot`, g.auth);
    expect((await read.json<{ data: string[] }>()).data).toEqual(['second0', 'second1']);
    const left = await d1.db.prepare('SELECT COUNT(*) AS n FROM snapshot_parts').first<{
      n: number;
    }>();
    expect(left?.n).toBe(2);
  });

  it('keep the group cap: a full group refuses pushes until a snapshot frees it', async () => {
    const g = await withGroup();
    const big = 'a'.repeat(LIMITS.messageBytes);
    const full = Array.from({ length: LIMITS.messagesPerPush }, () => big);
    for (let i = 0; i < 4; i++) expect(await g.push(full)).toBe(204);
    expect(await g.push([big])).toBe(413);

    // The upload goes in although the group is full; alone it may be as large as the cap.
    const seqs = await g.seqs();
    expect(seqs).toHaveLength(200);
    const covers = must(seqs.at(-1));
    expect(await g.stage(covers, 0, ['s'.repeat(1000)])).toBe(204);
    expect(await g.commit(covers, 1)).toBe(204);
    expect((await g.info()).bytes).toBe(1000);
    expect(await g.push(['aaaa'])).toBe(204);

    // A snapshot never has more parts than the cap holds, nor parts larger than a message.
    const next = must((await g.seqs(covers))[0]);
    expect(await g.stage(next, 200, ['x'])).toBe(400);
    expect(await g.stage(next, 0, [`${big}x`])).toBe(400);
  });

  it('refuse malformed uploads, commits and strangers', async () => {
    const g = await withGroup();
    await g.push(['aaaa']);
    for (const body of [
      { upload: UPLOAD, covers: 1, from: 0, parts: [] },
      { upload: UPLOAD, covers: 1, from: -1, parts: ['a'] },
      { upload: UPLOAD, covers: 1.5, from: 0, parts: ['a'] },
      { upload: UPLOAD, covers: 1, from: 0, parts: ['not base64!'] },
      { upload: UPLOAD, covers: 1, from: 0, parts: Array.from({ length: 51 }, () => 'a') },
      { covers: 1, from: 0, parts: ['a'] },
      { upload: 'short', covers: 1, from: 0, parts: ['a'] },
    ]) {
      const response = await g.call(`/v1/groups/${GROUP}/snapshot/parts`, json('POST', body, 't'));
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    for (const body of [
      { upload: UPLOAD, covers: 0, parts: 1 },
      { upload: UPLOAD, covers: 1, parts: 0 },
      { upload: UPLOAD, covers: 1 },
      { covers: 1, parts: 1 },
    ]) {
      const response = await g.call(`/v1/groups/${GROUP}/snapshot`, json('POST', body, 't'));
      expect(response.status).toBe(400);
    }
    expect((await g.call(`/v1/groups/${GROUP}/snapshot`, g.auth)).status).toBe(404);
    const stranger = { headers: { Authorization: 'Bearer nope' } };
    expect((await g.call(`/v1/groups/${GROUP}/snapshot`, stranger)).status).toBe(403);
    expect((await g.call(`/v1/groups/${GROUP}`, stranger)).status).toBe(403);
  });
});

describe('idle groups', () => {
  const runCron = async (expiry: string | undefined) => {
    const waits: Promise<unknown>[] = [];
    const env = { DB: d1.db, ...(expiry === undefined ? {} : { SYNC_IDLE_EXPIRY_DAYS: expiry }) };
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    worker.scheduled({} as ScheduledController, env, ctx as unknown as ExecutionContext);
    await Promise.all(waits);
  };
  const groups = async () =>
    (await d1.db.prepare('SELECT id FROM groups ORDER BY id').all<{ id: string }>()).results.map(
      (r) => r.id,
    );
  const count = async (table: string) =>
    (await d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

  /** Two groups made 800 days ago; only the second pushed since, yesterday. */
  async function twoGroups() {
    const now = Date.now();
    const clock = { now: now - 800 * DAY };
    const app = createApp(d1Store(d1.db), () => clock.now);
    const call = (path: string, init: RequestInit) =>
      app.request(`https://sync.example${path}`, init);
    await call(`/v1/groups/${GROUP}`, json('PUT', { authHash: await hash('t') }));
    await call(`/v1/groups/${OTHER}`, json('PUT', { authHash: await hash('u') }));
    await call(
      `/v1/groups/${GROUP}/messages`,
      json('POST', { device: DEVICE, messages: ['a'] }, 't'),
    );
    await call(`/v1/pairings/${'d'.repeat(64)}`, json('PUT', { blob: 'old' }));
    clock.now = now - DAY;
    await call(
      `/v1/groups/${OTHER}/messages`,
      json('POST', { device: DEVICE, messages: ['b'] }, 'u'),
    );
  }

  it('expire after the configured days without a push', async () => {
    await twoGroups();
    // Made by the Worker before the migration's deploy: no push time yet, but new.
    await d1.db
      .prepare("INSERT INTO groups (id, auth_hash, created_at) VALUES (?1, 'h', ?2)")
      .bind('9'.repeat(32), Date.now())
      .run();
    await runCron('730');
    expect(await groups()).toEqual(['9'.repeat(32), OTHER]);
    expect(await count('messages')).toBe(1);
    // Pairings go after ten minutes either way.
    expect(await count('pairings')).toBe(0);
  });

  it('never expire when the setting is unset, 0 or not a whole number', async () => {
    await twoGroups();
    for (const value of [undefined, '', '0', 'two years', '-5', '1.5']) await runCron(value);
    expect(await groups()).toEqual([GROUP, OTHER]);
    expect(await count('pairings')).toBe(0);
  });
});

describe('the migration to snapshots', () => {
  it('dates existing groups by their last message', async () => {
    const old = await localD1(['0001_init.sql']);
    try {
      await old.db.batch([
        old.db.prepare("INSERT INTO groups (id, auth_hash, created_at) VALUES ('g1', 'h', 10)"),
        old.db.prepare("INSERT INTO groups (id, auth_hash, created_at) VALUES ('g2', 'h', 20)"),
        old.db.prepare(
          "INSERT INTO messages (group_id, device, data, created_at) VALUES ('g1', 'd', 'x', 50)",
        ),
      ]);
      await old.migrate(['0002_snapshots.sql']);
      const rows = await old.db
        .prepare('SELECT id, last_push_at, snapshot_seq FROM groups ORDER BY id')
        .all();
      expect(rows.results).toEqual([
        { id: 'g1', last_push_at: 50, snapshot_seq: 0 },
        { id: 'g2', last_push_at: 20, snapshot_seq: 0 },
      ]);
    } finally {
      await old.dispose();
    }
  });
});

describe('the app with snapshots against this server', () => {
  it('compacts a month-old log; a new device joins from the snapshot', async () => {
    const T0 = Date.UTC(2026, 0, 1);
    const clock = { now: T0 };
    const app = createApp(d1Store(d1.db), () => clock.now);
    const client = createSyncClient(
      async (url, init) => app.request(url, init),
      'https://sync.example',
    );
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    let n = 0;
    const newId = () => `id-${++n}`;
    const phone = appDb();
    await startSync(phone, client, 'Phone', random, T0);
    const membership = getMembership(phone);
    if (!membership) throw new Error('not syncing');

    for (let i = 1; i <= 30; i++) {
      clock.now = T0 + i * 60_000;
      setSetting(phone, DEFAULT_PROFILE_ID, 'skipIntervalMs', i * 1_000, clock.now);
      await syncNow(phone, client, random, clock.now, newId);
    }
    clock.now = T0 + 40 * DAY;
    setSetting(phone, DEFAULT_PROFILE_ID, 'mono', true, clock.now);
    await syncNow(phone, client, random, clock.now, newId);

    const key = fromBase64Url(membership.key);
    const token = authToken(key);
    const { enc } = deriveKeys(key);
    expect(await compact(client, membership.groupId, token, enc, random, 0)).toBe(true);
    clock.now += 1;
    const info = await client.info(membership.groupId, token, 0);
    expect(info.older.messages).toBe(1);
    expect(info.snapshot?.parts).toBe(1);

    const tablet = appDb();
    const code = await offerPairing(phone, client, random);
    await joinWithCode(tablet, client, code, 'Tablet', random, clock.now);
    await syncNow(tablet, client, random, clock.now, newId);
    expect(getSettings(tablet, DEFAULT_PROFILE_ID)).toMatchObject({
      skipIntervalMs: 30_000,
      mono: true,
    });
  });
});
