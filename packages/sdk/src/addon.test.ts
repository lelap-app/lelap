import { describe, expect, it, vi } from 'vitest';

import { AddonError, CORS_HEADERS, createAddon } from './addon';
import { catalogPath, metaPath, streamPath } from './paths';
import type { Manifest } from './protocol';

const manifest: Manifest = {
  id: 'org.example.test',
  version: '1.0.0',
  protocol: 1,
  name: 'Test',
  description: 'A test add-on',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['test:'],
  catalogs: [{ type: 'audiobook', id: 'top', name: 'Top', extra: [{ name: 'search' }] }],
};

const preview = { id: 'test:1', type: 'audiobook' as const, name: 'One' };

function addon(overrides: Partial<Parameters<typeof createAddon>[0]> = {}, basePath = '') {
  return createAddon(
    {
      manifest,
      catalog: ({ extra }) => ({ metas: extra.search ? [] : [preview], cacheMaxAge: 60 }),
      meta: ({ id }) => (id === 'test:1' ? { meta: preview } : null),
      stream: () => ({
        streams: [
          {
            sourceKey: 'k',
            name: 'Test',
            parts: [{ url: 'https://a.example/1.mp3', durationMs: 1 }],
          },
        ],
      }),
      ...overrides,
    },
    { basePath },
  );
}

const get = (a: ReturnType<typeof addon>, path: string, method = 'GET') =>
  a.fetch(new Request(`https://addon.example/${path}`, { method }));

describe('createAddon', () => {
  it('serves the manifest with CORS', async () => {
    const response = await get(addon(), 'manifest.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual(manifest);
  });

  it('answers preflight requests', async () => {
    const response = await get(addon(), 'manifest.json', 'OPTIONS');
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('passes extras to the catalog handler and sets Cache-Control', async () => {
    const a = addon();
    const all = await get(a, catalogPath('audiobook', 'top'));
    expect(await all.json()).toEqual({ metas: [preview], cacheMaxAge: 60 });
    expect(all.headers.get('cache-control')).toBe('public, max-age=60');
    const searched = await get(a, catalogPath('audiobook', 'top', { search: 'x' }));
    expect(await searched.json()).toEqual({ metas: [], cacheMaxAge: 60 });
  });

  it('404s for unknown catalogs, types, routes and items', async () => {
    const a = addon();
    expect((await get(a, catalogPath('audiobook', 'nope'))).status).toBe(404);
    expect((await get(a, catalogPath('podcast', 'top'))).status).toBe(404);
    expect((await get(a, 'nothing')).status).toBe(404);
    expect((await get(a, metaPath('audiobook', 'test:2'))).status).toBe(404);
  });

  it('404s for resources the manifest does not declare', async () => {
    const a = createAddon({
      manifest: { ...manifest, resources: ['catalog'] },
      stream: () => ({ streams: [] }),
    });
    expect((await get(a, streamPath('audiobook', 'test:1'))).status).toBe(404);
  });

  it('mounts under a base path', async () => {
    const a = addon({}, '/sub/');
    expect((await get(a, 'sub/manifest.json')).status).toBe(200);
    expect((await get(a, 'manifest.json')).status).toBe(404);
    expect((await get(a, `sub/${metaPath('audiobook', 'test:1')}`)).status).toBe(200);
  });

  it('turns handler output that breaks the protocol into a 500', async () => {
    const onError = vi.fn();
    const a = createAddon(
      { manifest, meta: () => ({ meta: { ...preview, id: 'no-prefix' } }) },
      { onError },
    );
    const response = await get(a, metaPath('audiobook', 'test:1'));
    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('uses the status of an AddonError', async () => {
    const a = addon({
      stream: () => {
        throw new AddonError(503, 'Upstream is down');
      },
    });
    const response = await get(a, streamPath('audiobook', 'test:1'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Upstream is down' });
  });

  it('rejects an invalid manifest up front', () => {
    expect(() => createAddon({ manifest: { ...manifest, version: 'one' } })).toThrow();
  });
});

describe('resource types', () => {
  it('404s for a type the resource does not declare', async () => {
    const a = createAddon({
      manifest: {
        ...manifest,
        types: ['audiobook', 'podcast'],
        resources: ['catalog', { name: 'stream', types: ['audiobook'] }],
        catalogs: [],
      },
      stream: () => ({ streams: [] }),
    });
    expect((await get(a, streamPath('podcast', 'test:1'))).status).toBe(404);
    expect((await get(a, streamPath('audiobook', 'test:1'))).status).toBe(200);
  });
});

describe('scrobble', () => {
  const event = {
    eventId: 'evt-00000001',
    event: 'start' as const,
    at: 1_700_000_000_000,
    item: { type: 'audiobook' as const, id: 'test:1', name: 'One' },
    positionMs: 0,
  };
  const scrobbler = (scrobble = vi.fn()) =>
    createAddon({
      manifest: { ...manifest, resources: ['scrobble'], catalogs: [] },
      scrobble,
    });
  const post = (a: ReturnType<typeof scrobbler>, body: string) =>
    a.fetch(
      new Request('https://addon.example/scrobble', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  it('hands valid events to the handler', async () => {
    const handler = vi.fn();
    const response = await post(scrobbler(handler), JSON.stringify({ events: [event] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 1 });
    expect(handler.mock.calls[0]?.[0].events).toEqual([event]);
  });

  it('answers 400 for bodies that are not events', async () => {
    const handler = vi.fn();
    expect((await post(scrobbler(handler), 'nope')).status).toBe(400);
    expect((await post(scrobbler(handler), JSON.stringify({ events: [{}] }))).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows POST in CORS and only POST on the route', async () => {
    const a = scrobbler();
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('POST');
    expect((await a.fetch(new Request('https://addon.example/scrobble'))).status).toBe(405);
  });

  it('404s when the add-on does not declare it', async () => {
    expect((await post(addon(), JSON.stringify({ events: [event] }))).status).toBe(404);
  });

  it('passes on an AddonError status', async () => {
    const a = scrobbler(
      vi.fn(() => {
        throw new AddonError(401, 'Configure the add-on again');
      }),
    );
    expect((await post(a, JSON.stringify({ events: [event] }))).status).toBe(401);
  });
});
