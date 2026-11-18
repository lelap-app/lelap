import { randomBytes } from 'node:crypto';

import type { Manifest } from '@lelap/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { exportLibrary } from '../backup';
import { diagnosticsReport } from '../diagnostics/report';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { enqueueScrobble } from '../scrobble';
import { scrobbleOutbox, scrobblerSettings } from '../schema';
import { createSecretBox, plainBox, setSecretBox } from '../secrets';
import { SettingsSchema } from '../settings';
import { collectOps } from '../sync/ops';
import { HealthTracker } from './health';
import { listAddons, installAddon, removeAddon } from './repository';
import { loadAddonSettings, saveAddonSettings, scrobblerCall } from './settings';

const random = (n: number) => new Uint8Array(randomBytes(n));
let n = 0;
const newId = () => `id-${String(++n).padStart(8, '0')}`;

const URL_ = 'lelap-local://app.lelap.openlibrary-log/manifest.json';
const ACCESS = 'AbCdEf0123456789';
const SECRET = 'ZyXwVu9876543210';

const manifest: Manifest = {
  id: 'app.lelap.openlibrary-log',
  version: '1.0.0',
  protocol: 1,
  protocolVersion: 8,
  name: 'Open Library reading log',
  description: '',
  types: ['audiobook'],
  resources: ['scrobble'],
  catalogs: [],
  sandbox: { hosts: ['openlibrary.org'] },
  settings: [
    { key: 'access', label: 'S3 access key', type: 'text', required: true },
    { key: 'secret', label: 'S3 secret key', type: 'password', required: true },
  ],
};

function setUp(codeSha: string | null = null) {
  const db = createTestDb();
  saveAddonSettings(db, {
    url: URL_,
    manifest,
    settings: { access: ACCESS, secret: SECRET, extra: 'not a field' },
    codeSha,
    now: 1,
  });
  installAddon(db, { url: URL_, manifest, now: 1, newId });
  return db;
}

afterEach(() => setSecretBox(plainBox));

describe('a scrobbler’s settings on this device', () => {
  it('seals the secret key on the phone and opens it again, for this code only', () => {
    setSecretBox(createSecretBox(random(32), random));
    const db = setUp();
    const stored = JSON.stringify(db.select().from(scrobblerSettings).all());
    expect(stored).not.toContain(SECRET);
    // Only the fields the manifest names are kept.
    expect(stored).not.toContain('not a field');
    expect(loadAddonSettings(db, URL_, null)).toEqual({
      state: 'ok',
      settings: { access: ACCESS, secret: SECRET },
    });
    // Another file under the add-on's ID gets none of it.
    expect(loadAddonSettings(db, URL_, 'other-code')).toEqual({
      state: 'again',
      settings: { access: ACCESS },
    });
    // A backup restored on another phone can't open it: the keys are asked for again.
    setSecretBox(createSecretBox(random(32), random));
    expect(loadAddonSettings(db, URL_, null).state).toBe('again');
    expect(loadAddonSettings(db, 'lelap-local://other/manifest.json', null).state).toBe('none');
  });

  it('keeps the keys out of sync, exports, diagnostics and the scrobble outbox', () => {
    const db = setUp();
    enqueueScrobble(db, {
      profileId: ME,
      addons: listAddons(db),
      event: { event: 'start', at: 5, item: { type: 'audiobook', id: 'ol:OL1W', name: 'Walden' } },
      newId,
    });
    expect(db.select().from(scrobbleOutbox).all()).toHaveLength(1);
    const text = [
      JSON.stringify(collectOps(db, -1)),
      JSON.stringify(exportLibrary(db, 5)),
      diagnosticsReport(db, {
        app: { version: '1.0.0', platform: 'android', androidApi: 34 },
        settings: SettingsSchema.parse({}),
        health: (url) => new HealthTracker().get(url),
        now: 10,
      }),
      JSON.stringify(db.select().from(scrobbleOutbox).all()),
    ].join('\n');
    for (const secret of [ACCESS, SECRET]) expect(text).not.toContain(secret);
  });

  it('forgets the keys with the add-on', () => {
    const db = setUp();
    removeAddon(db, URL_, 2);
    expect(db.select().from(scrobblerSettings).all()).toEqual([]);
    expect(loadAddonSettings(db, URL_, null).state).toBe('none');
  });

  it('lets the sandbox reach the manifest’s hosts, and a stand-in only when one is named', () => {
    const settings = { access: ACCESS, secret: SECRET };
    expect(scrobblerCall(manifest, settings, { client: 'Lelap/1' })).toEqual({
      hosts: ['openlibrary.org'],
      settings: { ...settings, client: 'Lelap/1' },
    });
    expect(
      scrobblerCall(manifest, settings, { client: 'Lelap/1', server: 'http://localhost:18480/' }),
    ).toEqual({
      hosts: ['openlibrary.org', 'localhost:18480'],
      settings: { ...settings, client: 'Lelap/1', server: 'http://localhost:18480' },
    });
    for (const server of ['not an address', 'file:///etc/passwd', null])
      expect(scrobblerCall(manifest, settings, { client: 'x', server }).hosts).toEqual([
        'openlibrary.org',
      ]);
  });
});
