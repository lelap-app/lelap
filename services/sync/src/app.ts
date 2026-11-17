import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { SyncStore } from './store';

export const LIMITS = {
  messagesPerPush: 50,
  messageBytes: 256 * 1024,
  groupBytes: 50 * 1024 * 1024,
  pullMax: 500,
  pairingBytes: 4 * 1024,
  pairingMs: 10 * 60_000,
  /** A full push as JSON, with room for the device ID and punctuation. */
  pushBodyBytes: 50 * 256 * 1024 + 64 * 1024,
  /** Group creation, pairings and snapshot commits. */
  smallBodyBytes: 8 * 1024,
  /** Snapshot parts are sealed like messages, and uploaded up to 50 at a time. */
  partsPerUpload: 50,
  /** Parts per page when a device reads a snapshot. */
  partsPerPage: 20,
} as const;

/** A snapshot never has more parts than the group cap holds. */
const MAX_PARTS = Math.ceil(LIMITS.groupBytes / LIMITS.messageBytes);

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const sealedText = (m: unknown): m is string =>
  typeof m === 'string' && m.length > 0 && m.length <= LIMITS.messageBytes && BASE64URL.test(m);

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
    c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    // Sealed, but still per group: no shared cache should keep a copy.
    c.res.headers.set('Cache-Control', 'no-store');
  });
  // Bodies are refused while they arrive, before JSON parsing holds them in memory (Node build).
  const tooLarge = { onError: (c: Context) => c.json({ error: 'Too large.' }, 413) };
  app.post('/v1/groups/:id/messages', bodyLimit({ maxSize: LIMITS.pushBodyBytes, ...tooLarge }));
  app.post(
    '/v1/groups/:id/snapshot/parts',
    bodyLimit({ maxSize: LIMITS.pushBodyBytes, ...tooLarge }),
  );
  app.post('/v1/groups/:id/snapshot', bodyLimit({ maxSize: LIMITS.smallBodyBytes, ...tooLarge }));
  app.put('*', bodyLimit({ maxSize: LIMITS.smallBodyBytes, ...tooLarge }));
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
      !messages.every(sealedText)
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
    const group = await authorized(id, c.req.header('authorization'));
    if (!group) return c.json({ error: 'Not allowed.' }, 403);
    const after = Number(c.req.query('after') ?? 0);
    const limit = Number(c.req.query('limit') ?? 100);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1) {
      return c.json({ error: 'after and limit are whole numbers.' }, 400);
    }
    // The messages up to the snapshot are gone. A device that has not read them all must start
    // from the snapshot; older versions of the app can't, and stop here rather than miss them.
    if (after < group.snapshotSeq) {
      return c.json(
        {
          error: 'Older changes were merged into a snapshot. Update Lelap to keep syncing.',
          snapshot: group.snapshotSeq,
        },
        410,
      );
    }
    const messages = await store.read(id, after, Math.min(LIMITS.pullMax, limit));
    return c.json({ messages, last: messages.at(-1)?.seq ?? after });
  });

  // What a device needs to decide whether to write a snapshot: sizes, never contents.
  app.get('/v1/groups/:id', async (c) => {
    const id = c.req.param('id');
    const group = await authorized(id, c.req.header('authorization'));
    if (!group) return c.json({ error: 'Not allowed.' }, 403);
    // The server's clock decides what is old, so a phone with a wrong clock can't fold in
    // messages younger than `keep`.
    const keep = Number(c.req.query('keep') ?? 0);
    if (!whole(keep)) return c.json({ error: 'keep is a time in milliseconds.' }, 400);
    const before = now() - keep;
    return c.json({
      bytes: group.bytes,
      snapshot: group.snapshotSeq
        ? { covers: group.snapshotSeq, parts: group.snapshotParts }
        : null,
      before,
      older: await store.older(id, before),
    });
  });

  app.get('/v1/groups/:id/snapshot', async (c) => {
    const id = c.req.param('id');
    const group = await authorized(id, c.req.header('authorization'));
    if (!group) return c.json({ error: 'Not allowed.' }, 403);
    if (!group.snapshotSeq) return c.json({ error: 'This group has no snapshot.' }, 404);
    const from = Number(c.req.query('from') ?? 0);
    const limit = Number(c.req.query('limit') ?? LIMITS.partsPerPage);
    if (!whole(from) || !whole(limit) || limit < 1) {
      return c.json({ error: 'from and limit are whole numbers.' }, 400);
    }
    const to = Math.min(group.snapshotParts, from + Math.min(limit, LIMITS.partsPerPage));
    const data = from < to ? await store.readParts(id, group.snapshotUpload, from, to) : [];
    // A newer snapshot replaced this one while it was read.
    if (data.length !== Math.max(0, to - from)) {
      return c.json({ error: 'The snapshot changed. Try again.' }, 409);
    }
    return c.json({
      covers: group.snapshotSeq,
      upload: group.snapshotUpload,
      parts: group.snapshotParts,
      data,
    });
  });

  app.post('/v1/groups/:id/snapshot/parts', async (c) => {
    const id = c.req.param('id');
    const group = await authorized(id, c.req.header('authorization'));
    if (!group) return c.json({ error: 'Not allowed.' }, 403);
    const body = await c.req
      .json<{ upload?: unknown; covers?: unknown; from?: unknown; parts?: unknown }>()
      .catch(() => ({ upload: undefined, covers: undefined, from: undefined, parts: undefined }));
    const { upload, covers, from, parts } = body;
    if (
      typeof upload !== 'string' ||
      !HEX32.test(upload) ||
      !whole(covers) ||
      !whole(from) ||
      !Array.isArray(parts) ||
      parts.length === 0 ||
      parts.length > LIMITS.partsPerUpload ||
      from + parts.length > MAX_PARTS ||
      !parts.every(sealedText)
    ) {
      return c.json({ error: 'Send an upload ID, covers, from and up to 50 sealed parts.' }, 400);
    }
    if (covers <= group.snapshotSeq) {
      return c.json({ error: 'A newer snapshot is already here.' }, 409);
    }
    // Uploads don't count towards the group's bytes until committed, so a full group can still
    // be compacted; on its own an upload may be as large as the cap.
    const stored = await store.stageParts(id, upload, covers, from, parts, LIMITS.groupBytes);
    return stored ? c.body(null, 204) : c.json({ error: 'This snapshot is too large.' }, 413);
  });

  app.post('/v1/groups/:id/snapshot', async (c) => {
    const id = c.req.param('id');
    if (!(await authorized(id, c.req.header('authorization'))))
      return c.json({ error: 'Not allowed.' }, 403);
    const body = await c.req
      .json<{ upload?: unknown; covers?: unknown; parts?: unknown }>()
      .catch(() => ({ upload: undefined, covers: undefined, parts: undefined }));
    const { upload, covers, parts } = body;
    if (
      typeof upload !== 'string' ||
      !HEX32.test(upload) ||
      !whole(covers) ||
      covers < 1 ||
      !whole(parts) ||
      parts < 1 ||
      parts > MAX_PARTS
    ) {
      return c.json({ error: 'Send the upload ID, covers and the number of parts.' }, 400);
    }
    const committed = await store.commitSnapshot(id, upload, covers, parts, now());
    return committed
      ? c.body(null, 204)
      : c.json({ error: 'That snapshot is incomplete, or a newer one is already here.' }, 409);
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
