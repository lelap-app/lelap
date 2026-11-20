import { describe, expect, it } from 'vitest';

import type { RemoteSource } from '../schema';
import {
  hostOf,
  isLocalAddress,
  isLocalHost,
  isLocalRemote,
  localNetworkCause,
  localNetworkStep,
  scanNeedsAccess,
} from './localNetwork';

describe('isLocalHost', () => {
  it('knows the private, link-local and loopback IPv4 ranges', () => {
    for (const host of [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.20',
      '169.254.10.3',
      '127.0.0.1',
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
    for (const host of ['172.15.0.1', '172.32.0.1', '192.169.1.1', '8.8.8.8', '100.64.0.1']) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it('refuses what only looks like an IPv4 address', () => {
    expect(isLocalHost('10.0.0.256')).toBe(false);
    expect(isLocalHost('10.0.0')).toBe(false);
  });

  it('knows IPv6 loopback, unique local and link-local', () => {
    for (const host of ['::1', '[::1]', 'fd12:3456::1', 'fc00::1', 'fe80::1', 'FE80::1%wlan0']) {
      expect(isLocalHost(host), host).toBe(true);
    }
    for (const host of ['2001:db8::1', '2a00:1450:4001::200e', '::']) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it('follows the IPv4 rule for IPv4-mapped IPv6', () => {
    expect(isLocalHost('::ffff:192.168.1.2')).toBe(true);
    expect(isLocalHost('::ffff:c0a8:102')).toBe(true);
    expect(isLocalHost('::ffff:8.8.8.8')).toBe(false);
  });

  it('knows names that never resolve on the internet, and bare names', () => {
    for (const host of [
      'nas.local',
      'NAS.LOCAL.',
      'localhost',
      'printer.home.arpa',
      'router.lan',
      'nas',
      'diskstation',
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
    for (const host of ['example.com', 'nas.example.com', 'local.example.com', '']) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });
});

describe('hostOf and isLocalAddress', () => {
  it('reads the host of any scheme, with logins and ports', () => {
    expect(hostOf('https://me:pw@nas.local:8443/dav/')).toBe('nas.local');
    expect(hostOf('smb://NAS/Media/Books')).toBe('NAS');
    expect(hostOf('sftp://[fe80::1]:22/home')).toBe('[fe80::1]');
    expect(hostOf('nas.local:8080')).toBe('nas.local');
    expect(hostOf('192.168.1.2:445')).toBe('192.168.1.2');
    expect(hostOf('fd00::5')).toBe('fd00::5');
  });

  it('gives no host for files and content', () => {
    expect(hostOf('file:///storage/book.mp3')).toBeNull();
    expect(hostOf('content://com.android.externalstorage.documents/tree/x')).toBe(
      'com.android.externalstorage.documents',
    );
    expect(isLocalAddress('content://com.android.externalstorage.documents/tree/x')).toBe(false);
    expect(hostOf('blob:https://app.example/1')).toBeNull();
    expect(hostOf('')).toBeNull();
  });

  it('says whether an address is local', () => {
    expect(isLocalAddress('http://192.168.1.10:13378')).toBe(true);
    expect(isLocalAddress('smb://nas/Books')).toBe(true);
    expect(isLocalAddress('https://jellyfin.example.com')).toBe(false);
    expect(isLocalAddress('file:///sdcard/a.mp3')).toBe(false);
  });
});

describe('isLocalRemote', () => {
  const webdav: RemoteSource = {
    type: 'webdav',
    url: 'http://nas.local/dav',
    username: '',
    password: '',
  };
  it('reads each kind of server', () => {
    expect(isLocalRemote(webdav)).toBe(true);
    expect(isLocalRemote({ ...webdav, url: 'https://dav.example.com' })).toBe(false);
    const s3: RemoteSource = {
      type: 's3',
      endpoint: 'http://10.0.0.5:9000',
      region: 'auto',
      bucket: 'books',
      prefix: '',
      accessKeyId: 'k',
      secretAccessKey: 's',
    };
    expect(isLocalRemote(s3)).toBe(true);
  });

  it('takes an add-on’s hosts from the app', () => {
    const addon: RemoteSource = {
      type: 'addon',
      addonUrl: 'lelap-local://http-folder/manifest.json',
      key: 'k',
      name: 'HTTP folder',
      settings: { username: 'nas' },
      secret: '{}',
    };
    // A form's plain text is not an address.
    expect(isLocalRemote(addon)).toBe(false);
    expect(isLocalRemote(addon, ['nas.local:8080'])).toBe(true);
    expect(isLocalRemote(addon, ['plex.tv', 'media.example.com:32400'])).toBe(false);
  });
});

describe('the decisions', () => {
  it('asks only for a local server without access', () => {
    expect(localNetworkStep(false, 'ask')).toBe('go');
    expect(localNetworkStep(true, 'granted')).toBe('go');
    expect(localNetworkStep(true, 'ask')).toBe('explain');
    expect(localNetworkStep(true, 'blocked')).toBe('settings');
  });

  it('skips a local server in a background scan until access is on', () => {
    expect(scanNeedsAccess(true, 'ask')).toBe(true);
    expect(scanNeedsAccess(true, 'blocked')).toBe(true);
    expect(scanNeedsAccess(true, 'granted')).toBe(false);
    expect(scanNeedsAccess(false, 'blocked')).toBe(false);
  });

  it('names missing access as the cause of a failed connection', () => {
    expect(localNetworkCause(true, 'blocked')).toBe('certain');
    expect(localNetworkCause(false, 'ask')).toBe('possible');
    expect(localNetworkCause(true, 'granted')).toBe('none');
    expect(localNetworkCause(false, 'granted')).toBe('none');
  });
});

describe('a server with a home and an away address (M146)', () => {
  const abs = {
    type: 'audiobookshelf' as const,
    url: 'http://192.168.1.5:13378',
    username: 'me',
    userId: 'u',
    token: 'k',
    libraryIds: [],
    profileId: 'p',
  };

  it('needs local network access only when both addresses are local', () => {
    expect(isLocalRemote(abs)).toBe(true);
    expect(isLocalRemote({ ...abs, alsoUrl: 'https://abs.example.org' })).toBe(false);
    expect(isLocalRemote({ ...abs, alsoUrl: 'http://nas.local:13378' })).toBe(true);
  });
});
