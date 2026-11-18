import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { HealthTracker } from '../addons/health';
import { installAddon, listAddons } from '../addons/repository';
import type { Db } from '../db';
import { addRemoteRoot } from '../library/scan';
import { books, downloads, syncState } from '../schema';
import { SettingsSchema } from '../settings';
import { SyncError } from '../sync/client';
import {
  addonFailureEvent,
  appErrorEvent,
  downloadFailureEvent,
  feedRefreshEvents,
  scanFailureEvent,
  syncFailureEvent,
} from './build';
import { addonResource, classifyError } from './classify';
import { castEvent, DiagnosticEvent, playerEvent } from './events';
import {
  DIAGNOSTICS_LIMIT,
  diagnosticsOn,
  listDiagnostics,
  recordDiagnostic,
  setDiagnosticsOn,
} from './log';
import { ago, diagnosticsReport, stripLeaks } from './report';

let n = 0;
const newId = () => `0190a1b2-c3d4-7e5f-8a9b-${String(++n).padStart(12, '0')}`;

const NOW = 1_800_000_000_000;

// Everything a person could be found by. None of these may reach an export.
const SECRETS = {
  webdavUrl: 'https://nas.knudsen-home.example:8443/remote.php/dav/files/kristoffer/Audiobooks/',
  webdavHost: 'nas.knudsen-home.example',
  webdavUser: 'kristoffer.knudsen',
  webdavPassword: 'hunter2-correct-horse',
  absUrl: 'https://abs.knudsen-home.example',
  absUser: 'kris',
  absKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJyb290Iiwia2V5SWQiOiJhYmMxMjMifQ.QmFzZTY0U2lnbmF0dXJlSGVyZQ',
  addonToken: 'eyJ0b2tlbiI6InNlY3JldC10b2tlbi02NzQ4MzkyIn0',
  addonHost: 'addon.example.net',
  addonApiKey: 'pi_4f9a8b7c6d5e4f3a2b1c',
  title: 'The Secret Diary of Kristoffer',
  author: 'Kristoffer Knudsen',
  path: '/storage/emulated/0/Audiobooks/Kristoffer/Secret Diary/01 Intro.mp3',
  syncKey: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5',
  groupId: 'group-7e1f2a9c4b3d',
  pairingCode: '7KQM-2XPA-9HRT',
  deviceName: 'Kristoffer’s Pixel',
};

const addonUrl = `https://${SECRETS.addonHost}/${SECRETS.addonToken}/manifest.json`;

const manifest: Manifest = {
  id: 'net.example.private-addon',
  version: '1.0.0',
  protocol: 1,
  name: 'Private add-on of Kristoffer',
  description: '',
  types: ['audiobook'],
  resources: ['catalog', 'stream'],
  catalogs: [],
};

function seededDb(): { db: Db; bookId: string; webdavId: string; absId: string } {
  const db = createTestDb();
  const webdavId = addRemoteRoot(
    db,
    {
      type: 'webdav',
      url: SECRETS.webdavUrl,
      username: SECRETS.webdavUser,
      password: SECRETS.webdavPassword,
    },
    NOW - 7_200_000,
    newId,
  );
  const absId = addRemoteRoot(
    db,
    {
      type: 'audiobookshelf',
      url: SECRETS.absUrl,
      username: SECRETS.absUser,
      userId: 'user-abs-1',
      token: SECRETS.absKey,
      keyRefused: true,
      libraryIds: ['lib-1'],
      profileId: 'default',
    },
    NOW - 7_200_000,
    newId,
  );
  installAddon(db, { url: addonUrl, manifest, now: NOW - 9_000_000, newId });
  const bookId = newId();
  db.insert(books)
    .values({
      id: bookId,
      rootId: webdavId,
      location: SECRETS.path,
      kind: 'file',
      title: SECRETS.title,
      author: SECRETS.author,
      durationMs: 3_600_000,
      addedAt: NOW - 8_000_000,
      updatedAt: NOW - 8_000_000,
    })
    .run();
  db.insert(downloads)
    .values({
      bookId,
      state: 'failed',
      bytesTotal: 0,
      error: `Failed to fetch ${SECRETS.webdavUrl}${SECRETS.title}.mp3`,
      requestedAt: NOW - 600_000,
      updatedAt: NOW - 600_000,
    })
    .run();
  db.insert(syncState)
    .values({
      key: 'membership',
      value: JSON.stringify({
        groupId: SECRETS.groupId,
        key: SECRETS.syncKey,
        deviceId: 'device-1',
        deviceName: SECRETS.deviceName,
        cursor: 4,
        pushedAt: NOW - 120_000,
        lastSyncAt: NOW - 120_000,
      }),
      updatedAt: NOW,
    })
    .run();
  return { db, bookId, webdavId, absId };
}

function exportOf(db: Db, health = new HealthTracker()): string {
  return diagnosticsReport(db, {
    app: { version: '1.4.0', platform: 'android', androidApi: 34 },
    settings: SettingsSchema.parse({ bedtimeStart: 1337 }),
    health: (url) => health.get(url),
    now: NOW,
  });
}

function expectClean(text: string): void {
  for (const [name, secret] of Object.entries(SECRETS)) {
    expect(text, name).not.toContain(secret);
  }
  // Pieces too: the user name inside a URL, the token's first characters.
  for (const piece of [
    'kristoffer',
    'Kristoffer',
    'knudsen',
    'hunter2',
    'eyJ',
    'Secret',
    '0190a1b2',
  ]) {
    expect(text).not.toContain(piece);
  }
  expect(text).not.toMatch(/https?:\/\//);
}

describe('diagnostics log', () => {
  it('is off by default and records nothing then', () => {
    const db = createTestDb();
    expect(diagnosticsOn(db)).toBe(false);
    expect(recordDiagnostic(db, { area: 'sync', what: 'failed' }, NOW)).toBe(false);
    expect(listDiagnostics(db)).toEqual([]);
  });

  it('keeps events while on and empties when turned off', () => {
    const db = createTestDb();
    setDiagnosticsOn(db, true, NOW);
    recordDiagnostic(db, { area: 'sync', what: 'failed', reason: 'offline' }, NOW);
    expect(listDiagnostics(db)).toEqual([
      { at: NOW, event: { area: 'sync', what: 'failed', reason: 'offline' } },
    ]);
    setDiagnosticsOn(db, false, NOW);
    expect(diagnosticsOn(db)).toBe(false);
    setDiagnosticsOn(db, true, NOW);
    expect(listDiagnostics(db)).toEqual([]);
  });

  it('keeps only the newest events', () => {
    const db = createTestDb();
    setDiagnosticsOn(db, true, NOW);
    for (let i = 0; i < DIAGNOSTICS_LIMIT + 25; i++) {
      recordDiagnostic(db, { area: 'app', what: 'error' }, NOW + i);
    }
    const kept = listDiagnostics(db);
    expect(kept).toHaveLength(DIAGNOSTICS_LIMIT);
    expect(kept[0]?.at).toBe(NOW + 25);
  });

  it('keeps the newest by time when the player’s events arrive late', () => {
    const db = createTestDb();
    setDiagnosticsOn(db, true, NOW);
    for (let i = 0; i < DIAGNOSTICS_LIMIT; i++) {
      recordDiagnostic(db, { area: 'app', what: 'error' }, NOW + i);
    }
    // Pulled from the player later, but older than everything kept.
    recordDiagnostic(db, { area: 'player', what: 'error', platform: 'android' }, NOW - 1);
    const kept = listDiagnostics(db);
    expect(kept).toHaveLength(DIAGNOSTICS_LIMIT);
    expect(kept[0]?.at).toBe(NOW);
    expect(kept.some((e) => e.event.area === 'player')).toBe(false);
  });

  it('refuses events that carry text', () => {
    const db = createTestDb();
    setDiagnosticsOn(db, true, NOW);
    const sneaky = {
      area: 'player',
      what: 'error',
      platform: 'android',
      title: SECRETS.title,
    } as unknown as DiagnosticEvent;
    expect(recordDiagnostic(db, sneaky, NOW)).toBe(false);
    expect(
      recordDiagnostic(
        db,
        { area: 'app', what: 'error', name: SECRETS.title } as unknown as DiagnosticEvent,
        NOW,
      ),
    ).toBe(false);
    expect(playerEvent({ at: NOW, what: SECRETS.webdavUrl }, 'android')).toBeNull();
    expect(listDiagnostics(db)).toEqual([]);
  });

  it('keeps a player event whose book ID is too long, without the book', () => {
    const parsed = playerEvent(
      { at: NOW, what: 'error', code: 2004, bookId: 'b'.repeat(201), part: 1 },
      'android',
    );
    expect(parsed?.event).toEqual({
      area: 'player',
      what: 'error',
      platform: 'android',
      code: 2004,
      part: 1,
    });
  });
});

describe('classifyError', () => {
  it('keeps the reason and status, not the text', () => {
    expect(classifyError(new SyncError(503, `group ${SECRETS.groupId} is busy`))).toEqual({
      reason: 'server',
      status: 503,
      name: 'Error',
    });
    expect(classifyError(`PROPFIND ${SECRETS.webdavUrl} answered 401`)).toMatchObject({
      reason: 'refused',
      status: 401,
    });
    expect(classifyError(new TypeError('Failed to fetch'))).toMatchObject({
      reason: 'offline',
      name: 'TypeError',
    });
    expect(
      classifyError({ message: 'The add-on took too long to answer', status: null }),
    ).toMatchObject({
      reason: 'timeout',
    });
    // Digits in a path are not a status.
    expect(classifyError('/Audiobooks/404 Pages/part 503.mp3')).toMatchObject({ status: null });
    const custom = new Error('nope');
    custom.name = SECRETS.title;
    expect(classifyError(custom).name).toBe('Error');
  });

  it('names the add-on resource from the path only', () => {
    expect(addonResource(addonUrl)).toBe('manifest');
    expect(
      addonResource(
        `https://${SECRETS.addonHost}/${SECRETS.addonToken}/stream/audiobook/ol1.json?key=1`,
      ),
    ).toBe('stream');
    expect(
      addonResource(`https://${SECRETS.addonHost}/x/catalog/podcast/top/search=diary.json`),
    ).toBe('catalog');
  });
});

describe('diagnostics export', () => {
  it('holds what failed and none of the personal data', () => {
    const { db, bookId, webdavId, absId } = seededDb();
    setDiagnosticsOn(db, true, NOW - 3_600_000);
    const [addon] = listAddons(db);
    const base = addonUrl.replace('manifest.json', '');
    const streamUrl = `${base}stream/audiobook/${encodeURIComponent(SECRETS.title)}.json?apikey=${SECRETS.addonApiKey}`;

    const health = new HealthTracker((b, url, failure) => {
      const event = addonFailureEvent(listAddons(db), b, url, failure);
      if (event) recordDiagnostic(db, event, NOW - 50_000);
    });
    health.record(
      streamUrl,
      { ok: false, message: 'The add-on answered 503', status: 503 },
      NOW - 50_000,
    );

    const at = NOW - 1_000_000;
    const events: DiagnosticEvent[] = [
      downloadFailureEvent(
        bookId,
        `Failed to fetch ${SECRETS.webdavUrl.replace('https://', `https://${SECRETS.webdavUser}:${SECRETS.webdavPassword}@`)}${SECRETS.title}.mp3: HTTP 401`,
      ),
      scanFailureEvent(
        webdavId,
        { type: 'webdav', url: SECRETS.webdavUrl, username: '', password: '' },
        new Error(`PROPFIND ${SECRETS.webdavUrl} timed out`),
      ),
      scanFailureEvent(
        absId,
        null,
        new Error(`Authorization: Bearer ${SECRETS.absKey} answered 401`),
      ),
      syncFailureEvent(
        new SyncError(403, `Pairing ${SECRETS.pairingCode} for ${SECRETS.deviceName}`),
      ),
      appErrorEvent(
        new TypeError(`Cannot read ${SECRETS.path} of ${SECRETS.title}`),
        'error',
        true,
      ),
    ];
    for (const event of events) expect(recordDiagnostic(db, event, at)).toBe(true);
    const fromPlayer = playerEvent(
      { at: at + 1, what: 'error', code: 2004, status: 403, bookId, part: 2 },
      'android',
    );
    expect(fromPlayer).not.toBeNull();
    if (fromPlayer) recordDiagnostic(db, fromPlayer.event, fromPlayer.at);

    const text = exportOf(db, health);
    expectClean(text);
    // The bedtime window says when someone sleeps.
    expect(text).not.toContain('bedtimeStart');
    expect(text).not.toContain('1337');

    expect(text).toContain('version  1.4.0');
    expect(text).toContain('server#1  webdav');
    expect(text).toContain('server#2  audiobookshelf  key refused');
    expect(text).toContain('addon#1  added  failing');
    expect(text).toContain('download  failed  refused  HTTP 401  book#1');
    expect(text).toContain('scan  failed  webdav  server#1  timeout');
    expect(text).toContain('sync  failed  refused  HTTP 403');
    expect(text).toContain('app  error  TypeError');
    expect(text).toContain(
      'player  error  IO_BAD_HTTP_STATUS (2004)  HTTP 403  android  book#1  part 3',
    );
    expect(text).toContain('addon  failed  addon#1  stream  server  HTTP 503');
    expect(text).toContain('on  last synced under 1 h ago');
    expect(text).toContain('under 1 h ago  download  failed');
    expect(text).toContain('downloads  0 done, 0 waiting, 1 failed');
    expect(addon).toBeDefined();
  });

  it('lists cast discovery events by kind, code and count', () => {
    const { db } = seededDb();
    setDiagnosticsOn(db, true, NOW);
    const raw = [
      { at: NOW - 5, what: 'start-failed', kind: 'cast', code: 7, count: 1 },
      { at: NOW - 4, what: 'started', kind: 'cast', code: null, count: 1 },
      { at: NOW - 3, what: 'found', kind: 'cast', code: null, count: 2 },
      { at: NOW - 2, what: 'resolve-failed', kind: 'fcast', code: -1, count: 1 },
      { at: NOW - 1, what: 'added', kind: 'cast', code: null, count: 2 },
    ];
    for (const event of raw) {
      const parsed = castEvent(event);
      expect(parsed).not.toBeNull();
      if (parsed) recordDiagnostic(db, parsed.event, parsed.at);
    }
    const text = exportOf(db);
    expectClean(text);
    expect(text).toContain('cast  start-failed  cast  FAILURE_PERMISSION_DENIED (7)');
    expect(text).toContain('cast  started  cast');
    expect(text).toContain('cast  found  cast  ×2');
    expect(text).toContain('cast  resolve-failed  fcast  THREW (-1)');
    expect(text).toContain('cast  added  cast  ×2');
  });

  it('refuses cast events that carry a name or an address', () => {
    expect(castEvent({ at: NOW, what: 'found', kind: SECRETS.title })).toBeNull();
    expect(castEvent({ at: NOW, what: SECRETS.webdavUrl, kind: 'cast' })).toBeNull();
    expect(
      DiagnosticEvent.safeParse({ area: 'cast', what: 'added', kind: 'cast', host: '192.168.1.5' })
        .success,
    ).toBe(false);
  });

  it('numbers items per export, not by their IDs', () => {
    const { db, bookId } = seededDb();
    setDiagnosticsOn(db, true, NOW);
    recordDiagnostic(db, { area: 'download', what: 'failed', book: 'another-book' }, NOW - 2);
    recordDiagnostic(db, { area: 'download', what: 'failed', book: bookId }, NOW - 1);
    const text = exportOf(db);
    expect(text).toContain('download  failed  book#1');
    expect(text).toContain('download  failed  book#2');
    expect(text).not.toContain('another-book');
  });

  it('sums up a background podcast refresh and keeps only the class of a feed’s error', () => {
    const { db } = seededDb();
    setDiagnosticsOn(db, true, NOW);
    const failures = [
      { podcastId: 'pod-a', error: new Error(`The feed answered HTTP 503. ${SECRETS.webdavUrl}`) },
      { podcastId: 'pod-b', error: new Error(`Not readable XML: ${SECRETS.title}`) },
    ];
    const events = feedRefreshEvents({ feeds: 12, failures }, true);
    events.forEach((event, i) => expect(recordDiagnostic(db, event, NOW - 10 + i)).toBe(true));
    const text = exportOf(db);
    expectClean(text);
    expect(text).toContain('podcast  refreshed  background  12 feeds  2 failed');
    expect(text).toContain('podcast  feed-failed  podcast#1  server  HTTP 503');
    expect(text).toContain('podcast  feed-failed  podcast#2  unreadable');
    expect(text).not.toContain('pod-a');
  });

  it('logs a refresh the app started only when a feed failed, and at most five feeds', () => {
    expect(feedRefreshEvents({ feeds: 3, failures: [] }, false)).toEqual([]);
    expect(feedRefreshEvents({ feeds: 0, failures: [] }, true)).toEqual([
      { area: 'podcast', what: 'refreshed', background: true, count: 0, failed: 0 },
    ]);
    const failures = Array.from({ length: 9 }, (_, i) => ({
      podcastId: `pod-${i}`,
      error: new Error('timeout'),
    }));
    const events = feedRefreshEvents({ feeds: 9, failures }, false);
    expect(events[0]).toEqual({ area: 'podcast', what: 'refreshed', count: 9, failed: 9 });
    expect(events).toHaveLength(6);
    expect(
      DiagnosticEvent.safeParse({ area: 'podcast', what: 'feed-failed', feed: SECRETS.absUrl })
        .success,
    ).toBe(false);
  });

  it('turned off, exports no log', () => {
    const { db } = seededDb();
    setDiagnosticsOn(db, true, NOW);
    recordDiagnostic(db, { area: 'sync', what: 'failed' }, NOW);
    setDiagnosticsOn(db, false, NOW);
    const text = exportOf(db);
    expect(text).toContain('## Log (0)');
    expectClean(text);
  });
});

describe('stripLeaks', () => {
  it('cuts addresses, paths, emails, keys and codes', () => {
    const line = `${SECRETS.webdavUrl} ${SECRETS.path} kris@example.org ${SECRETS.absKey} ${SECRETS.pairingCode} ${SECRETS.syncKey}`;
    const out = stripLeaks(line);
    for (const secret of [
      SECRETS.webdavUrl,
      'Kristoffer',
      'kris@',
      SECRETS.absKey,
      SECRETS.pairingCode,
      SECRETS.syncKey,
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it('leaves the report’s own words alone', () => {
    const line =
      'player  error  IO_NETWORK_CONNECTION_FAILED (2001)  downloadWhileChargingOnly  book#12';
    expect(stripLeaks(line)).toBe(line);
  });
});

describe('ago', () => {
  it('reads as a duration', () => {
    expect(ago(12_000)).toBe('under 1 h');
    expect(ago(59 * 60_000)).toBe('under 1 h');
    expect(ago(200 * 60_000)).toBe('3 h');
    expect(ago(50 * 3_600_000)).toBe('2 d');
  });
});
