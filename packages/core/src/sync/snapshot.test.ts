import { randomBytes } from 'node:crypto';

import type { Meta, Stream } from '@lelap/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { fakeSyncServer } from '../../test/syncServer';
import { addStreamedBook } from '../addons/streamed';
import { addBookmark, deleteBookmark, listBookmarks } from '../bookmarks';
import type { Db } from '../db';
import { getBook, setSpeed } from '../library/queries';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { books } from '../schema';
import { getSettings, setSetting } from '../settings';
import { SyncError } from './client';
import { authToken, deriveKeys, fromBase64Url, seal } from './crypto';
import {
  COMPACT_KEEP_MS,
  COMPACT_MIN_BYTES,
  compact,
  getMembership,
  joinWithCode,
  offerPairing,
  startSync,
  syncNow,
} from './engine';
import { bookIdForKey } from './keys';
import type { Op } from './ops';
import { openSnapshot, sealSnapshot, snapshotReducer } from './snapshot';

const random = (n: number) => new Uint8Array(randomBytes(n));
let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;
const DAY = 24 * 60 * 60_000;
const T0 = Date.UTC(2026, 0, 1);

const meta: Meta = { id: 'librivox:garden', type: 'audiobook', name: 'The Secret Garden' };
const stream: Stream = {
  sourceKey: 'librivox:garden:64kb',
  name: 'LibriVox',
  parts: [1, 2].map((i) => ({
    url: `https://audio.example/g${i}.mp3`,
    title: `Chapter ${i}`,
    durationMs: 60_000,
  })),
};
const GARDEN = 'addon:audiobook:librivox:garden';
const file = (i: number) => `stream:librivox:garden:64kb:${i}`;

describe('folding operations', () => {
  const progress = (at: number, ms: number): Op => ({
    type: 'progress',
    profile: ME,
    key: 'book',
    at,
    data: { fileLocation: 'f', fileIndex: 0, filePositionMs: ms, bookPositionMs: ms },
  });

  it('keeps the newest change per row, the first on equal times', () => {
    const r = snapshotReducer();
    r.add('a', 'Phone', [progress(10, 1), progress(30, 3)]);
    r.add('b', 'Laptop', [progress(20, 2), progress(30, 4)]);
    expect(r.entries()).toEqual([{ device: 'a', name: 'Phone', ops: [progress(30, 3)] }]);
  });

  it('keeps fields an older app version leaves out, and deletions beside re-adds', () => {
    const r = snapshotReducer();
    r.add('a', 'Phone', [
      { type: 'profile', key: 'p', at: 1, data: { name: 'Mia', createdAt: 1, avatar: 'fox' } },
      { type: 'delete', kind: 'bookmark', profile: ME, key: 'm', at: 5 },
    ]);
    r.add('b', 'Old tablet', [
      { type: 'profile', key: 'p', at: 2, data: { name: 'Mia B', createdAt: 1 } },
      { type: 'delete', kind: 'bookmark', profile: ME, key: 'm', at: 4 },
    ]);
    const ops = r.entries().flatMap((e) => e.ops);
    expect(ops).toEqual([
      { type: 'profile', key: 'p', at: 2, data: { name: 'Mia B', createdAt: 1, avatar: 'fox' } },
      { type: 'delete', kind: 'bookmark', profile: ME, key: 'm', at: 5 },
    ]);
  });

  it('folds operations of a type this version does not know, and caps them', () => {
    const future = (key: string, at: number, data: object) =>
      ({ type: 'rating', profile: ME, key, at, data }) as unknown as Op;
    const r = snapshotReducer(2);
    const odd = { type: 'shuffle', seed: 7 } as unknown as Op;
    r.add('a', 'Phone', [future('book', 3, { stars: 5 }), odd]);
    r.add('b', 'Tablet', [future('book', 4, { note: 'fine' }), future('book', 2, { stars: 1 })]);
    r.add('a', 'Phone', [future('other', 1, { stars: 2 }), future('third', 5, { stars: 3 })]);
    // Newest per row, keeping fields the newest leaves out; the oldest go past the cap.
    expect(r.entries().flatMap((e) => e.ops)).toEqual([
      future('book', 4, { stars: 5, note: 'fine' }),
      future('third', 5, { stars: 3 }),
    ]);
    // Within the cap nothing goes, including what doesn't look like a row change.
    const roomy = snapshotReducer();
    roomy.add('a', 'Phone', [odd, odd, future('book', 3, { stars: 5 })]);
    expect(roomy.entries()[0]?.ops).toEqual([odd, odd, future('book', 3, { stars: 5 })]);
  });

  it('seals a change as large as a message allows in a part of its own', () => {
    const key = random(32);
    const big: Op = {
      type: 'playlist',
      profile: ME,
      key: 'list',
      at: 1,
      data: { name: 'All', rule: null, items: ['x'.repeat(189_000)], createdAt: 1 },
    };
    const r = snapshotReducer();
    r.add('a', 'Phone', [progress(1, 1), big, progress(2, 2)]);
    const sealed = sealSnapshot(key, 'g', 1, 'u', r.entries(), random);
    expect(sealed.length).toBe(2);
    for (const part of sealed) expect(part.length).toBeLessThan(256 * 1024);
  });

  it('seals large snapshots in parts that only open in their place', () => {
    const key = random(32);
    const r = snapshotReducer();
    r.add(
      'a',
      'Phone',
      Array.from({ length: 3000 }, (_, i) => ({ ...progress(i, i), key: `book-${i}` })),
    );
    const sealed = sealSnapshot(key, 'g', 42, 'u', r.entries(), random);
    expect(sealed.length).toBeGreaterThan(1);
    for (const part of sealed) expect(part.length).toBeLessThan(256 * 1024);
    expect(openSnapshot(key, 'g', 42, 'u', sealed).flatMap((e) => e.ops)).toHaveLength(3000);
    expect(() => openSnapshot(key, 'g', 42, 'u', [...sealed].reverse())).toThrow('did not open');
    expect(() => openSnapshot(key, 'g', 43, 'u', sealed)).toThrow('did not open');
    expect(() => openSnapshot(key, 'g', 42, 'u', sealed.slice(1))).toThrow('did not open');
    // Another device's upload for the same point never opens as part of this one.
    expect(() => openSnapshot(key, 'g', 42, 'v', sealed)).toThrow('did not open');
  });
});

describe('snapshots between devices', () => {
  let phone: Db;
  let laptop: Db;
  let server: ReturnType<typeof fakeSyncServer>;

  /** Syncs at server time `at`; small `now` keeps the daily compaction check out of the way. */
  const sync = (db: Db, at: number) => {
    server.clock.now = at;
    return syncNow(db, server, random, at, newId);
  };
  const compactNow = async (db: Db, at: number, minBytes = 0) => {
    server.clock.now = at;
    const m = getMembership(db);
    if (!m) throw new Error('not syncing');
    const key = fromBase64Url(m.key);
    return compact(server, m.groupId, authToken(key), deriveKeys(key).enc, random, minBytes);
  };
  const join = async (name: string, at: number) => {
    const db = createTestDb();
    await joinWithCode(db, server, await offerPairing(phone, server, random), name, random, at);
    return db;
  };

  beforeEach(async () => {
    server = fakeSyncServer({ now: T0 });
    phone = createTestDb();
    await startSync(phone, server, 'Phone', random, T0);
    laptop = await join('Laptop', T0);
  });

  /** A month of listening on the phone, with a bookmark made and one deleted. */
  async function history(): Promise<string> {
    const bookId = addStreamedBook(phone, {
      addonUrl: 'https://addon.example/manifest.json',
      meta,
      stream,
      now: T0,
      newId,
    });
    const gone = addBookmark(phone, ME, newId, {
      bookId,
      fileLocation: file(0),
      filePositionMs: 1_000,
      note: 'Gone',
      now: T0 + 1,
    });
    addBookmark(phone, ME, newId, {
      bookId,
      fileLocation: file(0),
      filePositionMs: 2_000,
      note: 'Robin',
      now: T0 + 2,
    });
    await sync(phone, T0 + 10);
    for (let day = 1; day <= 20; day++) {
      const at = T0 + day * 3_600_000;
      saveProgress(
        phone,
        ME,
        { bookId, fileLocation: file(day % 2), filePositionMs: day * 1_000, savedAt: at },
        'app',
      );
      await sync(phone, at + 1);
    }
    deleteBookmark(phone, ME, gone, T0 + 21 * 3_600_000);
    setSetting(phone, ME, 'skipIntervalMs', 45_000, T0 + 22 * 3_600_000);
    await sync(phone, T0 + 22 * 3_600_000 + 1);
    return bookId;
  }

  it('lets a new device join from the snapshot instead of the whole log', async () => {
    await history();
    const groupId = getMembership(phone)?.groupId ?? '';
    const before = server.log(groupId).length;
    expect(before).toBeGreaterThan(20);

    // Only messages older than 30 days are folded in; nothing yet.
    expect(await compactNow(phone, T0 + 10 * DAY)).toBe(false);
    // A day after something new, the month-old log becomes one snapshot.
    setSetting(phone, ME, 'mono', true, T0 + 40 * DAY);
    await sync(phone, T0 + 40 * DAY);
    expect(await compactNow(phone, T0 + 40 * DAY + 1)).toBe(true);
    expect(server.log(groupId)).toHaveLength(1);
    expect(server.stored().join()).not.toContain('Secret Garden');

    const tablet = await join('Tablet', T0 + 41 * DAY);
    const result = await sync(tablet, T0 + 41 * DAY);
    const there = bookIdForKey(tablet, GARDEN) ?? '';
    expect(getBook(tablet, ME, there)?.book.bookPositionMs).toBe(20_000);
    expect(listBookmarks(tablet, ME, there).map((b) => b.note)).toEqual(['Robin']);
    expect(getSettings(tablet, ME)).toMatchObject({ skipIntervalMs: 45_000, mono: true });
    expect(result.handoffs).toEqual([
      expect.objectContaining({ bookId: there, bookPositionMs: 20_000, deviceName: 'Phone' }),
    ]);
  });

  it('catches up a device that was away from the snapshot, keeping its own newer changes', async () => {
    await history();
    await sync(phone, T0 + 40 * DAY);
    expect(await compactNow(phone, T0 + 40 * DAY + 1)).toBe(true);

    // The laptop never synced the history, and changed a setting meanwhile.
    setSetting(laptop, ME, 'skipIntervalMs', 10_000, T0 + 39 * DAY);
    await sync(laptop, T0 + 41 * DAY);
    const there = bookIdForKey(laptop, GARDEN) ?? '';
    expect(getBook(laptop, ME, there)?.book.bookPositionMs).toBe(20_000);
    expect(getSettings(laptop, ME).skipIntervalMs).toBe(10_000);
    await sync(phone, T0 + 42 * DAY);
    expect(getSettings(phone, ME).skipIntervalMs).toBe(10_000);
  });

  it('keeps changes for books the compacting device does not have', async () => {
    // A library folder on the laptop and the tablet (the same server), not on the phone.
    const local = (db: Db) =>
      db
        .insert(books)
        .values({
          id: newId(),
          location: 'webdav:shelf/Dune',
          kind: 'folder',
          source: 'local',
          title: 'Dune',
          durationMs: 1_000,
          addedAt: 1,
          updatedAt: 1,
        })
        .returning()
        .get().id;
    setSpeed(laptop, ME, local(laptop), 1.5, T0 + 5);
    await sync(laptop, T0 + 6);
    await sync(phone, T0 + 7);
    await sync(phone, T0 + 40 * DAY);
    expect(await compactNow(phone, T0 + 40 * DAY + 1)).toBe(true);

    const tablet = createTestDb();
    const dune = local(tablet);
    await joinWithCode(
      tablet,
      server,
      await offerPairing(phone, server, random),
      'Tablet',
      random,
      1,
    );
    await sync(tablet, T0 + 41 * DAY);
    expect(getBook(tablet, ME, dune)?.speed).toBe(1.5);
  });

  it('a newer snapshot builds on the one before', async () => {
    await history();
    await sync(phone, T0 + 40 * DAY);
    expect(await compactNow(phone, T0 + 40 * DAY + 1)).toBe(true);
    setSetting(laptop, ME, 'mono', true, T0 + 41 * DAY);
    await sync(laptop, T0 + 41 * DAY);
    await sync(phone, T0 + 80 * DAY);
    expect(await compactNow(phone, T0 + 80 * DAY + 1)).toBe(true);

    const tablet = await join('Tablet', T0 + 81 * DAY);
    await sync(tablet, T0 + 81 * DAY);
    expect(getBook(tablet, ME, bookIdForKey(tablet, GARDEN) ?? '')?.book.bookPositionMs).toBe(
      20_000,
    );
    expect(getSettings(tablet, ME)).toMatchObject({ skipIntervalMs: 45_000, mono: true });
  });

  it('drops nothing it can not read', async () => {
    await history();
    const m = getMembership(phone);
    const key = fromBase64Url(m?.key ?? '');
    // A message from a newer version of Lelap.
    server.clock.now = T0 + 1;
    await server.push(m?.groupId ?? '', authToken(key), 'f'.repeat(32), [
      seal(
        deriveKeys(key).enc,
        m?.groupId ?? '',
        JSON.stringify({ v: 2, device: 'f', name: 'New', ops: [] }),
        random,
      ),
    ]);
    const before = server.log(m?.groupId ?? '').length;
    expect(await compactNow(phone, T0 + 40 * DAY)).toBe(false);
    expect(server.log(m?.groupId ?? '')).toHaveLength(before);
  });

  it('compacts past a message that does not open with the group key', async () => {
    await history();
    const m = getMembership(phone);
    const groupId = m?.groupId ?? '';
    const key = fromBase64Url(m?.key ?? '');
    server.clock.now = T0 + 1;
    const wrong = seal(random(32), groupId, JSON.stringify({ v: 1, ops: [] }), random);
    const notJson = seal(deriveKeys(key).enc, groupId, 'not json', random);
    await server.push(groupId, authToken(key), 'f'.repeat(32), [wrong, notJson]);
    // The laptop skips them as it syncs, and so does compaction.
    await sync(laptop, T0 + 2);
    await sync(phone, T0 + 40 * DAY);
    expect(await compactNow(phone, T0 + 40 * DAY + 1)).toBe(true);
    expect(server.stored().join()).not.toContain(wrong);
    const tablet = await join('Tablet', T0 + 41 * DAY);
    await sync(tablet, T0 + 41 * DAY);
    expect(getSettings(tablet, ME).skipIntervalMs).toBe(45_000);
  });

  it('compacts nothing when no message opens at all', async () => {
    const m = getMembership(phone);
    const groupId = m?.groupId ?? '';
    server.clock.now = T0 + 1;
    await server.push(groupId, authToken(fromBase64Url(m?.key ?? '')), 'f'.repeat(32), [
      seal(random(32), groupId, '{}', random),
    ]);
    expect(await compactNow(phone, T0 + 40 * DAY)).toBe(false);
    expect(server.log(groupId)).toHaveLength(1);
  });

  it('makes room in a full group before giving up on a push', async () => {
    await history();
    const groupId = getMembership(phone)?.groupId ?? '';
    // The group is just full: nothing more fits until a snapshot replaces the old log.
    const cap = server.log(groupId).reduce((sum, m) => sum + m.data.length, 0);
    const push = server.push;
    let pushes = 0;
    server.push = async (id, token, device, messages) => {
      pushes++;
      const used = server.log(groupId).reduce((sum, m) => sum + m.data.length, 0);
      if (used + messages.join('').length > cap) throw new SyncError(413, 'This group is full.');
      return push(id, token, device, messages);
    };
    setSetting(phone, ME, 'mono', true, T0 + 40 * DAY);
    await sync(phone, T0 + 40 * DAY + 1);
    expect(pushes).toBe(2);
    expect(server.log(groupId).length).toBeLessThan(5);
    expect(getMembership(phone)?.pushedAt).toBe(T0 + 40 * DAY + 1);
  });

  it('checks once a day during sync, and only compacts a large enough log', async () => {
    await history();
    const groupId = getMembership(phone)?.groupId ?? '';
    const first = server.log(groupId)[0]?.seq;
    // The first sync a day later checks; the log is far below the threshold, so it stays.
    await sync(phone, T0 + 40 * DAY);
    expect(getMembership(phone)?.compactCheckedAt).toBe(T0 + 40 * DAY);
    expect(server.log(groupId)[0]?.seq).toBe(first);
    expect(await compactNow(phone, T0 + 40 * DAY, COMPACT_MIN_BYTES)).toBe(false);
    await sync(phone, T0 + 40 * DAY + 60_000);
    expect(getMembership(phone)?.compactCheckedAt).toBe(T0 + 40 * DAY);
    expect(COMPACT_KEEP_MS).toBe(30 * DAY);
  });
});
