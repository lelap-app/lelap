import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { hostAllowed, localAddonUrl, splitLocalUrl } from './local';
import { addonPermissions } from './permissions';
import { installAddon, listAddons, removeAddon } from './repository';
import { getLocalAddonCode, saveLocalAddonCode } from './local';

describe('local add-ons', () => {
  it('only lets declared hosts through', () => {
    const hosts = ['192.168.1.20:8096', 'nas.local', '*.home.arpa'];
    expect(hostAllowed('http://192.168.1.20:8096/Items', hosts)).toBe(true);
    expect(hostAllowed('http://192.168.1.20/Items', hosts)).toBe(false);
    expect(hostAllowed('https://nas.local/books', hosts)).toBe(true);
    expect(hostAllowed('http://shelf.home.arpa/x', hosts)).toBe(true);
    expect(hostAllowed('http://home.arpa/x', hosts)).toBe(false);
    expect(hostAllowed('http://evil.example/?nas.local', hosts)).toBe(false);
    expect(hostAllowed('file:///etc/passwd', hosts)).toBe(false);
    expect(hostAllowed('http://user:pw@nas.local/', hosts)).toBe(false);
  });

  it('splits request URLs into the add-on and its route', () => {
    const url = localAddonUrl('org.example.nas');
    expect(url).toBe('lelap-local://org.example.nas/manifest.json');
    expect(splitLocalUrl('lelap-local://org.example.nas/catalog/audiobook/all.json')).toEqual({
      manifestUrl: url,
      path: 'catalog/audiobook/all.json',
    });
    expect(splitLocalUrl('https://x/manifest.json')).toBeNull();
  });

  it('keeps code with the add-on and removes it with it', () => {
    const db = createTestDb();
    const url = localAddonUrl('org.example.nas');
    const manifest = {
      id: 'org.example.nas',
      version: '1.0.0',
      protocol: 1 as const,
      name: 'NAS',
      description: '',
      types: ['audiobook' as const],
      resources: ['catalog' as const],
      catalogs: [],
      sandbox: { hosts: ['nas.local'] },
    };
    installAddon(db, { url, manifest, now: 1, newId: () => 'a1' });
    saveLocalAddonCode(db, {
      url,
      sourceUrl: 'https://x/nas.js',
      code: 'addon({})',
      sha256: 'ab',
      now: 1,
    });
    expect(listAddons(db)[0]?.manifest.sandbox).toEqual({ hosts: ['nas.local'] });
    expect(getLocalAddonCode(db, url)?.code).toBe('addon({})');
    expect(addonPermissions(manifest, url).map((p) => p.kind)).toEqual(['sandbox']);
    removeAddon(db, url, 2);
    expect(getLocalAddonCode(db, url)).toBeNull();
  });
});
