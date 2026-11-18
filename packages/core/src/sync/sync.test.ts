import { randomBytes } from 'node:crypto';

import type { Meta, Stream } from '@lelap/sdk';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { TEST_PAIRING_COST } from '../../test/setup';
import { fakeSyncServer } from '../../test/syncServer';
import { addStreamedBook } from '../addons/streamed';
import { addBookmark, deleteBookmark, listBookmarks } from '../bookmarks';
import type { Db } from '../db';
import { getBook, setSpeed } from '../library/queries';
import {
  listEpisodes,
  listSubscriptions,
  saveFeed,
  setTrim,
  subscribe,
  episodeBook,
} from '../podcasts/repository';
import { parseFeed } from '../podcasts/rss';
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  getTags,
  listPlaylists,
  playlistBooks,
  setTags,
} from '../organise';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { books, settings, subscriptions, syncState } from '../schema';
import { getSourceChoice, setSourceChoice } from '../addons/sources';
import { getSettings, setSetting } from '../settings';
import { addToUpNext, listUpNext } from '../upNext';
import {
  authToken,
  fromBase64Url,
  newPairingCode,
  normalizeCode,
  open,
  PAIRING_COST,
  pairingKeys,
  seal,
  setPairingCostForTests,
  toBase64Url,
  toHex,
} from './crypto';
import {
  getMembership,
  joinWithCode,
  offerPairing,
  packMessages,
  removedFromSync,
  resetSync,
  startSync,
  syncNow,
} from './engine';
import { bookIdForKey } from './keys';
import { applyOps, collectOps, fillMissingSkips, type Op } from './ops';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}

const random = (n: number) => new Uint8Array(randomBytes(n));
let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

const fakeServer = () => fakeSyncServer();

const meta: Meta = {
  id: 'librivox:garden',
  type: 'audiobook',
  name: 'The Secret Garden',
  cover: 'https://img.example/g.jpg',
};
const stream: Stream = {
  sourceKey: 'librivox:garden:64kb',
  name: 'LibriVox',
  parts: [1, 2].map((i) => ({
    url: `https://audio.example/g${i}.mp3`,
    title: `Chapter ${i}`,
    durationMs: 60_000,
  })),
};

describe('crypto', () => {
  it('round-trips base64url and seals to one key and context', () => {
    const bytes = random(37);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    const key = random(32);
    const sealed = seal(key, 'group', 'hello', random);
    expect(open(key, 'group', sealed)).toBe('hello');
    expect(open(random(32), 'group', sealed)).toBeNull();
    expect(open(key, 'other group', sealed)).toBeNull();
    expect(authToken(key)).not.toContain(toBase64Url(key));
  });

  it('makes pairing codes that survive sloppy typing', () => {
    const code = newPairingCode(random);
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(normalizeCode('7KQM-2XPA-9HRO')).toBe('7KQM-2XPA-9HR0');
    expect(normalizeCode('too short')).toBeNull();
  });

  // The other tests run scrypt at a lower cost (test/setup.ts). The expected bytes come from
  // Node's own scrypt, so this pins the parameters every installed app pairs with.
  it('derives pairing keys at the real cost', { timeout: 60_000 }, async () => {
    setPairingCostForTests(PAIRING_COST);
    try {
      const { lookup, key } = await pairingKeys('7KQM-2XPA-9HRT');
      expect(lookup).toBe('df8168d926d2605b2de9750efb7daa7c6f63bdd2cf8a9cdedaecb947bd4e2b9c');
      expect(toHex(key)).toBe('72ae76ec9df14af32b2d0d4870b6fccf9a4e895cf57e48f230918143be45a7fa');
    } finally {
      setPairingCostForTests(TEST_PAIRING_COST);
    }
  });
});

describe('sync between two devices', () => {
  let phone: Db;
  let laptop: Db;
  let server: ReturnType<typeof fakeServer>;

  beforeEach(async () => {
    phone = createTestDb();
    laptop = createTestDb();
    server = fakeServer();
    await startSync(phone, server, 'Phone', random, 1);
    const code = await offerPairing(phone, server, random);
    await joinWithCode(laptop, server, ` ${code.toLowerCase()} `, 'Laptop', random, 2);
  });

  it('pairs once with a code; the code can not be used again', async () => {
    expect(getMembership(laptop)?.groupId).toBe(getMembership(phone)?.groupId);
    const code = await offerPairing(phone, server, random);
    await joinWithCode(createTestDb(), server, code, 'Tablet', random, 3);
    await expect(joinWithCode(createTestDb(), server, code, 'Other', random, 4)).rejects.toThrow(
      'expired',
    );
  });

  it('refuses a pairing whose content is not a group', async () => {
    for (const secret of [
      '{"groupId":"x","key":"AAAA"}',
      '[]',
      JSON.stringify({ groupId: 'a'.repeat(32), key: toBase64Url(random(16)) }),
    ]) {
      const code = newPairingCode(random);
      const { lookup, key } = await pairingKeys(code);
      await server.putPairing(lookup, seal(key, 'lelap pairing', secret, random));
      await expect(joinWithCode(createTestDb(), server, code, 'Odd', random, 5)).rejects.toThrow(
        'damaged',
      );
    }
  });

  it('removes a lost device by resetting the group; the others pair again', async () => {
    setSetting(phone, ME, 'skipIntervalMs', 45_000, 10);
    await syncNow(phone, server, random, 11, newId);
    const before = getMembership(phone);
    const after = await resetSync(phone, server, random, 12);
    expect(after.groupId).not.toBe(before?.groupId);
    expect(after.key).not.toBe(before?.key);
    expect(after.deviceName).toBe('Phone');

    // The laptop (or a lost phone) finds its group gone and stops, keeping its data.
    await syncNow(laptop, server, random, 13, newId);
    expect(getMembership(laptop)).toBeNull();
    expect(removedFromSync(laptop)).toEqual({ at: 13, reason: 'reset' });

    // Everything goes to the new group; a device that pairs again gets it.
    await syncNow(phone, server, random, 14, newId);
    const code = await offerPairing(phone, server, random);
    await joinWithCode(laptop, server, code, 'Laptop', random, 15);
    expect(removedFromSync(laptop)).toBeNull();
    const tablet = createTestDb();
    await joinWithCode(
      tablet,
      server,
      await offerPairing(phone, server, random),
      'Tablet',
      random,
      16,
    );
    await syncNow(tablet, server, random, 17, newId);
    expect(getSettings(tablet, ME).skipIntervalMs).toBe(45_000);

    // Resetting again after the old group is already gone still works.
    await server.leave(after.groupId, authToken(fromBase64Url(after.key)));
    await expect(resetSync(phone, server, random, 18)).resolves.toBeTruthy();
  });

  it('carries a streamed book with its place, bookmark, speed, Up Next and settings', async () => {
    const bookId = addStreamedBook(phone, {
      addonUrl: 'https://addon.example/manifest.json',
      meta,
      stream,
      now: 10,
      newId,
    });
    const location = phone.select().from(books).where(eq(books.id, bookId)).get()?.location ?? '';
    saveProgress(
      phone,
      ME,
      { bookId, fileLocation: 'stream:librivox:garden:64kb:1', filePositionMs: 5_000, savedAt: 20 },
      'app',
    );
    addBookmark(phone, ME, newId, {
      bookId,
      fileLocation: 'stream:librivox:garden:64kb:0',
      filePositionMs: 1_000,
      note: 'Robin',
      now: 21,
    });
    setSpeed(phone, ME, bookId, 1.5, 22);
    addToUpNext(phone, ME, bookId, 'last', 23);
    setSetting(phone, ME, 'skipIntervalMs', 15_000, 24);
    setSetting(phone, ME, 'downloadOnWifiOnly', false, 25);
    setSetting(phone, ME, 'mono', true, 26);
    setSetting(phone, ME, 'volumeBoost', true, 27);

    expect((await syncNow(phone, server, random, 100, newId)).pushed).toBeGreaterThan(0);
    const result = await syncNow(laptop, server, random, 200, newId);

    const there = bookIdForKey(laptop, location);
    expect(there).not.toBeNull();
    const detail = getBook(laptop, ME, there ?? '');
    expect(detail?.book).toMatchObject({
      title: 'The Secret Garden',
      bookPositionMs: 65_000,
      source: 'addon',
    });
    expect(detail?.speed).toBe(1.5);
    expect(detail?.chapters).toHaveLength(2);
    expect(listBookmarks(laptop, ME, there ?? '')[0]?.note).toBe('Robin');
    expect(listUpNext(laptop, ME).map((i) => i.bookId)).toEqual([there]);
    const synced = laptop
      .select()
      .from(settings)
      .all()
      .map((s) => s.key);
    expect(synced).toContain('skipIntervalMs');
    expect(synced).not.toContain('downloadOnWifiOnly');
    // Mono follows the listener's ears; the boost suits this phone's speaker.
    expect(synced).toContain('mono');
    expect(synced).not.toContain('volumeBoost');
    expect(result.handoffs).toEqual([
      { bookId: there, profileId: ME, bookPositionMs: 65_000, at: 20, deviceName: 'Phone' },
    ]);
    // The server only ever saw ciphertext.
    expect(server.stored().join()).not.toContain('Secret Garden');
  });

  it('keeps the newest place and spreads deletions', async () => {
    const bookId = addStreamedBook(phone, {
      addonUrl: 'https://a.example/manifest.json',
      meta,
      stream,
      now: 10,
      newId,
    });
    saveProgress(
      phone,
      ME,
      { bookId, fileLocation: 'stream:librivox:garden:64kb:0', filePositionMs: 1_000, savedAt: 20 },
      'app',
    );
    const mark = addBookmark(phone, ME, newId, {
      bookId,
      fileLocation: 'stream:librivox:garden:64kb:0',
      filePositionMs: 500,
      note: null,
      now: 21,
    });
    await syncNow(phone, server, random, 100, newId);
    await syncNow(laptop, server, random, 110, newId);
    const there = bookIdForKey(laptop, 'addon:audiobook:librivox:garden') ?? '';

    // The laptop listens further later; the phone's older place must not win back.
    saveProgress(
      laptop,
      ME,
      {
        bookId: there,
        fileLocation: 'stream:librivox:garden:64kb:1',
        filePositionMs: 9_000,
        savedAt: 300,
      },
      'app',
    );
    deleteBookmark(phone, ME, mark, 310);
    await syncNow(laptop, server, random, 400, newId);
    await syncNow(phone, server, random, 410, newId);
    await syncNow(laptop, server, random, 420, newId);

    expect(getBook(phone, ME, bookId)?.book.bookPositionMs).toBe(69_000);
    expect(getBook(laptop, ME, there)?.book.bookPositionMs).toBe(69_000);
    expect(listBookmarks(laptop, ME, there)).toEqual([]);
  });

  it('carries tags and playlists, and a deleted playlist', async () => {
    const bookId = addStreamedBook(phone, {
      addonUrl: 'https://a.example/manifest.json',
      meta,
      stream,
      now: 10,
      newId,
    });
    setTags(phone, ME, bookId, ['Classic', 'sleep'], 20);
    const list = createPlaylist(phone, ME, newId, { name: 'Bedtime', rule: null }, 21);
    addToPlaylist(phone, ME, list, bookId, 22);
    const smart = createPlaylist(
      phone,
      ME,
      newId,
      { name: 'Done', rule: { status: 'finished' } },
      23,
    );
    await syncNow(phone, server, random, 100, newId);
    await syncNow(laptop, server, random, 110, newId);

    const there = bookIdForKey(laptop, 'addon:audiobook:librivox:garden') ?? '';
    expect(getTags(laptop, ME, there)).toEqual(['classic', 'sleep']);
    const lists = listPlaylists(laptop, ME);
    expect(lists.map((p) => [p.name, p.rule])).toEqual([
      ['Bedtime', null],
      ['Done', { status: 'finished' }],
    ]);
    expect(playlistBooks(laptop, ME, must(lists[0])).map((b) => b.id)).toEqual([there]);

    deletePlaylist(laptop, ME, smart, 300);
    await syncNow(laptop, server, random, 400, newId);
    await syncNow(phone, server, random, 410, newId);
    expect(listPlaylists(phone, ME).map((p) => p.name)).toEqual(['Bedtime']);
  });

  it('carries profiles with avatar, PIN and kids limits, and their deletion', async () => {
    const { createProfile, deleteProfile, getProfile, setPin } = await import('../profiles');
    const kid = createProfile(
      phone,
      { name: 'Mia', avatar: 'fox', kids: true, hiddenAddons: ['https://x.example/manifest.json'] },
      10,
      newId,
    );
    setPin(phone, kid, '2468', 11);
    await syncNow(phone, server, random, 100, newId);
    await syncNow(laptop, server, random, 110, newId);
    expect(getProfile(laptop, kid)).toMatchObject({
      name: 'Mia',
      avatar: 'fox',
      kids: true,
      hiddenAddons: ['https://x.example/manifest.json'],
      pinHash: getProfile(phone, kid)?.pinHash,
    });
    deleteProfile(laptop, kid, 200);
    await syncNow(laptop, server, random, 300, newId);
    await syncNow(phone, server, random, 310, newId);
    expect(getProfile(phone, kid)).toBeNull();
  });

  it('carries podcast subscriptions and episode places', async () => {
    const xml = `<rss><channel><title>Garden Hour</title>
      <item><title>Roses</title><guid>ep-1</guid><enclosure url="https://cdn.example/1.mp3" type="audio/mpeg" length="10"/></item>
    </channel></rss>`;
    const feedUrl = 'https://feeds.example/garden.xml';
    const { podcastId } = saveFeed(
      phone,
      feedUrl,
      parseFeed(xml),
      { etag: null, lastModified: null },
      10,
      newId,
    );
    subscribe(phone, ME, podcastId, 11);
    setTrim(phone, ME, podcastId, { skipIntroMs: 30_000, skipOutroMs: 15_000 }, 11);
    const episode = listEpisodes(phone, ME, podcastId)[0];
    const bookId = episodeBook(phone, episode?.id ?? '', 12, newId);
    const fileLocation = getBook(phone, ME, bookId)?.files[0]?.location ?? '';
    saveProgress(phone, ME, { bookId, fileLocation, filePositionMs: 4_000, savedAt: 13 }, 'app');

    await syncNow(phone, server, random, 100, newId);
    await syncNow(laptop, server, random, 110, newId);

    const [sub] = listSubscriptions(laptop, ME);
    expect(sub).toMatchObject({
      feedUrl,
      title: 'Garden Hour',
      skipIntroMs: 30_000,
      skipOutroMs: 15_000,
    });
    expect(listEpisodes(laptop, ME, sub?.podcastId ?? '')[0]).toMatchObject({
      title: 'Roses',
      positionMs: 4_000,
    });
  });

  it('carries the source picked for a work, checked, and old versions skip it', async () => {
    const choice = { addonUrl: 'https://addon.example/manifest.json', sourceKey: 'garden:128kb' };
    setSourceChoice(phone, ME, 'audiobook', 'librivox:garden', choice, 30);
    await syncNow(phone, server, random, 100, newId);
    await syncNow(laptop, server, random, 110, newId);
    expect(getSourceChoice(laptop, ME, 'audiobook', 'librivox:garden')).toEqual(choice);
    // The source choice is no playback setting.
    expect(getSettings(laptop, ME)).not.toHaveProperty('source:audiobook:librivox:garden');

    // A newer pick wins; an older one, or one that isn't a source, changes nothing.
    const later = { ...choice, sourceKey: 'garden:64kb' };
    const op = (at: number, data: unknown) =>
      ({ type: 'source', profile: ME, key: 'audiobook:librivox:garden', at, data }) as Op;
    applyOps(laptop, [op(20, later)], 120, newId);
    applyOps(laptop, [op(40, { addonUrl: 'javascript:alert(1)', sourceKey: 'x' })], 120, newId);
    applyOps(laptop, [op(41, { addonUrl: choice.addonUrl })], 120, newId);
    applyOps(laptop, [{ ...op(42, later), key: 'no-type' }], 120, newId);
    expect(getSourceChoice(laptop, ME, 'audiobook', 'librivox:garden')).toEqual(choice);
    applyOps(laptop, [op(50, later)], 120, newId);
    expect(getSourceChoice(laptop, ME, 'audiobook', 'librivox:garden')).toEqual(later);

    // A version before M68 knows no `source`: it sorts last and is skipped, as any unknown type.
    const unknown = { type: 'rating', profile: ME, key: 'k', at: 60, data: {} } as unknown as Op;
    expect(applyOps(laptop, [unknown], 130, newId)).toEqual([]);
  });

  it('sends a large first sync in messages and pushes the server takes', async () => {
    const pushes: number[] = [];
    const push = server.push;
    server.push = async (id, token, device, messages) => {
      pushes.push(messages.length);
      return push(id, token, device, messages);
    };
    // 60 lists of about 100 KB each: two to a message would pass the server's 256 KB.
    for (let i = 0; i < 60; i++) {
      createPlaylist(phone, ME, newId, { name: `${i} ${'x'.repeat(100_000)}`, rule: null }, 10);
    }
    expect((await syncNow(phone, server, random, 100, newId)).pushed).toBeGreaterThan(60);
    expect(pushes.length).toBeGreaterThan(1);
    expect(Math.max(...pushes)).toBeLessThanOrEqual(50);
    await syncNow(laptop, server, random, 110, newId);
    expect(listPlaylists(laptop, ME)).toHaveLength(60);
    // About 6 MB to encrypt, send and read back: seconds on a CI runner, so more than the default.
  }, 30_000);

  it('packs messages by size and count, leaving out a change too large to send', () => {
    const setting = (i: number, size = 1000): Op => ({
      type: 'setting',
      profile: ME,
      key: 'mono',
      at: i,
      data: { value: 'x'.repeat(size) },
    });
    const huge = setting(0, 200_000);
    const envelopes = packMessages(
      [huge, ...Array.from({ length: 450 }, (_, i) => setting(i + 1))],
      'd',
      'Phone',
    );
    expect(envelopes.length).toBe(3);
    for (const e of envelopes) expect(JSON.stringify(e).length).toBeLessThanOrEqual(190_000);
    expect(envelopes.flatMap((e) => e.ops)).toHaveLength(450);
    expect(envelopes.flatMap((e) => e.ops)).not.toContain(huge);
    const small = packMessages(
      Array.from({ length: 450 }, (_, i) => setting(i, 0)),
      'd',
      'Phone',
    );
    expect(small.map((e) => e.ops.length)).toEqual([200, 200, 50]);
  });

  it('fills in a show’s intro and outro that a version before M45 left out', async () => {
    const xml = `<rss><channel><title>Garden Hour</title></channel></rss>`;
    const feedUrl = 'https://feeds.example/garden.xml';
    const show = (db: Db) =>
      saveFeed(db, feedUrl, parseFeed(xml), { etag: null, lastModified: null }, 10, newId)
        .podcastId;
    const podcastId = show(phone);
    subscribe(phone, ME, podcastId, 11);
    setTrim(phone, ME, podcastId, { skipIntroMs: 30_000, skipOutroMs: 15_000 }, 12);
    await syncNow(phone, server, random, 100, newId);
    await syncNow(laptop, server, random, 110, newId);
    // As an old version left it: the change's time, but no intro or outro.
    laptop.update(subscriptions).set({ skipIntroMs: 0, skipOutroMs: 0 }).run();
    laptop.delete(syncState).where(eq(syncState.key, 'skipsFilled')).run();

    await syncNow(laptop, server, random, 120, newId);
    expect(listSubscriptions(laptop, ME)[0]).toMatchObject({
      skipIntroMs: 30_000,
      skipOutroMs: 15_000,
    });
    // The row keeps its time, so it is not sent back.
    expect(laptop.select().from(subscriptions).get()?.updatedAt).toBe(12);
    expect(collectOps(laptop, 110).filter((op) => op.type === 'subscription')).toEqual([]);
    // Once per device: a show cleared later stays cleared.
    laptop.update(subscriptions).set({ skipIntroMs: 0, skipOutroMs: 0 }).run();
    await syncNow(laptop, server, random, 130, newId);
    expect(listSubscriptions(laptop, ME)[0]?.skipIntroMs).toBe(0);
  });

  it('keeps only web covers from another device', () => {
    const book = (key: string, coverUrl: string): Op => ({
      type: 'book',
      key,
      at: 5,
      data: {
        title: 'Hostile',
        author: null,
        kind: 'file',
        coverUrl,
        addonItem: null,
        durationMs: 1000,
        parts: [],
        chapters: [],
      },
    });
    applyOps(
      laptop,
      [
        book('m96:a', 'file:///data/user/0/app.lelap/databases/lelap.db'),
        book('m96:b', 'content://app.lelap.fileprovider/x'),
        book('m96:c', 'https://covers.example/c.jpg'),
      ],
      10,
      newId,
    );
    const covers = Object.fromEntries(
      laptop
        .select({ location: books.location, coverUrl: books.coverUrl })
        .from(books)
        .all()
        .map((b) => [b.location, b.coverUrl]),
    );
    expect(covers).toMatchObject({
      'm96:a': null,
      'm96:b': null,
      'm96:c': 'https://covers.example/c.jpg',
    });
  });

  it('fills intro and outro only from the newest change that carries them', () => {
    const feedUrl = 'https://feeds.example/garden.xml';
    const { podcastId } = saveFeed(
      laptop,
      feedUrl,
      parseFeed('<rss><channel><title>Garden Hour</title></channel></rss>'),
      { etag: null, lastModified: null },
      10,
      newId,
    );
    subscribe(laptop, ME, podcastId, 50);
    const sub = (at: number, skips: { skipIntroMs?: number; skipOutroMs?: number }): Op => ({
      type: 'subscription',
      profile: ME,
      key: feedUrl,
      at,
      data: {
        title: 'Garden Hour',
        coverUrl: null,
        autoDownload: false,
        keepLatest: 0,
        subscribedAt: 1,
        ...skips,
      },
    });
    const removed: Op = { type: 'delete', kind: 'subscription', profile: ME, key: feedUrl, at: 30 };
    // Removed after the only change with values: a later subscription starts without them.
    expect(
      fillMissingSkips(laptop, [sub(20, { skipIntroMs: 9_000 }), removed, sub(40, {})], 100),
    ).toBe(0);
    // A newer 0 wins over an older value.
    expect(
      fillMissingSkips(
        laptop,
        [sub(35, { skipIntroMs: 9_000 }), sub(45, { skipIntroMs: 0, skipOutroMs: 0 })],
        100,
      ),
    ).toBe(0);
    // Not yet pushed from here: left alone.
    expect(fillMissingSkips(laptop, [sub(35, { skipIntroMs: 9_000 })], 40)).toBe(0);
    expect(fillMissingSkips(laptop, [sub(35, { skipIntroMs: 9_000 }), sub(40, {})], 100)).toBe(1);
    expect(listSubscriptions(laptop, ME)[0]).toMatchObject({ skipIntroMs: 9_000, skipOutroMs: 0 });
  });
});
