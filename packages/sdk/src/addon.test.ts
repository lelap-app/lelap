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
    expect(await response.json()).toEqual({
      ...manifest,
      protocolVersion: 3,
      behaviorHints: { health: true },
    });
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

describe('createAddon with configure', () => {
  const configured = (secret = 'test secret') =>
    createAddon(
      {
        manifest,
        configure: {
          secret,
          returnOrigins: ['https://listen.example.org'],
          fields: [
            { key: 'user', label: 'User', type: 'text', required: true },
            { key: 'password', label: 'Password', type: 'password', required: true },
          ],
          check: (config) => (config.password === 'wrong' ? 'Wrong password.' : undefined),
        },
        catalog: ({ config }) => ({
          metas: [{ ...preview, name: String(config?.user ?? 'nobody') }],
        }),
      },
      { basePath: '/sub' },
    );

  const post = (a: ReturnType<typeof configured>, path: string, body: Record<string, string>) =>
    a.fetch(
      new Request(`https://addon.example/sub/${path}`, {
        method: 'POST',
        body: new URLSearchParams(body),
      }),
    );

  it('asks for configuration in the bare manifest and refuses resources', async () => {
    const a = configured();
    const body = (await (
      await a.fetch(new Request('https://addon.example/sub/manifest.json'))
    ).json()) as Manifest;
    expect(body.behaviorHints).toEqual({
      health: true,
      configurable: true,
      configurationRequired: true,
    });
    expect(body.configurable).toBe(true);
    const catalog = await a.fetch(
      new Request(`https://addon.example/sub/${catalogPath('audiobook', 'top')}`),
    );
    expect(catalog.status).toBe(403);
  });

  it('serves a form that never echoes passwords and only keeps allowed return addresses', async () => {
    const a = configured();
    const page = await a.fetch(
      new Request('https://addon.example/sub/configure?return=https%3A%2F%2Fevil.example%2Faddon'),
    );
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    const text = await page.text();
    expect(text).toContain('name="password"');
    expect(text).not.toContain('evil.example');
  });

  it('turns the form into a configured manifest URL', async () => {
    const a = configured();
    const saved = await post(a, 'configure', {
      user: 'ada',
      password: 'pw',
      return: 'lelap://addon',
    });
    expect(saved.status).toBe(303);
    const location = saved.headers.get('location') ?? '';
    expect(location.startsWith('lelap://addon?manifest=')).toBe(true);
    const manifestUrl = decodeURIComponent(location.split('manifest=')[1] ?? '');
    expect(manifestUrl).toMatch(
      /^https:\/\/addon\.example\/sub\/e1\.[A-Za-z0-9_-]+\/manifest\.json$/,
    );
    expect(manifestUrl).not.toContain('pw');

    const served = (await (await a.fetch(new Request(manifestUrl))).json()) as Manifest;
    expect(served.behaviorHints?.configurationRequired).toBe(false);
    const base = manifestUrl.replace(/manifest\.json$/, '');
    const catalog = await a.fetch(new Request(base + catalogPath('audiobook', 'top')));
    expect(((await catalog.json()) as { metas: { name: string }[] }).metas[0]?.name).toBe('ada');
  });

  it('shows the URL on a page without a return address, and keeps the password when reconfiguring', async () => {
    const a = configured();
    const first = await post(a, 'configure', { user: 'ada', password: 'pw' });
    expect(first.status).toBe(200);
    const text = await first.text();
    const manifestUrl =
      /(https:\/\/addon\.example\/sub\/e1\.[A-Za-z0-9_-]+\/manifest\.json)/.exec(text)?.[1] ?? '';
    expect(manifestUrl).not.toBe('');
    const token = manifestUrl.split('/')[4] ?? '';
    const form = await (
      await a.fetch(new Request(`https://addon.example/sub/${token}/configure`))
    ).text();
    expect(form).toContain('value="ada"');
    expect(form).not.toContain('value="pw"');
    const again = await post(a, `${token}/configure`, { user: 'grace', password: '' });
    expect(again.status).toBe(200);
  });

  it('shows the check and missing fields on the form', async () => {
    const a = configured();
    const wrong = await post(a, 'configure', { user: 'ada', password: 'wrong' });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('Wrong password.');
    const missing = await post(a, 'configure', { user: 'ada' });
    expect(await missing.text()).toContain('Password is required.');
  });

  it('refuses a token sealed with another secret', async () => {
    const other = configured('another secret');
    const saved = await post(other, 'configure', {
      user: 'ada',
      password: 'pw',
      return: 'lelap://addon',
    });
    const manifestUrl = decodeURIComponent(
      saved.headers.get('location')?.split('manifest=')[1] ?? '',
    );
    expect((await configured().fetch(new Request(manifestUrl))).status).toBe(403);
  });

  it('404s config tokens on an add-on without configure', async () => {
    expect((await get(addon(), 'p1.e30/manifest.json')).status).toBe(404);
  });
});

describe('createAddon health', () => {
  it('says ok by default', async () => {
    const response = await get(addon(), 'health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('serves and checks the health handler', async () => {
    const ok = addon({ health: () => ({ status: 'degraded', message: 'Search is slow' }) });
    expect(await (await get(ok, 'health')).json()).toEqual({
      status: 'degraded',
      message: 'Search is slow',
    });
    const bad = addon({ health: () => ({ status: 'fine' }) as never });
    expect((await get(bad, 'health')).status).toBe(500);
  });
});

describe('artwork', () => {
  it('serves artwork from its handler', async () => {
    const app = createAddon({
      manifest: {
        id: 'org.example.art',
        version: '1.0.0',
        protocol: 1,
        name: 'Art',
        description: 'Covers',
        types: ['audiobook'],
        resources: ['artwork'],
        idPrefixes: ['test:'],
        catalogs: [],
      },
      artwork: ({ id }) => ({
        artwork: [{ url: `https://img.example/${id}.jpg`, kind: 'cover', width: 600, height: 600 }],
      }),
    });
    const response = await app.fetch(
      new Request('https://addon.example/artwork/audiobook/test%3A1.json'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artwork: [{ url: 'https://img.example/test:1.jpg', kind: 'cover', width: 600, height: 600 }],
    });
  });
});
