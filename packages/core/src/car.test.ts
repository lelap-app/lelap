import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import type { InstalledAddon } from './addons/client';
import { LOCAL_SCHEME } from './addons/local';
import { carLists, carShelves, voiceCatalogs } from './car';
import type { Db } from './db';
import { setFinished } from './library/queries';
import { episodeBook, listEpisodes, saveFeed, subscribe } from './podcasts/repository';
import { parseFeed } from './podcasts/rss';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { saveProgress } from './progress';
import { bookFiles, books } from './schema';
import { setFollowedList } from './listPlay';
import { addToPlaylist, createPlaylist, setPlaylistKeepFinished } from './organise';
import { addToUpNext } from './upNext';

let n = 0;
const newId = () => `car-${String(++n).padStart(6, '0')}`;

const rss = (count: number) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>The Garden Hour</title>
${Array.from(
  { length: count },
  (_, i) => `<item><title>Episode ${i + 1}</title><guid>ep-${i + 1}</guid>
  <pubDate>Mon, 0${i + 1} Jun 2026 08:00:00 GMT</pubDate>
  <enclosure url="https://cdn.example.org/ep${i + 1}.mp3" type="audio/mpeg" length="1000"/></item>`,
).join('')}
</channel></rss>`;

const play = (db: Db, bookId: string, location: string, at: number) =>
  saveProgress(db, ME, { bookId, fileLocation: location, filePositionMs: 1, savedAt: at });

describe('car shelves', () => {
  let db: Db;
  let alpha: string;
  let beta: string;

  beforeEach(() => {
    db = createTestDb();
    alpha = seedBook(db, 'Alpha', [{ location: 'alpha/1', durationMs: 1000 }]);
    beta = seedBook(db, 'Beta', [{ location: 'beta/1', durationMs: 1000 }]);
  });

  it('continues started, unfinished books, most recent first', () => {
    play(db, alpha, 'alpha/1', 1);
    play(db, beta, 'beta/1', 2);
    expect(carShelves(db, ME).continueListening).toEqual([beta, alpha]);
    setFinished(db, ME, beta, true, 3);
    expect(carShelves(db, ME).continueListening).toEqual([alpha]);
  });

  it('lists books on the phone but not missing ones', () => {
    db.update(books).set({ missingSince: 9 }).where(eq(books.id, beta)).run();
    expect(carShelves(db, ME).onPhone).toEqual([alpha]);
  });

  it('offers the newest unfinished episode of each subscription', async () => {
    const feed = saveFeed(
      db,
      'https://feeds.example.org/garden.xml',
      await parseFeed(rss(3)),
      { etag: null, lastModified: null },
      100,
      newId,
    );
    subscribe(db, ME, feed.podcastId, 200);
    const [newest, middle] = listEpisodes(db, ME, feed.podcastId);
    expect(carShelves(db, ME).latestEpisodes).toEqual([{ episodeId: newest?.id, bookId: null }]);

    const bookId = episodeBook(db, newest?.id ?? '', 300, newId);
    setFinished(db, ME, bookId, true, 301);
    expect(carShelves(db, ME).latestEpisodes).toEqual([{ episodeId: middle?.id, bookId: null }]);
  });

  it('keeps the latest played episode in Continue listening', async () => {
    const feed = saveFeed(
      db,
      'https://feeds.example.org/garden.xml',
      await parseFeed(rss(1)),
      { etag: null, lastModified: null },
      100,
      newId,
    );
    const [episode] = listEpisodes(db, ME, feed.podcastId);
    const bookId = episodeBook(db, episode?.id ?? '', 300, newId);
    play(db, alpha, 'alpha/1', 1);
    const file = db.select().from(bookFiles).where(eq(bookFiles.bookId, bookId)).get();
    play(db, bookId, file?.location ?? '', 5);
    expect(carShelves(db, ME).continueListening).toEqual([bookId, alpha]);
  });

  it('offers more of the library for voice search, unfinished and off the shelves', () => {
    const gamma = seedBook(db, 'Gamma', [{ location: 'gamma/1', durationMs: 1000 }]);
    setFinished(db, ME, gamma, true, 3);
    // One book per shelf: the other unfinished one is only for voice search.
    const shelves = carShelves(db, ME, 1);
    expect(shelves.onPhone).toHaveLength(1);
    expect(shelves.library).toEqual([alpha, beta].filter((id) => !shelves.onPhone.includes(id)));
    expect(shelves.episodes).toEqual([]);
  });

  it('follows Up Next in order', () => {
    addToUpNext(db, ME, beta, 'last', 1);
    addToUpNext(db, ME, alpha, 'last', 2);
    expect(carShelves(db, ME).upNext).toEqual([beta, alpha]);
  });

  it('offers each list with where it stands and the items around it', () => {
    const gamma = seedBook(db, 'Gamma', [{ location: 'gamma/1', durationMs: 1000 }]);
    const id = createPlaylist(db, ME, newId, { name: 'Trip', rule: null }, 1);
    for (const book of [alpha, beta, gamma]) addToPlaylist(db, ME, id, book, 2);
    setFinished(db, ME, alpha, true, 3);
    expect(carLists(db, ME)).toEqual([
      {
        id,
        name: 'Trip',
        keepFinished: false,
        order: null,
        start: beta,
        items: [
          { bookId: beta, fromStart: false },
          { bookId: gamma, fromStart: false },
        ],
      },
    ]);
    // A list that keeps finished items plays them again from the start.
    setPlaylistKeepFinished(db, ME, id, true, 4);
    setFollowedList(db, ME, { listId: id, bookId: gamma, order: null }, 5);
    const [kept] = carLists(db, ME);
    expect(kept?.start).toBe(gamma);
    expect(kept?.items.map((i) => i.bookId)).toEqual([alpha, beta, gamma]);
    expect(kept?.items[0]?.fromStart).toBe(true);
  });

  it('keeps a smart list in the order it shows now', () => {
    const id = createPlaylist(db, ME, newId, { name: 'New', rule: { status: 'notStarted' } }, 1);
    const [list] = carLists(db, ME);
    expect(list?.id).toBe(id);
    expect(list?.order).toEqual(list?.items.map((i) => i.bookId));
    expect(list?.order).toHaveLength(2);
  });
});

describe('voice catalogs', () => {
  const addon = (url: string, search: boolean): InstalledAddon => ({
    id: url,
    url,
    builtin: false,
    manifest: {
      id: url,
      version: '1.0.0',
      protocol: 1,
      name: 'Books',
      description: '',
      types: ['audiobook'],
      resources: ['catalog'],
      catalogs: [
        {
          type: 'audiobook',
          id: 'all',
          name: 'All',
          extra: search ? [{ name: 'search', isRequired: true }] : [],
        },
      ],
    },
  });

  it('lists the web add-ons that search audiobooks, not in-app ones', () => {
    expect(
      voiceCatalogs([
        addon('https://books.example.org/x/manifest.json', true),
        addon('https://browse.example.org/manifest.json', false),
        addon(`${LOCAL_SCHEME}mine/manifest.json`, true),
      ]),
    ).toEqual([
      { base: 'https://books.example.org/x/', type: 'audiobook', id: 'all', addon: 'Books' },
    ]);
  });
});
