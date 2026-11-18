import { randomBytes } from 'node:crypto';

import { LibraryResponse, type Manifest } from '@lelap/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { HealthTracker } from '../addons/health';
import { exportLibrary } from '../backup';
import { scanFailureEvent } from '../diagnostics/build';
import { diagnosticsReport } from '../diagnostics/report';
import { planDownload } from '../downloads';
import { listBooks } from '../library/queries';
import { addRemoteRoot, applyScan, listRoots, updateRemoteRoot } from '../library/scan';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { bookFiles, libraryRoots } from '../schema';
import { createSecretBox, plainBox, setSecretBox } from '../secrets';
import { SettingsSchema } from '../settings';
import { collectOps } from '../sync/ops';
import {
  type AddonSource,
  addonLibraryScan,
  addonLogin,
  addonPlaceReport,
  addonRootLocation,
  addonSettings,
  addonSource,
  addonSourceHosts,
  headersFor,
  sameAddonCode,
  sharedHeaders,
  withAddonLogin,
  withQuery,
} from './addon';

const random = (n: number) => new Uint8Array(randomBytes(n));
let n = 0;
const newId = () => `id-${++n}`;

const PASSWORD = 'correct-horse-battery';
const HEADER = 'Basic c2VjcmV0LWhlYWRlcg==';

const manifest: Manifest = {
  id: 'app.lelap.test-source',
  version: '1.0.0',
  protocol: 1,
  protocolVersion: 5,
  name: 'Test source',
  description: '',
  types: ['audiobook'],
  resources: ['library'],
  catalogs: [],
  sandbox: { hosts: ['covers.example'] },
  settings: [
    { key: 'url', label: 'Address', type: 'url', required: true, host: true },
    { key: 'user', label: 'User', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
  ],
};

const source = (headers = { Authorization: HEADER }): AddonSource =>
  addonSource({
    addonUrl: 'lelap-local://app.lelap.test-source/manifest.json',
    manifest,
    key: 'k1',
    settings: { url: 'http://nas.local:8080/books/', user: 'me', password: PASSWORD },
    headers,
  });

afterEach(() => setSecretBox(plainBox));

describe('an add-on as a library source', () => {
  it('keeps passwords apart from the plain fields and names the server by its host', () => {
    const remote = source();
    expect(remote.settings).toEqual({ url: 'http://nas.local:8080/books/', user: 'me' });
    expect(JSON.stringify(remote.settings)).not.toContain(PASSWORD);
    expect(remote.name).toBe('Test source · nas.local:8080');
    expect(addonSettings(remote)).toEqual({
      url: 'http://nas.local:8080/books/',
      user: 'me',
      password: PASSWORD,
    });
    expect(addonLogin(remote).headers).toEqual({ Authorization: HEADER });
  });

  it('reaches the manifest hosts and the address typed, nothing else', () => {
    const hosts = addonSourceHosts(manifest, source().settings);
    expect(hosts).toEqual(['covers.example', 'nas.local:8080']);
    const headers = { Authorization: HEADER };
    expect(headersFor('http://nas.local:8080/books/a.mp3', headers, hosts)).toEqual(headers);
    for (const elsewhere of [
      'http://nas.local:9090/a.mp3',
      'http://evil.example/a.mp3',
      'http://nas.local.evil.example:8080/a.mp3',
      'http://me:pw@nas.local:8080/a.mp3',
      'file:///sdcard/a.mp3',
    ]) {
      expect(headersFor(elsewhere, headers, hosts), elsewhere).toEqual({});
    }
  });

  it('trusts the login only with the file it was entered for', () => {
    const bundled = source();
    expect(sameAddonCode(bundled, null)).toBe(true);
    expect(sameAddonCode(bundled, 'abc')).toBe(false);
    const installed = addonSource({
      addonUrl: 'lelap-local://org.example.nas/manifest.json',
      manifest,
      key: 'k2',
      settings: { url: 'http://nas.local/' },
      codeSha: 'abc',
    });
    expect(sameAddonCode(installed, 'abc')).toBe(true);
    // Another file under the same ID, or the file gone.
    expect(sameAddonCode(installed, 'def')).toBe(false);
    expect(sameAddonCode(installed, null)).toBe(false);
  });

  it('opens only the port of an address typed without one', () => {
    const hosts = addonSourceHosts(manifest, { url: 'http://nas.local/books/' });
    expect(headersFor('http://nas.local/a.mp3', { A: 'b' }, hosts)).toEqual({ A: 'b' });
    expect(headersFor('http://nas.local:5000/admin', { A: 'b' }, hosts)).toEqual({});
    expect(headersFor('https://nas.local/a.mp3', { A: 'b' }, hosts)).toEqual({});
  });

  it('sends one set of headers for a book only when all its files get the same', () => {
    const login = { Authorization: HEADER };
    expect(sharedHeaders([{ headers: login }, { headers: { ...login } }])).toEqual(login);
    expect(sharedHeaders([{ headers: login }, { headers: {} }])).toEqual({});
    expect(sharedHeaders([])).toEqual({});
  });

  it('scans only files and covers on its own hosts into the library', () => {
    const db = createTestDb();
    const remote = source();
    const rootId = addRemoteRoot(db, remote, 1, newId);
    const response = LibraryResponse.parse({
      files: [
        {
          path: 'Herbert/Dune/01.mp3',
          url: 'http://nas.local:8080/books/Herbert/Dune/01.mp3',
          size: 10,
          durationMs: 60_000,
          album: 'Dune',
          albumArtist: 'Frank Herbert',
          ids: ['ISBN:978-0-441-17271-9'],
          cover: 'http://covers.example/dune.jpg',
        },
        {
          path: 'Herbert/Dune/02.mp3',
          url: 'http://nas.local:8080/books/Herbert/Dune/02.mp3',
          durationMs: 60_000,
          album: 'Dune',
          // A cover elsewhere could carry the settings out in its address.
          cover: `http://evil.example/c.jpg?pw=${PASSWORD}`,
        },
        { path: 'Leak/x.mp3', url: `http://evil.example/x.mp3?pw=${PASSWORD}`, durationMs: 1 },
        { path: 'Herbert/Dune/01.mp3', url: 'http://nas.local:8080/dupe.mp3', durationMs: 1 },
        {
          path: 'Herbert/Dune/cover.jpg',
          url: 'http://nas.local:8080/books/Herbert/Dune/cover.jpg',
        },
      ],
    });
    const location = addonRootLocation('k1');
    const scan = addonLibraryScan(location, response, addonSourceHosts(manifest, remote.settings));
    expect(scan.refused).toBe(2);
    expect(scan.listed.map((f) => f.relPath)).toEqual([
      'Herbert/Dune/01.mp3',
      'Herbert/Dune/02.mp3',
      'Herbert/Dune/cover.jpg',
    ]);
    expect(JSON.stringify([...scan.covers])).not.toContain('evil.example');
    expect(scan.tags.get(`${location}/Herbert/Dune/01.mp3`)?.ids).toEqual(['isbn:9780441172719']);

    applyScan(db, {
      rootId,
      rootLocation: location,
      listed: scan.listed,
      tags: scan.tags,
      folderCovers: new Map(),
      now: 2,
      newId,
    });
    const books = listBooks(db, ME, 'title');
    expect(books.map((b) => [b.title, b.author])).toEqual([['Dune', 'Frank Herbert']]);
  });

  it('seals the passwords and headers on the phone, and opens them again', () => {
    setSecretBox(createSecretBox(random(32), random));
    const db = createTestDb();
    const rootId = addRemoteRoot(db, source(), 1, newId);
    const stored = JSON.stringify(db.select().from(libraryRoots).all());
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(HEADER);

    const root = listRoots(db).find((r) => r.id === rootId);
    expect(root?.needsLogin).toBe(false);
    const opened = root?.remote as AddonSource;
    expect(addonSettings(opened).password).toBe(PASSWORD);

    // New headers after a scan are sealed too.
    updateRemoteRoot(
      db,
      rootId,
      withAddonLogin(opened, { ...addonLogin(opened), headers: { 'X-Token': 'fresh-token' } }),
      3,
    );
    expect(JSON.stringify(db.select().from(libraryRoots).all())).not.toContain('fresh-token');

    // A backup restored on another phone can't open them: the login is asked for again.
    setSecretBox(createSecretBox(random(32), random));
    const elsewhere = listRoots(db).find((r) => r.id === rootId);
    expect(elsewhere?.needsLogin).toBe(true);
    expect(addonLogin(elsewhere?.remote as AddonSource)).toEqual({
      passwords: {},
      headers: {},
      query: {},
    });
  });

  it('keeps settings and headers out of sync, exports, diagnostics and the scan log', () => {
    const db = createTestDb();
    const rootId = addRemoteRoot(db, source(), 1, newId);
    const text = [
      JSON.stringify(collectOps(db, -1)),
      JSON.stringify(exportLibrary(db, 5)),
      diagnosticsReport(db, {
        app: { version: '1.0.0', platform: 'android', androidApi: 34 },
        settings: SettingsSchema.parse({}),
        health: (url) => new HealthTracker().get(url),
        now: 10,
      }),
      JSON.stringify(
        scanFailureEvent(rootId, source(), new Error(`401 for ${PASSWORD} ${HEADER}`)),
      ),
    ].join('\n');
    for (const secret of [PASSWORD, HEADER, 'nas.local']) expect(text).not.toContain(secret);
  });
});

describe('revision 6: a login in the address, downloads and places', () => {
  const TOKEN = '26719a1196d2a940705a59634eb18eab';
  const query = { u: 'me', t: TOKEN, s: 'c19b2d' };
  const hosts = addonSourceHosts(manifest, { url: 'http://nas.local:8080/' });
  const stream = (id: string) => `http://nas.local:8080/rest/stream?id=${id}&format=raw`;
  const subsonic = (): AddonSource =>
    addonSource({
      addonUrl: 'lelap-local://app.lelap.test-source/manifest.json',
      manifest,
      key: 'k6',
      settings: { url: 'http://nas.local:8080/', user: 'me', password: PASSWORD },
      query,
      profileId: ME,
    });

  it('adds the query on the add-on’s own hosts only, over what the address had', () => {
    expect(withQuery(`${stream('a')}&t=old`, query, hosts)).toBe(
      `http://nas.local:8080/rest/stream?id=a&format=raw&t=${TOKEN}&u=me&s=c19b2d`,
    );
    expect(withQuery('http://evil.example/x.mp3', query, hosts)).toBe('http://evil.example/x.mp3');
    expect(withQuery(stream('a'), {}, hosts)).toBe(stream('a'));
  });

  it('keeps download addresses on its own hosts and takes the server’s places', () => {
    const response = LibraryResponse.parse({
      files: [
        {
          path: 'Writer/Town/001 One.mp3',
          url: stream('a'),
          downloadUrl: 'http://nas.local:8080/rest/download?id=a',
          place: { positionMs: 1500, at: 1000 },
        },
        {
          path: 'Writer/Town/002 Two.mp3',
          url: stream('b'),
          downloadUrl: 'http://evil.example/download?id=b',
        },
      ],
      query,
    });
    const location = addonRootLocation('k6');
    const scan = addonLibraryScan(location, response, hosts);
    expect(scan.listed.map((f) => f.downloadUri ?? null)).toEqual([
      'http://nas.local:8080/rest/download?id=a',
      null,
    ]);
    expect(scan.refused).toBe(1);
    expect(scan.places).toEqual([
      {
        fileLocation: `${location}/Writer/Town/001 One.mp3`,
        positionMs: 1500,
        played: false,
        at: 1000,
      },
    ]);
  });

  it('stores addresses without the token, and downloads from the download address', () => {
    setSecretBox(createSecretBox(random(32), random));
    const db = createTestDb();
    const rootId = addRemoteRoot(db, subsonic(), 1, newId);
    const location = addonRootLocation('k6');
    const response = LibraryResponse.parse({
      files: [
        {
          path: 'Writer/Town/001 One.mp3',
          url: stream('a'),
          downloadUrl: 'http://nas.local:8080/rest/download?id=a',
          size: 100,
          durationMs: 1000,
          album: 'Town',
        },
      ],
      query,
    });
    const scan = addonLibraryScan(location, response, hosts);
    applyScan(db, {
      rootId,
      rootLocation: location,
      listed: scan.listed,
      tags: scan.tags,
      folderCovers: new Map(),
      now: 2,
      newId,
    });
    const [file] = db.select().from(bookFiles).all();
    expect(file?.uri).toBe(stream('a'));
    const book = listBooks(db, ME, 'title')[0];
    expect(planDownload(db, book?.id ?? '').files[0]?.url).toBe(
      'http://nas.local:8080/rest/download?id=a',
    );

    const text = [
      JSON.stringify(db.select().from(libraryRoots).all()),
      JSON.stringify(db.select().from(bookFiles).all()),
      JSON.stringify(collectOps(db, -1)),
      JSON.stringify(exportLibrary(db, 5)),
      diagnosticsReport(db, {
        app: { version: '1.0.0', platform: 'android', androidApi: 34 },
        settings: SettingsSchema.parse({}),
        health: (url) => new HealthTracker().get(url),
        now: 10,
      }),
    ].join('\n');
    for (const secret of [PASSWORD, TOKEN, 'c19b2d']) expect(text).not.toContain(secret);
    const opened = listRoots(db).find((r) => r.id === rootId)?.remote as AddonSource;
    expect(addonLogin(opened).query).toEqual(query);
    expect(opened.profileId).toBe(ME);
  });

  it('reports a place by the listed path and the address without the login', () => {
    const root = addonRootLocation('k6');
    const files = [
      { location: `${root}/W/T/001 One.mp3`, uri: stream('a') },
      { location: `${root}/W/T/002 Two.mp3`, uri: stream('b') },
    ];
    const at = {
      location: files[1]?.location ?? '',
      positionMs: 1234.6,
      when: 99,
      finished: false,
    };
    expect(addonPlaceReport(root, files, at)).toEqual({
      file: { path: 'W/T/002 Two.mp3', url: stream('b') },
      files: [
        { path: 'W/T/001 One.mp3', url: stream('a') },
        { path: 'W/T/002 Two.mp3', url: stream('b') },
      ],
      positionMs: 1235,
      at: 99,
      finished: false,
    });
    const elsewhere = [...files, { location: 'webdav:nas/x.mp3', uri: 'http://nas/x.mp3' }];
    expect(addonPlaceReport(root, elsewhere, at)).toBeNull();
    expect(addonPlaceReport(root, files, { ...at, location: 'other' })).toBeNull();
  });
});
