import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { createApp } from '../../../services/sync/src/app';
import { migrate, sqliteStore } from './sqliteStore';

const migration = (name: string) =>
  readFileSync(new URL(`../../../services/sync/migrations/${name}`, import.meta.url), 'utf8');
const migrations = {
  '0001_init.sql': migration('0001_init.sql'),
  '0002_snapshots.sql': migration('0002_snapshots.sql'),
};

describe('sync on Node SQLite', () => {
  it('runs migrations once and serves the same routes as on D1', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, migrations);
    migrate(db, migrations);
    const app = createApp(sqliteStore(db));
    const group = 'a'.repeat(32);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('t'));
    const authHash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const json = (method: string, body: unknown, token?: string): RequestInit => ({
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    expect((await app.request(`/v1/groups/${group}`, json('PUT', { authHash }))).status).toBe(201);
    await app.request(
      `/v1/groups/${group}/messages`,
      json('POST', { device: 'b'.repeat(32), messages: ['x', 'y'] }, 't'),
    );
    const page = await app.request(`/v1/groups/${group}/messages?after=0`, {
      headers: { Authorization: 'Bearer t' },
    });
    expect(((await page.json()) as { messages: unknown[] }).messages).toHaveLength(2);
    expect(
      (await app.request(`/v1/pairings/${'c'.repeat(64)}`, json('PUT', { blob: 'z' }))).status,
    ).toBe(201);
    expect((await app.request(`/v1/pairings/${'c'.repeat(64)}`, { method: 'POST' })).status).toBe(
      200,
    );
    expect((await app.request(`/v1/pairings/${'c'.repeat(64)}`, { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('compacts with snapshots and expires idle groups, as on D1', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, migrations);
    const store = sqliteStore(db);
    await store.createGroup('g'.repeat(32), 'h', 1_000);
    await store.createGroup('i'.repeat(32), 'h', 1_000);
    await store.append('g'.repeat(32), 'd', ['aaaa', 'bbbb', 'cccc'], 2_000);
    const [, two, three] = (await store.read('g'.repeat(32), 0, 10)).map((m) => m.seq);
    expect(await store.stageParts('g'.repeat(32), two ?? 0, 0, ['snap'], 100)).toBe(true);
    expect(await store.stageParts('g'.repeat(32), three ?? 0, 0, ['x'.repeat(101)], 100)).toBe(
      false,
    );
    expect(await store.commitSnapshot('g'.repeat(32), two ?? 0, 1, 3_000)).toBe(true);
    expect(await store.commitSnapshot('g'.repeat(32), two ?? 0, 1, 3_000)).toBe(false);
    expect((await store.read('g'.repeat(32), 0, 10)).map((m) => m.data)).toEqual(['cccc']);
    expect(await store.readParts('g'.repeat(32), two ?? 0, 0, 5)).toEqual(['snap']);
    expect(await store.group('g'.repeat(32))).toMatchObject({
      bytes: 8,
      snapshotSeq: two,
      snapshotParts: 1,
      lastPushAt: 3_000,
    });
    expect(await store.expireIdle(2_000)).toBe(1);
    expect(await store.group('i'.repeat(32))).toBeNull();
    expect(await store.group('g'.repeat(32))).not.toBeNull();
  });
});
