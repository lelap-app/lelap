import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { createApp } from '../../../services/sync/src/app';
import { migrate, sqliteStore } from './sqliteStore';

const init = readFileSync(
  new URL('../../../services/sync/migrations/0001_init.sql', import.meta.url),
  'utf8',
);

describe('sync on Node SQLite', () => {
  it('runs migrations once and serves the same routes as on D1', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, { '0001_init.sql': init });
    migrate(db, { '0001_init.sql': init });
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
});
