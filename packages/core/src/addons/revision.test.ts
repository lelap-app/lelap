import type { Manifest } from '@lelap/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { sourceCacheKey } from './availability';
import {
  AddonUpgradeError,
  type Fetcher,
  fetchCatalog,
  fetchManifest,
  fetchMeta,
  fetchStreams,
  type InstalledAddon,
} from './client';
import { checkHealth, HealthTracker } from './health';
import {
  addonBlock,
  AddonRefusals,
  addonRefusals,
  APP_PROTOCOL_VERSION,
  parseRefusals,
  protocolHeaders,
  type Refusal,
  upgradeNote,
} from './revision';
import { sourceRequests } from './sources';

const manifest = (extra: Partial<Manifest> = {}): Manifest => ({
  id: 'org.example.rev',
  version: '1.0.0',
  protocol: 1,
  name: 'Rev',
  description: '',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  catalogs: [{ type: 'audiobook', id: 'new', name: 'New' }],
  ...extra,
});

const addon = (
  extra: Partial<Manifest> = {},
  url = 'https://rev.example/manifest.json',
): InstalledAddon => ({
  id: url,
  url,
  builtin: false,
  manifest: manifest(extra),
});

const refOf = (a: InstalledAddon) => {
  const catalog = a.manifest.catalogs[0];
  if (!catalog) throw new Error('No catalog');
  return { addon: a, catalog };
};

type Seen = { url: string; headers: Record<string, string> };

function recording(
  answer: (url: string) => { status: number; body?: unknown; text?: string; type?: string },
): { fetcher: Fetcher; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetcher: Fetcher = async (url, init) => {
    seen.push({ url, headers: init.headers });
    const { status, body = {}, text = '', type = 'application/json' } = answer(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => text,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
    };
  };
  return { fetcher, seen };
}

afterEach(() => {
  for (const url of ['https://rev.example/manifest.json', 'https://old.example/manifest.json'])
    addonRefusals.forget(url);
});

describe('the app tells add-ons its revision (revision 15)', () => {
  it('is the SDK’s newest revision', () => {
    expect(APP_PROTOCOL_VERSION).toBe(15);
  });

  it('sends Lelap-Protocol only to an add-on that declares 15 or higher', () => {
    expect(protocolHeaders(manifest({ protocolVersion: 15 }))).toEqual({ 'Lelap-Protocol': '15' });
    expect(protocolHeaders(manifest({ protocolVersion: 16 }), 15)).toEqual({
      'Lelap-Protocol': '15',
    });
    expect(protocolHeaders(manifest({ protocolVersion: 14 }))).toEqual({});
    expect(protocolHeaders(manifest())).toEqual({});
  });

  it('sends it on resource requests, never on the manifest', async () => {
    const a = addon({ protocolVersion: 15 });
    const { fetcher, seen } = recording((url) =>
      url.endsWith('manifest.json')
        ? { status: 200, body: a.manifest }
        : url.includes('/meta/')
          ? { status: 200, body: { meta: { id: 'x:1', type: 'audiobook', name: 'X' } } }
          : { status: 200, body: { metas: [], streams: [] } },
    );
    await fetchManifest(fetcher, a.url);
    await fetchCatalog(fetcher, refOf(a));
    await fetchMeta(fetcher, [a], 'audiobook', 'x:1');
    await fetchStreams(fetcher, [a], 'audiobook', 'x:1');
    const manifestRequest = seen.find((s) => s.url.endsWith('manifest.json'));
    expect(manifestRequest?.headers['Lelap-Protocol']).toBeUndefined();
    const resources = seen.filter((s) => !s.url.endsWith('manifest.json'));
    expect(resources).toHaveLength(3);
    for (const request of resources) expect(request.headers['Lelap-Protocol']).toBe('15');
  });

  it('sends nothing new to an add-on of revision 14', async () => {
    const a = addon({ protocolVersion: 14 });
    const { fetcher, seen } = recording(() => ({ status: 200, body: { metas: [] } }));
    await fetchCatalog(fetcher, refOf(a));
    expect(seen[0]?.headers).toEqual({ Accept: 'application/json' });
  });

  it('sends it on /health', async () => {
    const a = addon({ protocolVersion: 15, behaviorHints: { health: true } });
    const { fetcher, seen } = recording(() => ({ status: 200, body: { status: 'ok' } }));
    await checkHealth(fetcher, a, new HealthTracker());
    expect(seen[0]?.headers['Lelap-Protocol']).toBe('15');
  });
});

describe('a minimum app revision', () => {
  it('blocks an add-on whose minProtocolVersion is above the app’s revision', () => {
    expect(addonBlock(addon({ protocolVersion: 16, minProtocolVersion: 16 }))).toEqual({
      kind: 'minimum',
      minimum: 16,
    });
    expect(addonBlock(addon({ protocolVersion: 15, minProtocolVersion: 15 }))).toBeNull();
    expect(addonBlock(addon({ protocolVersion: 15 }))).toBeNull();
  });

  it('asks a blocked add-on nothing', async () => {
    const a = addon({ protocolVersion: 16, minProtocolVersion: 16 });
    const { fetcher, seen } = recording(() => ({ status: 200, body: { metas: [] } }));
    await expect(fetchCatalog(fetcher, refOf(a))).rejects.toBeInstanceOf(AddonUpgradeError);
    expect(await fetchMeta(fetcher, [a], 'audiobook', 'x:1')).toBeNull();
    expect(await fetchStreams(fetcher, [a], 'audiobook', 'x:1')).toEqual([]);
    expect(sourceRequests([a], 'audiobook', ['x:1'])).toEqual([]);
    expect(await checkHealth(fetcher, a, new HealthTracker())).toBeNull();
    expect(seen).toEqual([]);
  });

  it('still reads the manifest, so a lower minimum later is seen', async () => {
    const a = addon({ protocolVersion: 16, minProtocolVersion: 16 });
    const { fetcher, seen } = recording(() => ({ status: 200, body: a.manifest }));
    expect((await fetchManifest(fetcher, a.url)).minProtocolVersion).toBe(16);
    expect(seen).toHaveLength(1);
  });
});

describe('426 Upgrade Required', () => {
  it('keeps the add-on’s short plain-text note and asks nothing more', async () => {
    const a = addon({ protocolVersion: 15 });
    const { fetcher, seen } = recording(() => ({
      status: 426,
      text: 'Version 2 of this add-on needs Lelap 0.2.',
      type: 'text/plain; charset=utf-8',
    }));
    const ref = refOf(a);
    const error = await fetchCatalog(fetcher, ref).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AddonUpgradeError);
    expect((error as AddonUpgradeError).block).toEqual({
      kind: 'refused',
      note: 'Version 2 of this add-on needs Lelap 0.2.',
    });
    expect(addonBlock(a)).toEqual({
      kind: 'refused',
      note: 'Version 2 of this add-on needs Lelap 0.2.',
    });
    await expect(fetchCatalog(fetcher, ref)).rejects.toBeInstanceOf(AddonUpgradeError);
    expect(await fetchStreams(fetcher, [a], 'audiobook', 'x:1')).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it('works for an add-on before revision 15 too', async () => {
    const a = addon({ protocolVersion: 10 }, 'https://old.example/manifest.json');
    const { fetcher } = recording(() => ({
      status: 426,
      text: '<html>…</html>',
      type: 'text/html',
    }));
    await expect(fetchCatalog(fetcher, refOf(a))).rejects.toBeInstanceOf(AddonUpgradeError);
    expect(addonBlock(a)).toEqual({ kind: 'refused', note: null });
  });

  it('shows only plain text of at most 200 characters', () => {
    expect(upgradeNote('  Update, please.  ', 'text/plain')).toBe('Update, please.');
    expect(upgradeNote('Update, please.', null)).toBe('Update, please.');
    expect(upgradeNote('x'.repeat(201), 'text/plain')).toBeNull();
    expect(upgradeNote('x'.repeat(200), 'text/plain')).toBe('x'.repeat(200));
    expect(upgradeNote('{"error":"old"}', 'application/json')).toBeNull();
    expect(upgradeNote('{"error":"old"}', null)).toBeNull();
    expect(upgradeNote('', 'text/plain')).toBeNull();
  });

  it('asks again once the app’s revision changes', () => {
    let kept: Record<string, Refusal> = {};
    const storage = { read: () => kept, write: (all: Record<string, Refusal>) => (kept = all) };
    const at15 = new AddonRefusals(15);
    at15.attach(storage);
    at15.record('https://a.example/manifest.json', 'Too old');
    expect(at15.get('https://a.example/manifest.json')).toEqual({ revision: 15, note: 'Too old' });
    // The same app started again still remembers.
    const again = new AddonRefusals(15);
    again.attach(storage);
    expect(again.get('https://a.example/manifest.json')?.note).toBe('Too old');
    // An updated app forgets, and drops the old entry from the store.
    const at16 = new AddonRefusals(16);
    at16.attach(storage);
    expect(at16.get('https://a.example/manifest.json')).toBeNull();
    expect(kept).toEqual({});
  });

  it('reads the store once it can, such as after the web app’s database opens', () => {
    let open = false;
    const storage = {
      read: (): Record<string, Refusal> => {
        if (!open) throw new Error('not open');
        return { 'https://a.example/manifest.json': { revision: 15, note: null } };
      },
      write: () => undefined,
    };
    const refusals = new AddonRefusals(15);
    refusals.attach(storage);
    expect(refusals.get('https://a.example/manifest.json')).toBeNull();
    open = true;
    expect(refusals.get('https://a.example/manifest.json')).toEqual({ revision: 15, note: null });
  });

  it('reads only well-formed kept refusals', () => {
    expect(parseRefusals(null)).toEqual({});
    expect(parseRefusals('not json')).toEqual({});
    expect(
      parseRefusals(
        JSON.stringify({ a: { revision: 15, note: null }, b: { revision: '15' }, c: 3 }),
      ),
    ).toEqual({ a: { revision: 15, note: null } });
  });
});

describe('caches are kept per revision', () => {
  it('keys a work’s sources by the app’s revision', () => {
    const work = { type: 'audiobook', id: 'x:1' };
    expect(sourceCacheKey(work)).toBe(`${APP_PROTOCOL_VERSION}\naudiobook\nx:1`);
    expect(sourceCacheKey(work, 14)).not.toBe(sourceCacheKey(work, 15));
  });
});
