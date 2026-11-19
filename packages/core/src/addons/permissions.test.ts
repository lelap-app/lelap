import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { bestCover } from './client';
import { addonPermissions, asksForMore } from './permissions';

const manifest = (resources: Manifest['resources']): Manifest => ({
  id: 'org.example.a',
  version: '1.0.0',
  protocol: 1,
  name: 'A',
  description: '',
  types: ['audiobook'],
  resources,
  catalogs: [
    { type: 'audiobook', id: 'new', name: 'New' },
    { type: 'audiobook', id: 'top', name: 'Top' },
  ],
});

describe('asksForMore', () => {
  const url = 'https://addon.example/e2.abc/manifest.json';
  it('is true for a new resource, plain http or a new host, not for new settings', () => {
    const installed = { manifest: manifest(['catalog', 'stream']), url };
    expect(asksForMore(installed, { manifest: manifest(['catalog', 'stream']), url })).toBe(false);
    expect(
      asksForMore(installed, {
        manifest: manifest(['catalog', 'stream']),
        url: 'https://addon.example/e2.def/manifest.json',
      }),
    ).toBe(false);
    expect(
      asksForMore(installed, { manifest: manifest(['catalog', 'stream', 'scrobble']), url }),
    ).toBe(true);
    expect(
      asksForMore(installed, {
        manifest: manifest(['catalog', 'stream']),
        url: 'http://addon.example:8080/manifest.json',
      }),
    ).toBe(true);
    expect(
      asksForMore(
        { manifest: { ...manifest(['catalog']), sandbox: { hosts: ['a.example'] } }, url },
        { manifest: { ...manifest(['catalog']), sandbox: { hosts: ['b.example'] } }, url },
      ),
    ).toBe(true);
  });
});

describe('addonPermissions', () => {
  it('says what a series resource gets (M127)', () => {
    const list = addonPermissions(
      manifest([{ name: 'series', types: ['audiobook'] }]),
      'https://addon.example/series/manifest.json',
    );
    expect(list.find((p) => p.kind === 'series')).toMatchObject({ notable: false });
  });

  it('names what the add-on does and flags what deserves a second look', () => {
    const list = addonPermissions(
      manifest(['catalog', 'stream', 'scrobble']),
      'http://addon.example/abcdefghijklmnopqrstuvwxyz0123456789abcdefgh/manifest.json',
    );
    expect(list.map((p) => [p.kind, p.notable])).toEqual([
      ['catalog', false],
      ['stream', false],
      ['scrobble', true],
      ['settings', true],
      ['insecure', true],
      ['host', false],
    ]);
    expect(list[0]?.text).toContain('New, Top');
  });

  it('says a web add-on that claims a sandbox is still a service that sees what you browse', () => {
    const claims = { ...manifest(['catalog']), sandbox: { hosts: [] } };
    expect(
      addonPermissions(claims, 'https://addon.example/manifest.json').map((p) => p.kind),
    ).toEqual(['catalog', 'host']);
    expect(addonPermissions(claims, 'lelap-local://a').map((p) => p.kind)).toEqual([
      'catalog',
      'sandbox',
    ]);
  });

  it('keeps it short for a plain https catalog', () => {
    const list = addonPermissions(manifest(['catalog']), 'https://addon.example/manifest.json');
    expect(list.map((p) => p.kind)).toEqual(['catalog', 'host']);
  });
});

describe('bestCover', () => {
  it('prefers a large square cover', () => {
    expect(
      bestCover([
        { url: 'https://i/wide.jpg', kind: 'cover', width: 1200, height: 600 },
        { url: 'https://i/small.jpg', kind: 'cover', width: 120, height: 120 },
        { url: 'https://i/square.jpg', kind: 'cover', width: 600, height: 600 },
        { url: 'https://i/banner.jpg', kind: 'banner', width: 900, height: 900 },
      ]),
    ).toBe('https://i/square.jpg');
    expect(bestCover([])).toBeNull();
  });
});
