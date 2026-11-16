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
import { describe, expect, it } from 'vitest';

import { createApp, LIMITS } from '../src/app';
import { memoryStore } from '../src/store';
import { appDb } from './db';

const GROUP = 'a'.repeat(32);
const DEVICE = 'b'.repeat(32);

async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setup(clock = { now: 1_000 }) {
  const app = createApp(memoryStore(), () => clock.now);
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
    const page = await call(`/v1/groups/${GROUP}/messages?after=1&limit=10`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(await page.json()).toEqual({
      messages: [{ seq: 2, device: DEVICE, data: 'bbb' }],
      last: 2,
    });
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
