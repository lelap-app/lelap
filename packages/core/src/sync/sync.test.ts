import { randomBytes } from 'node:crypto';

import type { Meta, Stream } from '@lelap/sdk';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { addStreamedBook } from '../addons/streamed';
import { addBookmark, deleteBookmark, listBookmarks } from '../bookmarks';
import type { Db } from '../db';
import { getBook, setSpeed } from '../library/queries';
import {
  listEpisodes,
  listSubscriptions,
  saveFeed,
  subscribe,
  episodeBook,
} from '../podcasts/repository';
import { parseFeed } from '../podcasts/rss';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { books, settings } from '../schema';
import { setSetting } from '../settings';
import { addToUpNext, listUpNext } from '../upNext';
import type { PulledMessage, SyncClient } from './client';
import {
  authHash,
  authToken,
  fromBase64Url,
  newPairingCode,
  normalizeCode,
  open,
  pairingKeys,
  seal,
  toBase64Url,
} from './crypto';
import { getMembership, joinWithCode, offerPairing, startSync, syncNow } from './engine';
import { bookIdForKey } from './keys';

const random = (n: number) => new Uint8Array(randomBytes(n));
let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

/** The server's behaviour, in memory: groups, an append-only log, single-use pairings. */
function fakeServer(): SyncClient & { stored: () => string[] } {
  const groups = new Map<string, { authHash: string; log: PulledMessage[] }>();
  const pairings = new Map<string, string>();
  const group = (id: string, token: string) => {
    const g = groups.get(id);
    if (!g || g.authHash !== authHash(token)) throw new Error('403');
    return g;
  };
  let seq = 0;
  return {
    createGroup: async (id, hash) => void groups.set(id, { authHash: hash, log: [] }),
    push: async (id, token, device, messages) => {
      const g = group(id, token);
      for (const data of messages) g.log.push({ seq: ++seq, device, data });
    },
    pull: async (id, token, after, limit) => {
      const messages = group(id, token)
        .log.filter((m) => m.seq > after)
        .slice(0, limit);
      return { messages, last: messages.at(-1)?.seq ?? after };
    },
    leave: async (id) => void groups.delete(id),
    putPairing: async (lookup, blob) => void pairings.set(lookup, blob),
    takePairing: async (lookup) => {
      const blob = pairings.get(lookup) ?? null;
      pairings.delete(lookup);
      return blob;
    },
    stored: () => [...groups.values()].flatMap((g) => g.log.map((m) => m.data)),
  };
}

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
    const episode = listEpisodes(phone, ME, podcastId)[0];
    const bookId = episodeBook(phone, episode?.id ?? '', 12, newId);
    const fileLocation = getBook(phone, ME, bookId)?.files[0]?.location ?? '';
    saveProgress(phone, ME, { bookId, fileLocation, filePositionMs: 4_000, savedAt: 13 }, 'app');

    await syncNow(phone, server, random, 100, newId);
    await syncNow(laptop, server, random, 110, newId);

    const [sub] = listSubscriptions(laptop, ME);
    expect(sub).toMatchObject({ feedUrl, title: 'Garden Hour' });
    expect(listEpisodes(laptop, ME, sub?.podcastId ?? '')[0]).toMatchObject({
      title: 'Roses',
      positionMs: 4_000,
    });
  });
});
