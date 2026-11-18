import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { ROOT, scanned } from '../test/files';
import type { Db } from './db';
import type { ScannedFile } from './library/files';
import { applyScan, splitScanned, upsertRoot } from './library/scan';
import {
  CLIP_MAX_MS,
  findPlaceBook,
  findPlaceEpisode,
  isShareableFeed,
  parsePlace,
  placeOfBook,
  placeUrl,
  type SharedPlace,
} from './placeLink';
import { episodeBook, listEpisodes, saveFeed, subscribe } from './podcasts/repository';
import { parseFeed } from './podcasts/rss';
import { createProfile, DEFAULT_PROFILE_ID as ME } from './profiles';
import { books, episodes, workLinks } from './schema';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

function scan(db: Db, files: ScannedFile[], now = 100) {
  const rootId = upsertRoot(
    db,
    { uri: `content://${ROOT}`, name: 'Audiobooks', location: ROOT },
    now,
    newId,
  );
  const { listed, tags } = splitScanned(files);
  applyScan(db, { rootId, rootLocation: ROOT, listed, tags, folderCovers: new Map(), now, newId });
}

const idOf = (db: Db, location: string) => {
  const book = db.select().from(books).where(eq(books.location, location)).get();
  if (!book) throw new Error(`no book at ${location}`);
  return book.id;
};

const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

const dune: SharedPlace = {
  title: 'Dune',
  author: 'Frank Herbert',
  ids: ['isbn:9780441172719'],
  work: { type: 'audiobook', id: 'ol:OL893415W' },
  atMs: 8_070_400,
  toMs: 8_100_900,
};

describe('a shared place', () => {
  it('goes through a link and back, in whole seconds', () => {
    const url = placeUrl('https://listen.example.org/', dune);
    expect(url.startsWith('https://listen.example.org/place?')).toBe(true);
    expect(parsePlace(query(url))).toEqual({ ...dune, atMs: 8_070_000, toMs: 8_100_000 });
  });

  it('never carries the file, the folder or the audio', () => {
    const db = createTestDb();
    scan(db, [scanned('Private folder/Dune/01.mp3', { album: 'Dune', artist: 'Frank Herbert' })]);
    const bookId = idOf(db, `${ROOT}/Private folder/Dune`);
    const place = placeOfBook(db, bookId, 5_000);
    if (!place) throw new Error('no place');
    const url = placeUrl('https://listen.example.org', place);
    expect(url).not.toMatch(/Private|content|primary|mp3/);
    expect(query(url)).toEqual({ t: 'Dune', a: 'Frank Herbert', at: '5' });
  });

  it('leaves out an author taken from a folder name, and an add-on item ID that is a path', () => {
    const db = createTestDb();
    scan(db, [scanned('Frank Herbert/Dune/01.mp3')]);
    const place = placeOfBook(db, idOf(db, `${ROOT}/Frank Herbert/Dune`), 0);
    expect(place?.author).toBeNull();
    db.update(books)
      .set({
        source: 'addon',
        addonItem: {
          addonUrl: 'https://x.example',
          type: 'audiobook',
          id: 'lib:/home/me/a',
          sourceKey: 'k',
        },
      })
      .where(eq(books.location, `${ROOT}/Frank Herbert/Dune`))
      .run();
    expect(placeOfBook(db, idOf(db, `${ROOT}/Frank Herbert/Dune`), 0)?.work).toBeNull();
  });

  it('turns down a link without a title or a time, and keeps a clip short', () => {
    expect(parsePlace({ at: '5' })).toBeNull();
    expect(parsePlace({ t: 'Dune', at: '-5' })).toBeNull();
    expect(parsePlace({ t: 'Dune', at: '1e9' })).toBeNull();
    const long = parsePlace({
      t: 'Dune',
      at: '10',
      to: '100000',
      w: 'Not a work',
      ids: 'x,isbn:1',
    });
    expect(long).toEqual({
      title: 'Dune',
      author: null,
      ids: [],
      work: null,
      atMs: 10_000,
      toMs: 10_000 + CLIP_MAX_MS,
    });
    expect(parsePlace({ t: 'Dune', at: '10', to: '5' })?.toMs).toBeNull();
  });

  it('names a linked book’s work and ISBN', () => {
    const db = createTestDb();
    scan(db, [scanned('Dune/01.mp3', { ids: ['isbn:0441172717'] })]);
    db.insert(workLinks)
      .values({
        bookKey: `${ROOT}/Dune`,
        workType: 'audiobook',
        workId: 'ol:OL893415W',
        state: 'linked',
        ids: ['ol:OL893415W'],
        meta: null,
        updatedAt: 1,
      })
      .run();
    const place = placeOfBook(db, idOf(db, `${ROOT}/Dune`), 1_000, 400_000);
    expect(place?.work).toEqual({ type: 'audiobook', id: 'ol:OL893415W' });
    expect(place?.ids).toEqual(['isbn:9780441172719', 'ol:OL893415W']);
    expect(place?.toMs).toBe(1_000 + CLIP_MAX_MS);
  });

  it('leaves out a matched work whose ID is an address', () => {
    const db = createTestDb();
    scan(db, [scanned('Dune/01.mp3', { ids: ['isbn:0441172717'] })]);
    db.insert(workLinks)
      .values({
        bookKey: `${ROOT}/Dune`,
        workType: 'audiobook',
        workId: 'x:https://user:secret@nas.home/books/dune',
        state: 'linked',
        ids: [],
        meta: null,
        updatedAt: 1,
      })
      .run();
    const place = placeOfBook(db, idOf(db, `${ROOT}/Dune`), 1_000, 2_000);
    expect(place?.work ?? null).toBeNull();
    expect(JSON.stringify(place)).not.toContain('secret');
  });
});

describe('finding the listener’s own copy', () => {
  it('by ISBN, then by title and author, and not at all for another book', () => {
    const db = createTestDb();
    scan(db, [
      scanned('A/01.mp3', { ids: ['isbn:9780441172719'], album: 'Something else' }),
      scanned('B/01.mp3', { album: 'Dune', artist: 'Frank Herbert' }),
    ]);
    expect(findPlaceBook(db, ME, dune)).toBe(idOf(db, `${ROOT}/A`));
    expect(findPlaceBook(db, ME, { ...dune, ids: [], work: null })).toBe(idOf(db, `${ROOT}/B`));
    expect(
      findPlaceBook(db, ME, { ...dune, title: 'Emma', author: 'Jane Austen', ids: [] }),
    ).toBeNull();
  });

  it('by the work it is linked to', () => {
    const db = createTestDb();
    scan(db, [scanned('Unnamed/01.mp3')]);
    db.insert(workLinks)
      .values({
        bookKey: `${ROOT}/Unnamed`,
        workType: 'audiobook',
        workId: 'ol:OL893415W',
        state: 'linked',
        ids: [],
        meta: null,
        updatedAt: 1,
      })
      .run();
    expect(findPlaceBook(db, ME, { ...dune, ids: [] })).toBe(idOf(db, `${ROOT}/Unnamed`));
  });

  it('only on a kid’s shelf for a kids profile', () => {
    const db = createTestDb();
    scan(db, [scanned('B/01.mp3', { album: 'Dune', artist: 'Frank Herbert' })]);
    const kid = createProfile(db, { name: 'Mia', avatar: null, kids: true }, 1, newId);
    expect(findPlaceBook(db, kid, { ...dune, ids: [], work: null })).toBeNull();
  });
});

describe('a shared place in a podcast episode', () => {
  const FEED = 'https://example.org/garden-hour.xml';
  const fixture = (name: string) =>
    readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

  function follow(db: Db, feedUrl = FEED) {
    const { podcastId } = saveFeed(
      db,
      feedUrl,
      parseFeed(fixture('garden-hour.xml')),
      { etag: null, lastModified: null },
      1,
      newId,
    );
    const episode = listEpisodes(db, ME, podcastId).find((e) => e.title === 'Why tomatoes split');
    if (!episode) throw new Error('no episode');
    return { podcastId, bookId: episodeBook(db, episode.id, 2, newId), episodeId: episode.id };
  }

  it('names the episode by its feed and guid, and goes through a link and back', () => {
    const db = createTestDb();
    const { bookId } = follow(db);
    const place = placeOfBook(db, bookId, 1_234_500, 1_276_750);
    expect(place).toEqual({
      title: 'Why tomatoes split',
      author: 'Garden Hour',
      ids: [],
      work: null,
      atMs: 1_234_500,
      toMs: 1_276_750,
      episode: { feed: FEED, guid: 'garden-hour-42' },
    });
    const url = placeUrl('https://listen.example.org', place as SharedPlace);
    expect(query(url).f).toBe(FEED);
    expect(parsePlace(query(url))).toEqual({ ...place, atMs: 1_234_000, toMs: 1_276_000 });
  });

  it('is not shared from a feed with a login or a query, which may hold a token', () => {
    const db = createTestDb();
    const { bookId } = follow(db, 'https://example.org/private.xml?auth=s3cret');
    expect(placeOfBook(db, bookId, 0)).toBeNull();
    expect(isShareableFeed('https://rosa:pw@example.org/feed.xml')).toBe(false);
    expect(isShareableFeed('ftp://example.org/feed.xml')).toBe(false);
    // Tokens in the path, as some private feeds have them.
    expect(isShareableFeed('https://example.org/feeds/k3J9xQ2mP8vL5nR7tY4wZ1aB')).toBe(false);
    expect(
      isShareableFeed('https://example.org/private/5f0e2d6a-7c1b-5e1a-9d3e-000000000075.rss'),
    ).toBe(false);
    expect(isShareableFeed(FEED)).toBe(true);
    expect(isShareableFeed('https://feeds.example.org/GLT1412515089')).toBe(true);
    expect(isShareableFeed('https://example.org/shows/garden-hour-weekly-questions/feed')).toBe(
      true,
    );
  });

  it('is not shared when the episode has no guid, so its audio address would travel', () => {
    const db = createTestDb();
    const { bookId, episodeId } = follow(db);
    db.update(episodes)
      .set({ guid: 'https://cdn.example.org/gh42.mp3' })
      .where(eq(episodes.id, episodeId))
      .run();
    expect(placeOfBook(db, bookId, 0)).toBeNull();
  });

  it('ignores a feed or guid a link should not carry', () => {
    const base = { t: 'Why tomatoes split', at: '60' };
    expect(parsePlace({ ...base, f: 'javascript:alert(1)', g: 'x' })?.episode).toBeUndefined();
    expect(parsePlace({ ...base, f: FEED })?.episode).toBeUndefined();
    expect(parsePlace({ ...base, f: FEED, g: 'garden-hour-42' })?.episode).toEqual({
      feed: FEED,
      guid: 'garden-hour-42',
    });
  });

  it('finds the episode here, a show whose stored feed lacks it, or a show to subscribe to', () => {
    const db = createTestDb();
    const { podcastId, bookId, episodeId } = follow(db);
    expect(findPlaceEpisode(db, ME, { feed: FEED, guid: 'garden-hour-42' })).toEqual({
      kind: 'here',
      episodeId,
      bookId,
    });
    expect(findPlaceEpisode(db, ME, { feed: FEED, guid: 'garden-hour-1' })).toEqual({
      kind: 'missing',
      podcastId,
      subscribed: false,
    });
    subscribe(db, ME, podcastId, 3);
    expect(findPlaceEpisode(db, ME, { feed: FEED, guid: 'garden-hour-1' })).toEqual({
      kind: 'missing',
      podcastId,
      subscribed: true,
    });
    expect(findPlaceEpisode(db, ME, { feed: 'https://example.org/other.xml', guid: 'x' })).toEqual({
      kind: 'unknown',
    });
  });

  it('never offers a kids profile a show it has not got', () => {
    const db = createTestDb();
    follow(db);
    const kid = createProfile(db, { name: 'Mia', avatar: null, kids: true }, 1, newId);
    expect(findPlaceEpisode(db, kid, { feed: FEED, guid: 'garden-hour-42' })).toBeNull();
    expect(findPlaceEpisode(db, kid, { feed: 'https://example.org/o.xml', guid: 'x' })).toBeNull();
  });
});
