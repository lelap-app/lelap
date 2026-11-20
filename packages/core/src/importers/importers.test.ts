import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import type { Db } from '../db';
import { listAllBooks } from '../library/queries';
import { getTags } from '../organise';
import { listEpisodes, listSubscriptions, saveFeed } from '../podcasts/repository';
import { parseFeed } from '../podcasts/rss';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { books } from '../schema';
import {
  antennaPodFromOpml,
  applyAntennaPod,
  isSqlite,
  readAntennaPod,
  type SqlAll,
} from './antennapod';
import { parseCsv } from './csv';
import { applyGoodreads, parseGoodreads } from './goodreads';
import { titleKey } from './match';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

function named(db: Db, title: string, author: string | null): string {
  const id = seedBook(db, `/${title}`, [{ location: `/${title}/1.mp3`, durationMs: 60_000 }]);
  db.update(books).set({ title, author }).where(eq(books.id, id)).run();
  return id;
}

describe('csv', () => {
  it('reads quoted fields with commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi""\nthere"\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'say "hi"\nthere'],
      ['1', '2', '3'],
    ]);
  });
});

describe('matching', () => {
  it('ignores series notes, subtitles, articles and accents', () => {
    expect(titleKey('The Adventures of Sherlock Holmes (Sherlock Holmes, #3)')).toBe(
      titleKey('Adventures of Sherlock Holmes'),
    );
    expect(titleKey('Moby-Dick; or, The Whale')).toBe('moby dick');
    expect(titleKey('Les Misérables')).toBe(titleKey('les miserables'));
  });
});

describe('Goodreads', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('parses shelves, ISBNs and read dates', () => {
    const items = parseGoodreads(fixture('goodreads.csv'));
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      title: 'Pride and Prejudice',
      authors: ['Jane Austen'],
      isbn: '9780141439518',
      shelves: ['read', 'classics', 'favourites'],
      readAt: Date.UTC(2021, 2, 14),
    });
    expect(items[1]?.isbn).toBeNull();
    expect(items[2]?.shelves).toEqual(['to-read']);
  });

  it('rejects other CSV files', () => {
    expect(() => parseGoodreads('a,b\n1,2\n')).toThrow('not a Goodreads');
  });

  it('tags and finishes books in the library and reports the rest', () => {
    const pride = named(db, 'Pride & Prejudice', 'Austen, Jane');
    const time = named(db, 'The Time Machine', 'H. G. Wells');
    const holmes = named(db, 'Adventures of Sherlock Holmes', null);
    const result = applyGoodreads(db, ME, parseGoodreads(fixture('goodreads.csv')), 5_000);

    expect(result.matched).toBe(3);
    expect(result.skipped).toEqual([
      { item: 'Moby-Dick; or, The Whale', reason: 'Not in your library' },
    ]);
    expect(getTags(db, ME, pride)).toEqual(['classics', 'favourites']);
    expect(getTags(db, ME, time)).toEqual(['classics', 'currently-reading']);
    const byId = new Map(listAllBooks(db, ME).map((b) => [b.id, b]));
    expect(byId.get(pride)?.finishedAt).toBe(Date.UTC(2021, 2, 14));
    expect(byId.get(holmes)?.finishedAt).toBe(5_000);
    expect(byId.get(time)?.finishedAt).toBeNull();
  });

  it('leaves out a title two books share', () => {
    named(db, 'Dracula', null);
    seedBook(db, '/other', [{ location: '/other/1.mp3', durationMs: 1 }]);
    db.update(books).set({ title: 'Dracula' }).where(eq(books.location, '/other')).run();
    const csv = `Title,Author,Exclusive Shelf\nDracula,Bram Stoker,read\n`;
    expect(applyGoodreads(db, ME, parseGoodreads(csv), 1).matched).toBe(0);
  });
});

const FEED_URL = 'https://feeds.example.org/garden-hour.xml';
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>The Garden Hour</title>
  ${[1, 2, 3]
    .map(
      (i) => `<item><title>Episode ${i}</title>${i === 3 ? '' : `<guid>ep-${i}</guid>`}
      <enclosure url="https://cdn.example.org/ep${i}.mp3" type="audio/mpeg" length="1"/>
      <itunes:duration xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">${i}:00</itunes:duration></item>`,
    )
    .join('')}
</channel></rss>`;

async function antennaPodExport(): Promise<SqlAll> {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fixture('antennapod.sql'));
  return (sql) => {
    const [result] = sqlite.exec(sql);
    if (!result) return Promise.resolve([]);
    return Promise.resolve(
      result.values.map((row) =>
        Object.fromEntries(result.columns.map((c, i) => [c, row[i] as unknown])),
      ),
    );
  };
}

describe('AntennaPod', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('recognises an SQLite file', () => {
    expect(isSqlite(new TextEncoder().encode('SQLite format 3\0rest'))).toBe(true);
    expect(isSqlite(new TextEncoder().encode('<?xml version'))).toBe(false);
  });

  it('reads subscriptions and played or started episodes', async () => {
    const data = await readAntennaPod(await antennaPodExport());
    expect(data.localFeeds).toEqual(['My recordings']);
    expect(data.feeds.map((f) => f.feedUrl)).toEqual([
      FEED_URL,
      'https://feeds.example.org/gone.xml',
    ]);
    expect(data.feeds[0]?.episodes).toEqual([
      {
        guid: 'ep-1',
        url: 'https://cdn.example.org/ep1.mp3',
        title: 'Episode 1',
        played: true,
        positionMs: 0,
        lastPlayedAt: 1_700_000_000_000,
        completedAt: 1_700_000_000_000,
      },
      expect.objectContaining({ guid: 'ep-2', played: false, positionMs: 45_000 }),
      expect.objectContaining({ guid: 'ep-99', played: true }),
    ]);
  });

  it('rejects other databases', async () => {
    const SQL = await initSqlJs();
    const other = new SQL.Database();
    other.exec('CREATE TABLE Feeds (id INTEGER)');
    const all: SqlAll = (sql) => {
      const [r] = other.exec(sql);
      return Promise.resolve(
        r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : [],
      );
    };
    await expect(readAntennaPod(all)).rejects.toThrow('not an AntennaPod');
  });

  it('subscribes and carries played marks and places over', async () => {
    saveFeed(db, FEED_URL, await parseFeed(rss), { etag: null, lastModified: null }, 100, newId);
    const data = await readAntennaPod(await antennaPodExport());
    const result = applyAntennaPod(db, ME, data, 9_000, newId);

    expect(result.matched).toBe(3);
    expect(result.skipped).toEqual([
      { item: 'My recordings', reason: 'A local folder in AntennaPod' },
      { item: 'The Garden Hour', reason: '1 episode is no longer in the feed' },
      { item: 'Gone away', reason: 'The feed could not be loaded' },
    ]);
    const [sub] = listSubscriptions(db, ME);
    expect(sub?.feedUrl).toBe(FEED_URL);
    const episodes = new Map(listEpisodes(db, ME, sub?.podcastId ?? '').map((e) => [e.title, e]));
    expect(episodes.get('Episode 1')?.finished).toBe(true);
    expect(episodes.get('Episode 2')).toMatchObject({ finished: false, positionMs: 45_000 });
    expect(episodes.get('Episode 3')?.bookId).toBeNull();
    const finished = listAllBooks(db, ME).find((b) => b.title === 'Episode 1');
    expect(finished?.finishedAt).toBe(1_700_000_000_000);

    // A second import changes nothing.
    expect(applyAntennaPod(db, ME, data, 10_000, newId).matched).toBe(1);
  });

  it('keeps a place Lelap saved after AntennaPod played it', async () => {
    saveFeed(db, FEED_URL, await parseFeed(rss), { etag: null, lastModified: null }, 100, newId);
    const data = await readAntennaPod(await antennaPodExport());
    applyAntennaPod(db, ME, data, 9_000, newId);
    const episode = listAllBooks(db, ME).find((b) => b.title === 'Episode 2');
    saveProgress(
      db,
      ME,
      {
        bookId: episode?.id ?? '',
        fileLocation: `episode:${listSubscriptions(db, ME)[0]?.podcastId}:ep-2`,
        filePositionMs: 90_000,
        savedAt: 1_800_000_000_000,
      },
      'app',
    );
    applyAntennaPod(db, ME, data, 10_000, newId);
    expect(listAllBooks(db, ME).find((b) => b.title === 'Episode 2')?.bookPositionMs).toBe(90_000);
  });

  it('takes subscriptions from an OPML export', async () => {
    const opml = `<opml version="2.0"><body><outline text="Garden" xmlUrl="${FEED_URL}"/></body></opml>`;
    expect((await antennaPodFromOpml(opml)).feeds).toEqual([
      { title: 'Garden', feedUrl: FEED_URL, episodes: [] },
    ]);
  });
});
