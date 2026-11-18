import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { bestCover } from './client';
import { addonPermissions } from './permissions';

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

describe('addonPermissions', () => {
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
