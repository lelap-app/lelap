import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { planDownload, requestDownload } from '../downloads';
import { getBook } from '../library/queries';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import { bookFiles } from '../schema';
import {
  audioFileLabel,
  audioFilesOf,
  chooseEpisodeFile,
  pickAudioFile,
  setAudioChoice,
  SMALLEST_KEY,
} from './alternates';
import {
  episodeBook,
  feedCache,
  listEpisodes,
  listSubscriptions,
  saveFeed,
  subscribe,
} from './repository';
import { parseFeed } from './rss';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;
const FEED = 'https://feeds.example.org/garden-hour.xml';
const NO_CACHE = { etag: null, lastModified: null };

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing in the fixture');
  return value;
}

describe('alternate enclosures', () => {
  const feed = parseFeed(fixture('garden-hour.xml'));
  const leeks = must(feed.episodes[1]);
  const seeds = must(feed.episodes[2]);

  it('keeps every audio alternate at a web address, the default first, with its hash', () => {
    expect(leeks.extras.alternates).toEqual([
      {
        url: 'https://cdn.example.org/gh41.mp3',
        mime: 'audio/mpeg',
        size: 48_000_000,
        bitrate: 128_000,
        title: null,
        integrity: null,
        default: true,
      },
      expect.objectContaining({ url: 'https://cdn.example.org/gh41-small.aac', title: 'Small' }),
    ]);
    expect(seeds.extras.alternates?.[0]?.integrity).toBe(
      'sha384-ExVqijgYHm15PqQqdXfW95x+Rs6C+d6E/ICxyQOeFevnxNLR/wtJNrNYTjIysUBo',
    );
  });

  it('lists the feed’s own file first, merged with its alternate, then the others', () => {
    const files = audioFilesOf(leeks);
    expect(files.map((f) => [f.key, f.url, f.bitrate])).toEqual([
      ['enclosure', 'https://cdn.example.org/gh41.mp3', 128_000],
      ['alt:Small', 'https://cdn.example.org/gh41-small.aac', 64_000],
    ]);
    expect(audioFilesOf(seeds)[0]?.integrity).toMatch(/^sha384-/);
    expect(audioFileLabel(must(files[0]))).toBe('MP3, 128 kbit/s');
    expect(audioFileLabel(must(files[1]))).toBe('Small');
  });

  it('keeps alternates that look alike apart', () => {
    const alike = { mime: 'audio/mpeg', size: 1, bitrate: null, title: null, integrity: null };
    const files = audioFilesOf({
      url: 'https://cdn.example.org/a.mp3',
      mime: 'audio/mpeg',
      size: 3,
      extras: {
        alternates: [
          { ...alike, url: 'https://cdn.example.org/b.mp3', default: false },
          { ...alike, url: 'https://cdn.example.org/c.mp3', default: false },
        ],
      },
    });
    expect(files.map((f) => f.key)).toEqual(['enclosure', 'alt:audio/mpeg ', 'alt:audio/mpeg #2']);
  });

  it('picks the feed’s file, the smallest on mobile data, or the show’s choice', () => {
    const files = audioFilesOf(leeks);
    expect(pickAudioFile(files, null, false)?.key).toBe('enclosure');
    expect(pickAudioFile(files, null, true)?.key).toBe('alt:Small');
    expect(pickAudioFile(files, SMALLEST_KEY, false)?.key).toBe('alt:Small');
    expect(pickAudioFile(files, 'enclosure', true)?.key).toBe('enclosure');
    // A choice this episode doesn't offer falls back to automatic.
    expect(pickAudioFile(files, 'alt:Opus', true)?.key).toBe('alt:Small');
    const unsized = files.map((f) => ({ ...f, size: 0 }));
    expect(pickAudioFile(unsized, null, true)?.key).toBe('alt:Small');
  });

  it('switches the book’s file and keeps its place; a download keeps its file', () => {
    const db = createTestDb();
    const { podcastId } = saveFeed(db, FEED, feed, NO_CACHE, 10, newId);
    subscribe(db, ME, podcastId, 10);
    const episode = listEpisodes(db, ME, podcastId).find((e) => e.title === leeks.title);
    const bookId = episodeBook(db, must(episode).id, 20, newId);
    const file = () => must(getBook(db, ME, bookId)?.files[0]);
    const location = file().location;
    saveProgress(
      db,
      ME,
      { bookId, fileLocation: location, filePositionMs: 9_000, savedAt: 21 },
      'app',
    );

    expect(chooseEpisodeFile(db, ME, bookId, true, 30)).toBe(true);
    const uri = () => file().uri;
    expect(uri()).toBe('https://cdn.example.org/gh41-small.aac');
    expect(file().location).toBe(location);
    expect(listEpisodes(db, ME, podcastId).find((e) => e.bookId === bookId)?.positionMs).toBe(
      9_000,
    );

    // A refresh keeps a picked file while the feed lists it.
    saveFeed(db, FEED, feed, NO_CACHE, 40, newId);
    expect(uri()).toBe('https://cdn.example.org/gh41-small.aac');

    setAudioChoice(db, ME, podcastId, 'enclosure', 50);
    expect(listSubscriptions(db, ME)[0]?.audioChoice).toBe('enclosure');
    requestDownload(db, planDownload(db, bookId), null, 55);
    expect(chooseEpisodeFile(db, ME, bookId, false, 60)).toBe(false);
    expect(uri()).toBe('https://cdn.example.org/gh41-small.aac');
  });

  it('hands the feed’s hash to the download of a file that has one', () => {
    const db = createTestDb();
    const { podcastId } = saveFeed(db, FEED, feed, NO_CACHE, 10, newId);
    const episode = listEpisodes(db, ME, podcastId).find((e) => e.title === seeds.title);
    const bookId = episodeBook(db, must(episode).id, 20, newId);
    expect(planDownload(db, bookId).files[0]?.integrity).toMatch(/^sha384-/);
    db.update(bookFiles)
      .set({ uri: 'https://cdn.example.org/other.opus' })
      .where(eq(bookFiles.bookId, bookId))
      .run();
    expect(planDownload(db, bookId).files[0]?.integrity).toBeUndefined();
  });

  it('reads a feed stored before M103 in full once, to find its alternates', () => {
    const db = createTestDb();
    const stored = {
      ...feed,
      episodes: feed.episodes.map((e) => {
        const extras = { ...e.extras };
        delete extras.alternates;
        return { ...e, extras };
      }),
    };
    saveFeed(db, FEED, stored, { etag: '"v1"', lastModified: null }, 10, newId);
    expect(feedCache(db, FEED)).toEqual(NO_CACHE);
    saveFeed(db, FEED, feed, { etag: '"v1"', lastModified: null }, 20, newId);
    expect(feedCache(db, FEED)).toEqual({ etag: '"v1"', lastModified: null });
  });
});
