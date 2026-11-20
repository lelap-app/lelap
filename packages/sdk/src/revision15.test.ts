import { describe, expect, it } from 'vitest';

import { createAddon, type HandlerArgs, PREFLIGHT_HEADERS, UPGRADE_MESSAGE } from './addon';
import { type CheckFetch, checkAddon } from './check';
import { catalogPath } from './paths';
import {
  LATEST_PROTOCOL_VERSION,
  Manifest,
  needsNewerApp,
  parseAppProtocol,
  PROTOCOL_HEADER,
  sendsAppProtocol,
} from './protocol';

const BASE = 'https://addon.test';

const manifest: Manifest = {
  id: 'org.example.revision',
  version: '1.0.0',
  protocol: 1,
  name: 'Revision',
  description: 'Tests',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['rev:'],
  catalogs: [{ type: 'audiobook', id: 'all', name: 'All' }],
};

const viaFetch =
  (handler: (request: Request) => Promise<Response> | Response): CheckFetch =>
  async (url, init) =>
    handler(new Request(url, init));

const ask = (
  fetch: (request: Request) => Promise<Response>,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
) => fetch(new Request(`${BASE}/${path}`, { method, headers }));

describe('revision 15', () => {
  it('is the newest revision', () => {
    expect(LATEST_PROTOCOL_VERSION).toBe(15);
    expect(PROTOCOL_HEADER).toBe('Lelap-Protocol');
  });

  it('reads minProtocolVersion on a manifest', () => {
    const parsed = Manifest.parse({ ...manifest, protocolVersion: 15, minProtocolVersion: 15 });
    expect(parsed.minProtocolVersion).toBe(15);
    expect(Manifest.safeParse({ ...manifest, minProtocolVersion: 0 }).success).toBe(false);
    expect(needsNewerApp(parsed, 14)).toBe(true);
    expect(needsNewerApp(parsed, 15)).toBe(false);
    expect(needsNewerApp(manifest, 1)).toBe(false);
  });

  it('sends the header only to add-ons of revision 15 and later', () => {
    expect(sendsAppProtocol({ ...manifest, protocolVersion: 15 })).toBe(true);
    expect(sendsAppProtocol({ ...manifest, protocolVersion: 14 })).toBe(false);
    expect(sendsAppProtocol(manifest)).toBe(false);
  });

  it('parses the header, an invalid value counting as absent', () => {
    expect(parseAppProtocol('15')).toBe(15);
    expect(parseAppProtocol(' 16 ')).toBe(16);
    for (const bad of [null, undefined, '', 'abc', '15.5', '-1', '0', '1e3', '15, 16'])
      expect(parseAppProtocol(bad)).toBeUndefined();
  });

  it('hands handlers appProtocol from the header', async () => {
    const seen: (number | undefined)[] = [];
    const addon = createAddon({
      manifest,
      catalog: (args: HandlerArgs) => {
        seen.push(args.appProtocol);
        return { metas: [] };
      },
    });
    const path = catalogPath('audiobook', 'all');
    await ask(addon.fetch, path, { [PROTOCOL_HEADER]: '15' });
    await ask(addon.fetch, path);
    await ask(addon.fetch, path, { [PROTOCOL_HEADER]: 'fifteen' });
    expect(seen).toEqual([15, undefined, undefined]);
  });

  it('serves the newest revision, so the app sends its own', async () => {
    const addon = createAddon({ manifest, catalog: () => ({ metas: [] }) });
    expect(addon.manifest.protocolVersion).toBe(15);
    expect(addon.manifest.minProtocolVersion).toBeUndefined();
  });

  it('answers 426 by itself to an app below minProtocolVersion, or one without the header', async () => {
    const addon = createAddon({
      manifest,
      minProtocolVersion: 15,
      catalog: () => ({ metas: [] }),
      health: () => ({ status: 'ok' }),
    });
    expect(addon.manifest.minProtocolVersion).toBe(15);
    const path = catalogPath('audiobook', 'all');
    const old = await ask(addon.fetch, path);
    expect(old.status).toBe(426);
    expect(old.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(old.headers.get('access-control-allow-origin')).toBe('*');
    const text = await old.text();
    expect(text).toBe(UPGRADE_MESSAGE);
    expect(text.length).toBeLessThanOrEqual(200);
    expect((await ask(addon.fetch, path, { [PROTOCOL_HEADER]: '14' })).status).toBe(426);
    expect((await ask(addon.fetch, path, { [PROTOCOL_HEADER]: 'x' })).status).toBe(426);
    expect((await ask(addon.fetch, path, { [PROTOCOL_HEADER]: '15' })).status).toBe(200);
    expect((await ask(addon.fetch, path, { [PROTOCOL_HEADER]: '16' })).status).toBe(200);
    // The manifest and /health still answer, so the app can tell why.
    expect((await ask(addon.fetch, 'manifest.json')).status).toBe(200);
    expect((await ask(addon.fetch, 'health')).status).toBe(200);
  });

  it('takes minProtocolVersion from the manifest too, and refuses a bad one', () => {
    const addon = createAddon({ manifest: { ...manifest, minProtocolVersion: 15 } });
    expect(addon.manifest.minProtocolVersion).toBe(15);
    expect(() => createAddon({ manifest, minProtocolVersion: 0 })).toThrow(/minProtocolVersion/);
  });

  it('answers the preflight with Max-Age and any header', async () => {
    const addon = createAddon({ manifest, catalog: () => ({ metas: [] }) });
    const response = await ask(
      addon.fetch,
      catalogPath('audiobook', 'all'),
      { 'Access-Control-Request-Headers': 'lelap-protocol' },
      'OPTIONS',
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-max-age')).toBe('86400');
    expect(response.headers.get('access-control-allow-headers')).toBe('*');
    expect(PREFLIGHT_HEADERS['Access-Control-Allow-Headers']).toBe('*');
  });
});

describe('lelap-sdk check and revision 15', () => {
  const served = (body: Manifest, preflight?: Response) => {
    const addon = createAddon({ manifest, catalog: () => ({ metas: [] }) });
    return viaFetch(async (request) => {
      const { pathname } = new URL(request.url);
      if (request.method === 'OPTIONS' && preflight) return preflight.clone();
      if (pathname === '/manifest.json')
        return new Response(JSON.stringify(body), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'max-age=60',
          },
        });
      return addon.fetch(request);
    });
  };
  const warnings = async (fetch: CheckFetch) =>
    (await checkAddon(BASE, { fetch })).problems.filter(
      (p) => p.field === 'minProtocolVersion' || p.message.includes(PROTOCOL_HEADER),
    );

  it('is quiet for an SDK add-on with a minimum', async () => {
    const addon = createAddon({ manifest, minProtocolVersion: 15, catalog: () => ({ metas: [] }) });
    expect(await warnings(viaFetch(addon.fetch))).toEqual([]);
  });

  it('sends the revision like the app, so a minimum of 15 lets it through', async () => {
    const addon = createAddon({ manifest, minProtocolVersion: 15, catalog: () => ({ metas: [] }) });
    const report = await checkAddon(BASE, { fetch: viaFetch(addon.fetch) });
    expect(report.problems.filter((p) => p.message.includes('426'))).toEqual([]);
  });

  it('warns of a minimum above protocolVersion', async () => {
    const found = await warnings(
      served({ ...manifest, protocolVersion: 15, minProtocolVersion: 16 }),
    );
    expect(found.map((p) => p.message)).toEqual([expect.stringContaining('above protocolVersion')]);
  });

  it('warns of a minimum without revision 15', async () => {
    const found = await warnings(
      served({ ...manifest, protocolVersion: 14, minProtocolVersion: 14 }),
    );
    expect(found.map((p) => p.message)).toEqual([expect.stringContaining('came with revision 15')]);
  });

  it('warns when the preflight of a revision 15 add-on doesn’t allow Lelap-Protocol', async () => {
    const narrow = new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
      },
    });
    const found = await warnings(served({ ...manifest, protocolVersion: 15 }, narrow));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ level: 'warning', kind: 'cors' });
    const named = new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Lelap-Protocol',
      },
    });
    expect(await warnings(served({ ...manifest, protocolVersion: 15 }, named))).toEqual([]);
    // An add-on of revision 14 gets no header, so its preflight is not asked.
    expect(await warnings(served({ ...manifest, protocolVersion: 14 }, narrow))).toEqual([]);
  });
});
