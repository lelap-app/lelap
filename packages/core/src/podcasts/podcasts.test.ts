import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import type { Db } from '../db';
import { applyDownloadStatuses, planDownload, requestDownload } from '../downloads';
import { getBook, listBooks, setFinished } from '../library/queries';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { addToUpNext, finishAndNext, finishFromPlayer, listUpNext, moveInUpNext } from '../upNext';
import { carryFolderPlace, episodeCode, matchFiles } from './folder';
import { buildOpml, parseOpml } from './opml';
import {
  autoDownloadWork,
  episodeBook,
  listEpisodes,
  listSubscriptions,
  saveFeed,
  setAutoDownload,
  setTrim,
  subscribe,
  trimOfBook,
  unsubscribe,
} from './repository';
import { parseDuration, parseFeed } from './rss';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test data');
  return value;
}
const FEED_URL = 'https://feeds.example.org/garden-hour.xml';

const item = (i: number, extra = '') => `
    <item>
      <title>Episode ${i}: Roses &amp; thorns</title>
      <guid isPermaLink="false">ep-${i}</guid>
      <pubDate>Mon, 0${i} Jun 2026 08:00:00 GMT</pubDate>
      <itunes:duration>${i}:00</itunes:duration>
      <itunes:season>1</itunes:season>
      <itunes:episode>${i}</itunes:episode>
      <enclosure url="https://cdn.example.org/ep${i}.mp3?a=1&amp;b=2" type="audio/mpeg" length="${i}000"/>
      ${extra}
    </item>`;

const rss = (count: number) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>The Garden Hour</title>
    <link>https://example.org/garden-hour</link>
    <description><![CDATA[<p>Weekly <b>gardening</b> talk.</p>]]></description>
    <itunes:author>Garden Folk</itunes:author>
    <itunes:image href="https://img.example.org/garden.jpg"/>
    <podcast:guid>917393e3-1b1e-5cef-ace4-edaa54e1f810</podcast:guid>
    ${Array.from({ length: count }, (_, i) => item(i + 1)).join('')}
    <item><title>Trailer without audio</title><guid>no-audio</guid></item>
  </channel>
</rss>`;

const save = (db: Db, count = 3) =>
  saveFeed(db, FEED_URL, parseFeed(rss(count)), { etag: '"v1"', lastModified: null }, 100, newId);

describe('RSS', () => {
  it('reads the podcast and its audio episodes', () => {
    const feed = parseFeed(rss(2));
    expect(feed).toMatchObject({
      title: 'The Garden Hour',
      author: 'Garden Folk',
      description: 'Weekly gardening talk.',
      coverUrl: 'https://img.example.org/garden.jpg',
      link: 'https://example.org/garden-hour',
      guid: '917393e3-1b1e-5cef-ace4-edaa54e1f810',
    });
    expect(feed.episodes).toHaveLength(2);
    expect(feed.episodes[0]).toEqual({
      guid: 'ep-1',
      title: 'Episode 1: Roses & thorns',
      description: null,
      publishedAt: Date.parse('2026-06-01T08:00:00Z'),
      season: 1,
      number: 1,
      durationMs: 60_000,
      url: 'https://cdn.example.org/ep1.mp3?a=1&b=2',
      mime: 'audio/mpeg',
      size: 1000,
      extras: { chaptersUrl: null, transcripts: [], persons: [], seasonName: null },
    });
  });

  it('reads durations as seconds or clocks', () => {
    expect(parseDuration('1830')).toBe(1_830_000);
    expect(parseDuration('30:30')).toBe(1_830_000);
    expect(parseDuration('1:02:03')).toBe(3_723_000);
    expect(parseDuration('soon')).toBe(0);
  });

  it('refuses what is not a feed', () => {
    expect(() => parseFeed('<html><body>Hi</body></html>')).toThrow('not an RSS or Atom feed');
    expect(() => parseFeed('<rss><channel><title></title></channel></rss>')).toThrow('no title');
    expect(() => parseFeed('<feed><title/></feed>')).toThrow('no title');
  });
});

describe('Atom', () => {
  const atom = readFileSync(new URL('../../test/fixtures/atom.xml', import.meta.url), 'utf8');

  it('reads the podcast and the entries with an audio enclosure', () => {
    const feed = parseFeed(atom);
    expect(feed).toMatchObject({
      title: 'Night Shift Radio',
      author: 'Mira Okafor',
      description: 'Quiet talk for late listeners.',
      coverUrl: 'https://img.example.org/night-shift.png',
      link: 'https://example.org/night-shift',
      guid: '3c1fd7a7-9b2a-5a5b-9b5e-0d3b0b2f1a11',
    });
    expect(feed.episodes).toEqual([
      {
        guid: 'tag:example.org,2026:night-shift/2',
        title: 'Episode 2: Owls',
        description: 'Who is awake at three.',
        publishedAt: Date.parse('2026-10-02T21:00:00Z'),
        season: null,
        number: 2,
        durationMs: 1_500_000,
        url: 'https://cdn.example.org/ns2.mp3',
        mime: 'audio/mpeg',
        size: 24_000_000,
        extras: {
          chaptersUrl: 'https://cdn.example.org/ns2.json',
          transcripts: [],
          persons: [],
          seasonName: null,
        },
      },
      expect.objectContaining({
        guid: 'tag:example.org,2026:night-shift/1',
        description: 'Moths and lamps.',
        // No <published>: <updated> stands in.
        publishedAt: Date.parse('2026-09-25T21:00:00Z'),
        url: 'https://cdn.example.org/ns1.ogg',
        mime: 'audio/ogg',
        size: 0,
      }),
    ]);
  });

  it('subscribes like an RSS feed', () => {
    const db = createTestDb();
    const saved = saveFeed(
      db,
      'https://feeds.example.org/night-shift.atom',
      parseFeed(atom),
      { etag: null, lastModified: null },
      100,
      newId,
    );
    expect(listEpisodes(db, ME, saved.podcastId).map((e) => e.title)).toEqual([
      'Episode 2: Owls',
      'Episode 1: Moths',
    ]);
  });
});

describe('OPML', () => {
  it('reads feeds in folders once and writes them back', () => {
    const xml = `<opml version="2.0"><body>
      <outline text="Garden" type="rss" xmlUrl="https://a.example/feed"/>
      <outline text="Folder"><outline title="Tom &amp; Jerry" xmlUrl="https://b.example/rss"/>
      <outline text="Again" xmlUrl="https://a.example/feed"/></outline>
      <outline text="Night shift" type="atom" xmlUrl="https://c.example/night.atom"/>
    </body></opml>`;
    const feeds = parseOpml(xml);
    expect(feeds).toEqual([
      { title: 'Garden', feedUrl: 'https://a.example/feed' },
      { title: 'Tom & Jerry', feedUrl: 'https://b.example/rss' },
      { title: 'Night shift', feedUrl: 'https://c.example/night.atom' },
    ]);
    expect(parseOpml(buildOpml(feeds, 0))).toEqual(feeds);
  });
});

describe('subscriptions', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('stores a feed, adds only new episodes on refresh, and lists them newest first', () => {
    const first = save(db, 2);
    expect(first.added).toHaveLength(2);
    const again = save(db, 3);
    expect(again.podcastId).toBe(first.podcastId);
    expect(again.added).toHaveLength(1);
    subscribe(db, ME, first.podcastId, 200);
    const [sub] = listSubscriptions(db, ME);
    expect(sub).toMatchObject({ title: 'The Garden Hour', unplayed: 3, autoDownload: false });
    expect(listEpisodes(db, ME, first.podcastId).map((e) => e.number)).toEqual([3, 2, 1]);
    unsubscribe(db, ME, first.podcastId);
    expect(listSubscriptions(db, ME)).toEqual([]);
  });

  it('plays an episode as a book that stays out of the Library list', () => {
    const { podcastId } = save(db, 1);
    const episode = must(listEpisodes(db, ME, podcastId)[0]);
    const bookId = episodeBook(db, episode.id, 300, newId);
    expect(episodeBook(db, episode.id, 301, newId)).toBe(bookId);
    const detail = getBook(db, ME, bookId);
    expect(detail?.book).toMatchObject({ source: 'feed', author: 'The Garden Hour' });
    expect(detail?.files[0]?.uri).toBe('https://cdn.example.org/ep1.mp3?a=1&b=2');
    expect(listBooks(db, ME, 'recent')).toEqual([]);
    // Episodes download like streamed books.
    expect(planDownload(db, bookId).files[0]?.name).toBe('001.mp3');
  });

  it('skips the intro and outro set for the show, per profile', () => {
    const { podcastId } = save(db, 1);
    const bookId = episodeBook(db, must(listEpisodes(db, ME, podcastId)[0]).id, 1, newId);
    expect(trimOfBook(db, ME, bookId)).toEqual({ skipIntroMs: 0, skipOutroMs: 0 });
    subscribe(db, ME, podcastId, 1);
    setTrim(db, ME, podcastId, { skipIntroMs: 30_000, skipOutroMs: 45_000 }, 2);
    expect(trimOfBook(db, ME, bookId)).toEqual({ skipIntroMs: 30_000, skipOutroMs: 45_000 });
    expect(trimOfBook(db, 'someone-else', bookId)).toEqual({ skipIntroMs: 0, skipOutroMs: 0 });
  });

  it('auto-downloads the newest unplayed episodes and removes played ones', () => {
    const { podcastId } = save(db, 4);
    subscribe(db, ME, podcastId, 1);
    expect(autoDownloadWork(db, ME).download).toEqual([]);
    setAutoDownload(db, ME, podcastId, { autoDownload: true, keepLatest: 2 }, 2);
    const ids = listEpisodes(db, ME, podcastId).map((e) => e.id);
    expect(autoDownloadWork(db, ME).download).toEqual([ids[0], ids[1]]);

    const newest = episodeBook(db, must(ids[0]), 3, newId);
    requestDownload(db, planDownload(db, newest), null, 3);
    applyDownloadStatuses(
      db,
      '/dl',
      [
        {
          bookId: newest,
          state: 'done',
          bytesDone: 1,
          bytesTotal: 1,
          files: ['001.mp3'],
          cover: null,
          error: null,
        },
      ],
      4,
    );
    setFinished(db, ME, newest, true, 5);
    expect(autoDownloadWork(db, ME)).toEqual({
      download: [ids[1], ids[2]],
      remove: [newest],
    });
  });
});

describe('Up Next', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('orders, moves and hands over after an episode but not after a book', () => {
    const { podcastId } = save(db, 3);
    const queued = listEpisodes(db, ME, podcastId).map((e) => episodeBook(db, e.id, 1, newId));
    const [a, b, c] = [must(queued[0]), must(queued[1]), must(queued[2])];
    const novel = seedBook(db, 'primary:A/Novel', [{ location: 'n1', durationMs: 1 }]);
    addToUpNext(db, ME, a, 'last', 1);
    addToUpNext(db, ME, b, 'last', 1);
    addToUpNext(db, ME, novel, 'last', 1);
    addToUpNext(db, ME, c, 'next', 1);
    expect(listUpNext(db, ME).map((i) => i.bookId)).toEqual([c, a, b, novel]);
    moveInUpNext(db, ME, novel, 1, 2);
    expect(listUpNext(db, ME).map((i) => i.bookId)).toEqual([c, novel, a, b]);

    expect(finishAndNext(db, ME, c, 3)).toBe(novel);
    expect(getBook(db, ME, c)?.book.finishedAt).toBe(3);
    // A book that ends stops; it still leaves the queue.
    expect(finishAndNext(db, ME, novel, 4)).toBeNull();
    expect(listUpNext(db, ME).map((i) => i.bookId)).toEqual([a, b]);
  });

  it('folds in what the playback service finished with the app closed', () => {
    const { podcastId } = save(db, 2);
    const [first, second] = listEpisodes(db, ME, podcastId).map((e) =>
      episodeBook(db, e.id, 1, newId),
    );
    addToUpNext(db, ME, must(first), 'last', 1);
    addToUpNext(db, ME, must(second), 'last', 1);
    finishFromPlayer(db, ME, must(first), 50);
    expect(getBook(db, ME, must(first))?.book.finishedAt).toBe(50);
    expect(listUpNext(db, ME).map((i) => i.bookId)).toEqual([second]);
  });
});

describe('a podcast folder becoming a subscription', () => {
  it('finds episode codes in file names', () => {
    expect(episodeCode('Show S04E01 Director.mp3')).toEqual({ season: 4, number: 1 });
    expect(episodeCode('E12 - Title.mp3')).toEqual({ season: null, number: 12 });
    expect(episodeCode('Episode 7.mp3')).toEqual({ season: null, number: 7 });
    expect(episodeCode('Interview.mp3')).toBeNull();
  });

  it('matches files by episode number, then by title', () => {
    const items = [
      { id: 'e1', title: 'Roses and thorns', season: 1, number: 1 },
      { id: 'e2', title: 'Compost for beginners', season: 1, number: 2 },
      { id: 'e3', title: 'Winter pruning', season: null, number: null },
    ];
    const files = [
      { location: 'f1', name: 'S01E02 Something.mp3', title: null },
      { location: 'f2', name: 'x.mp3', title: 'Winter Pruning' },
      { location: 'f3', name: 'bonus.mp3', title: 'Bonus' },
    ];
    expect(matchFiles(files, items)).toEqual(
      new Map([
        ['f1', 'e2'],
        ['f2', 'e3'],
      ]),
    );
  });

  it('carries the place: earlier episodes played, the current one at its position', () => {
    const db = createTestDb();
    const { podcastId } = save(db, 3);
    const folder = seedBook(db, 'primary:Podcasts/Garden', [
      { location: 'primary:Podcasts/Garden/S01E01.mp3', durationMs: 60_000 },
      { location: 'primary:Podcasts/Garden/S01E02.mp3', durationMs: 120_000 },
      { location: 'primary:Podcasts/Garden/S01E03.mp3', durationMs: 180_000 },
    ]);
    saveProgress(db, ME, {
      bookId: folder,
      fileLocation: 'primary:Podcasts/Garden/S01E02.mp3',
      filePositionMs: 42_000,
      savedAt: 10,
    });
    expect(carryFolderPlace(db, ME, folder, podcastId, 20, newId)).toEqual({
      matched: 3,
      played: 1,
    });
    const byNumber = new Map(listEpisodes(db, ME, podcastId).map((e) => [e.number, e]));
    expect(byNumber.get(1)?.finished).toBe(true);
    expect(byNumber.get(2)).toMatchObject({ finished: false, positionMs: 42_000 });
    expect(byNumber.get(3)).toMatchObject({ finished: false, positionMs: 0, bookId: null });
  });
});
