import { Hono } from 'hono';

import type { SyncStore } from './store';

export const LIMITS = {
  messagesPerPush: 50,
  messageBytes: 256 * 1024,
  groupBytes: 50 * 1024 * 1024,
  pullMax: 500,
  pairingBytes: 4 * 1024,
  pairingMs: 10 * 60_000,
} as const;

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createApp(store: SyncStore, now: () => number = Date.now): Hono {
  const app = new Hono();

  // Bearer tokens, never cookies, so any origin may call it.
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Access-Control-Allow-Origin', '*');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
  });
  app.options('*', (c) =>
    c.body(null, 204, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    }),
  );
  app.onError((_error, c) => c.json({ error: 'The sync server failed.' }, 500));

  /** The group, when the request carries its token. */
  const authorized = async (id: string, header: string | undefined) => {
    if (!HEX32.test(id) || !header?.startsWith('Bearer ')) return null;
    const group = await store.group(id);
    if (!group) return null;
    return sameText(await sha256Hex(header.slice(7)), group.authHash) ? group : null;
  };

  app.put('/v1/groups/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ authHash?: unknown }>().catch(() => ({ authHash: undefined }));
    if (!HEX32.test(id) || typeof body.authHash !== 'string' || !HEX64.test(body.authHash)) {
      return c.json({ error: 'A group needs a 32-digit hex ID and an auth hash.' }, 400);
    }
    const created = await store.createGroup(id, body.authHash, now());
    return created ? c.body(null, 201) : c.json({ error: 'That group exists.' }, 409);
  });

  app.delete('/v1/groups/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await authorized(id, c.req.header('authorization'))))
      return c.json({ error: 'Not allowed.' }, 403);
    await store.deleteGroup(id);
    return c.body(null, 204);
  });

  app.post('/v1/groups/:id/messages', async (c) => {
    const id = c.req.param('id');
    const group = await authorized(id, c.req.header('authorization'));
    if (!group) return c.json({ error: 'Not allowed.' }, 403);
    const body = await c.req
      .json<{ device?: unknown; messages?: unknown }>()
      .catch(() => ({ device: undefined, messages: undefined }));
    const { device, messages } = body;
    if (
      typeof device !== 'string' ||
      !HEX32.test(device) ||
      !Array.isArray(messages) ||
      messages.length > LIMITS.messagesPerPush ||
      !messages.every(
        (m): m is string =>
          typeof m === 'string' && m.length <= LIMITS.messageBytes && BASE64URL.test(m),
      )
    ) {
      return c.json({ error: 'Send a device ID and up to 50 sealed messages.' }, 400);
    }
    const size = messages.reduce((sum, m) => sum + m.length, 0);
    if (group.bytes + size > LIMITS.groupBytes)
      return c.json({ error: 'This group is full.' }, 413);
    await store.append(id, device, messages, now());
    return c.body(null, 204);
  });

  app.get('/v1/groups/:id/messages', async (c) => {
    const id = c.req.param('id');
    if (!(await authorized(id, c.req.header('authorization'))))
      return c.json({ error: 'Not allowed.' }, 403);
    const after = Math.max(0, Number(c.req.query('after') ?? 0) || 0);
    const limit = Math.min(LIMITS.pullMax, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));
    const messages = await store.read(id, after, limit);
    return c.json({ messages, last: messages.at(-1)?.seq ?? after });
  });

  app.put('/v1/pairings/:lookup', async (c) => {
    const lookup = c.req.param('lookup');
    const body = await c.req.json<{ blob?: unknown }>().catch(() => ({ blob: undefined }));
    const { blob } = body;
    if (
      !HEX64.test(lookup) ||
      typeof blob !== 'string' ||
      blob.length > LIMITS.pairingBytes ||
      !BASE64URL.test(blob)
    ) {
      return c.json({ error: 'A pairing needs a lookup ID and a sealed blob.' }, 400);
    }
    const stored = await store.putPairing(lookup, blob, now() + LIMITS.pairingMs, now());
    return stored ? c.body(null, 201) : c.json({ error: 'That pairing exists.' }, 409);
  });

  // POST, not GET: taking a pairing deletes it.
  app.post('/v1/pairings/:lookup', async (c) => {
    const lookup = c.req.param('lookup');
    if (!HEX64.test(lookup)) return c.json({ error: 'Not found.' }, 404);
    const blob = await store.takePairing(lookup, now());
    return blob ? c.json({ blob }) : c.json({ error: 'Not found.' }, 404);
  });

  app.get('/', (c) => c.text('Lelap sync. It stores sealed messages and cannot read them.'));
  app.notFound((c) => c.json({ error: 'Not found.' }, 404));
  return app;
}
