import {
  createSyncClient,
  DEFAULT_PROFILE_ID,
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
import { localD1 } from './d1';
import { appDb } from './db';

let d1: Awaited<ReturnType<typeof localD1>>;
beforeAll(async () => {
  d1 = await localD1();
});
afterAll(() => d1.dispose());
beforeEach(() => d1.clear());

const GROUP = 'a'.repeat(32);
const DEVICE = 'b'.repeat(32);

async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setup(clock = { now: 1_000 }) {
  const app = createApp(d1Store(d1.db), () => clock.now);
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`https://sync.example${path}`, init);
  const json = (method: string, body: unknown, token?: string): RequestInit => ({
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { app, call, json, clock };
}

describe('groups and messages', () => {
  it('appends and reads back in order, only with the token', async () => {
    const { call, json } = setup();
    expect(
      (await call(`/v1/groups/${GROUP}`, json('PUT', { authHash: await hash('secret') }))).status,
    ).toBe(201);
    expect(
      (await call(`/v1/groups/${GROUP}`, json('PUT', { authHash: await hash('other') }))).status,
    ).toBe(409);
    const push = await call(
      `/v1/groups/${GROUP}/messages`,
      json('POST', { device: DEVICE, messages: ['aaa', 'bbb'] }, 'secret'),
    );
    expect(push.status).toBe(204);
    const wrong = await call(`/v1/groups/${GROUP}/messages`, {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(wrong.status).toBe(403);
    const all = await call(`/v1/groups/${GROUP}/messages?after=0&limit=10`, {
      headers: { Authorization: 'Bearer secret' },
    });
    const first = (await all.json<{ messages: { seq: number }[] }>()).messages[0]?.seq ?? 0;
    const page = await call(`/v1/groups/${GROUP}/messages?after=${first}&limit=10`, {
      headers: { Authorization: 'Bearer secret' },
    });
    const { messages, last } = await page.json<{ messages: { seq: number }[]; last: number }>();
    expect(messages).toEqual([{ seq: last, device: DEVICE, data: 'bbb', at: 1_000 }]);
    expect(page.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('refuses malformed pushes and full groups', async () => {
    const { call, json } = setup();
    await call(`/v1/groups/${GROUP}`, json('PUT', { authHash: await hash('t') }));
    const bad = await call(
      `/v1/groups/${GROUP}/messages`,
      json('POST', { device: DEVICE, messages: ['not base64!'] }, 't'),
    );
    expect(bad.status).toBe(400);
    const many = Array.from({ length: LIMITS.messagesPerPush + 1 }, () => 'a');
    expect(
      (
        await call(
          `/v1/groups/${GROUP}/messages`,
          json('POST', { device: DEVICE, messages: many }, 't'),
        )
      ).status,
    ).toBe(400);
  });

  it('refuses oversized bodies and odd cursors, and keeps answers out of caches', async () => {
    const { call, json } = setup();
    await call(`/v1/groups/${GROUP}`, json('PUT', { authHash: await hash('t') }));
    const huge = 'a'.repeat(LIMITS.pushBodyBytes);
    const push = await call(
      `/v1/groups/${GROUP}/messages`,
      json('POST', { device: DEVICE, messages: [huge] }, 't'),
    );
    expect(push.status).toBe(413);
    const pairing = await call(`/v1/pairings/${'c'.repeat(64)}`, json('PUT', { blob: huge }));
    expect(pairing.status).toBe(413);
    // A full push of the largest messages still fits.
    const full = Array.from({ length: LIMITS.messagesPerPush }, () =>
      'a'.repeat(LIMITS.messageBytes),
    );
    const ok = await call(
      `/v1/groups/${GROUP}/messages`,
      json('POST', { device: DEVICE, messages: full }, 't'),
    );
    expect(ok.status).toBe(204);

    const auth = { headers: { Authorization: 'Bearer t' } };
    for (const query of ['after=1e400', 'after=-1', 'after=1.5', 'limit=0', 'after=abc']) {
      expect((await call(`/v1/groups/${GROUP}/messages?${query}`, auth)).status, query).toBe(400);
    }
    const page = await call(`/v1/groups/${GROUP}/messages?after=0&limit=1`, auth);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('deletes a group with its messages', async () => {
    const { call, json } = setup();
    await call(`/v1/groups/${GROUP}`, json('PUT', { authHash: await hash('t') }));
    expect(
      (
        await call(`/v1/groups/${GROUP}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer t' },
        })
      ).status,
    ).toBe(204);
    expect(
      (await call(`/v1/groups/${GROUP}/messages`, { headers: { Authorization: 'Bearer t' } }))
        .status,
    ).toBe(403);
  });
});

describe('pairings', () => {
  const LOOKUP = 'c'.repeat(64);
  it('hands a pairing out once and forgets it after ten minutes', async () => {
    const { call, json, clock } = setup();
    expect((await call(`/v1/pairings/${LOOKUP}`, json('PUT', { blob: 'sealed' }))).status).toBe(
      201,
    );
    expect(await (await call(`/v1/pairings/${LOOKUP}`, { method: 'POST' })).json()).toEqual({
      blob: 'sealed',
    });
    expect((await call(`/v1/pairings/${LOOKUP}`, { method: 'POST' })).status).toBe(404);

    await call(`/v1/pairings/${LOOKUP}`, json('PUT', { blob: 'again' }));
    clock.now += LIMITS.pairingMs + 1;
    expect((await call(`/v1/pairings/${LOOKUP}`, { method: 'POST' })).status).toBe(404);
  });
});

describe('the app against this server', () => {
  it('pairs two devices and syncs a setting end to end', async () => {
    const { app } = setup();
    const client = createSyncClient(
      async (url, init) => app.request(url, init),
      'https://sync.example',
    );
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const phone = appDb();
    const laptop = appDb();
    await startSync(phone, client, 'Phone', random, 1);
    await joinWithCode(
      laptop,
      client,
      await offerPairing(phone, client, random),
      'Laptop',
      random,
      2,
    );
    setSetting(phone, DEFAULT_PROFILE_ID, 'skipIntervalMs', 45_000, 10);
    let n = 0;
    const newId = () => `id-${++n}`;
    await syncNow(phone, client, random, 100, newId);
    await syncNow(laptop, client, random, 200, newId);
    expect(getSettings(laptop, DEFAULT_PROFILE_ID).skipIntervalMs).toBe(45_000);
  });
});
