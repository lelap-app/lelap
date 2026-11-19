import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import type { Db } from '../db';
import { getBook } from '../library/queries';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { bookFiles, podcasts } from '../schema';
import {
  castOf,
  chapterImageAt,
  cueAt,
  groupBySeason,
  parseChapterImages,
  parseChaptersFile,
  parseTranscript,
  pickTranscript,
} from './podcasting';
import {
  episodeBook,
  episodeDetail,
  feedCache,
  listEpisodes,
  saveEpisodeChapters,
  saveFeed,
} from './repository';
import { parseFeed } from './rss';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;
const FEED_URL = 'https://example.org/night-sky.xml';

describe('Podcasting 2.0 feed tags', () => {
  const feed = parseFeed(fixture('podcasting2.xml'));
  const [orion, plain] = feed.episodes;

  it('reads people and funding links of the show', () => {
    expect(feed.guid).toBe('c9a1b4f2-0000-5000-8000-000000000001');
    expect(feed.extras.persons).toEqual([
      {
        name: 'Ada Lovelace',
        role: 'host',
        group: 'cast',
        img: 'https://img.example.org/ada.jpg',
        href: 'https://example.org/ada',
      },
      { name: 'Charles Babbage', role: 'host', group: 'cast', img: null, href: null },
    ]);
    // Only web addresses: a `javascript:` link is dropped.
    expect(feed.extras.funding).toEqual([
      { url: 'https://example.org/support', label: 'Support the show!' },
      { url: 'https://example.org/members', label: null },
    ]);
  });

  it('reads chapters, transcripts, guests and seasons of an episode', () => {
    expect(orion?.season).toBe(2);
    expect(orion?.number).toBe(4);
    expect(orion?.extras.seasonName).toBe('Winter & spring');
    expect(orion?.extras.chaptersUrl).toBe('https://example.org/orion/chapters.json');
    expect(orion?.extras.transcripts.map((t) => t.type)).toEqual([
      'text/html',
      'application/x-subrip',
      'application/json',
    ]);
    expect(orion?.extras.transcripts[1]?.rel).toBe('captions');
    expect(orion?.extras.persons).toEqual([
      {
        name: 'Grace Hopper',
        role: 'guest',
        group: 'cast',
        img: null,
        href: 'https://example.org/grace',
      },
    ]);
  });

  it('prefers itunes numbers and ignores addresses that are not http', () => {
    expect(plain?.season).toBe(1);
    expect(plain?.extras).toEqual({
      chaptersUrl: null,
      transcripts: [],
      persons: [],
      seasonName: null,
      soundbites: [],
      location: null,
      value: [],
      alternates: [],
    });
  });

  it('picks a timed transcript over HTML', () => {
    expect(pickTranscript(orion?.extras.transcripts ?? [])?.type).toBe('application/json');
    expect(
      pickTranscript([
        { url: 'https://a/t.html', type: 'text/html', language: null, rel: null },
        { url: 'https://a/t.vtt', type: 'text/vtt', language: null, rel: null },
      ])?.url,
    ).toBe('https://a/t.vtt');
    expect(
      pickTranscript([
        { url: 'https://a/t.pdf', type: 'application/pdf', language: null, rel: null },
      ]),
    ).toBeNull();
  });
});

describe('chapters files', () => {
  it('sorts, skips artwork-only entries and fills empty titles', () => {
    expect(parseChaptersFile(fixture('chapters.json'))).toEqual([
      { title: 'Intro', startMs: 0 },
      { title: 'Finding Orion', startMs: 95_500 },
      { title: 'Chapter 3', startMs: 300_000 },
    ]);
  });

  it('names untitled chapters in the profile’s language', () => {
    expect(parseChaptersFile(fixture('chapters.json'), (n) => `Bab ${n}`)[2]?.title).toBe('Bab 3');
  });

  it('gives nothing for a file that is not a chapters file', () => {
    expect(parseChaptersFile('<html>')).toEqual([]);
    expect(parseChaptersFile('{"chapters": 3}')).toEqual([]);
  });
});

describe('chapter images', () => {
  const file = JSON.stringify({
    version: '1.2.0',
    chapters: [
      { startTime: 60, title: 'Seed trays', img: 'https://img.example.org/trays.jpg' },
      { startTime: 0, title: 'Welcome to Garden Hour' },
      { startTime: 90, toc: false, img: ' https://img.example.org/compost.jpg ' },
      { startTime: 120, title: 'Questions', img: 'javascript:alert(1)' },
    ],
  });

  it('reads every picture in order, artwork-only entries too', () => {
    expect(parseChapterImages(file)).toEqual([
      { startMs: 0, img: null },
      { startMs: 60_000, img: 'https://img.example.org/trays.jpg' },
      { startMs: 90_000, img: 'https://img.example.org/compost.jpg' },
      { startMs: 120_000, img: null },
    ]);
  });

  it('shows the picture of the stretch playing, and the cover where there is none', () => {
    const images = parseChapterImages(file);
    expect(chapterImageAt(images, 30_000)).toBeNull();
    expect(chapterImageAt(images, 60_000)).toBe('https://img.example.org/trays.jpg');
    expect(chapterImageAt(images, 100_000)).toBe('https://img.example.org/compost.jpg');
    expect(chapterImageAt(images, 500_000)).toBeNull();
  });

  it('gives nothing for a file without pictures or a broken one', () => {
    expect(parseChapterImages('{"chapters":[{"startTime":0,"title":"Intro"}]}')).toEqual([]);
    expect(parseChapterImages('<html>')).toEqual([]);
    expect(parseChapterImages(fixture('chapters.json'))[0]).toEqual({
      startMs: 0,
      img: 'https://example.org/intro.jpg',
    });
  });
});

describe('transcripts', () => {
  it('joins word-level JSON segments into sentences per speaker', () => {
    expect(parseTranscript(fixture('transcript.json'), 'application/json')).toEqual([
      { startMs: 500, endMs: 1800, speaker: 'Ada', text: 'Welcome back, everyone.' },
      { startMs: 2000, endMs: 2400, speaker: 'Ada', text: 'Tonight' },
      { startMs: 3000, endMs: 3500, speaker: 'Grace', text: 'Hello!' },
      { startMs: 4000, endMs: 4500, speaker: 'Grace', text: 'Thanks' },
    ]);
  });

  it('reads SRT with speakers written before the line', () => {
    expect(parseTranscript(fixture('transcript.srt'), 'application/srt')).toEqual([
      { startMs: 500, endMs: 2000, speaker: 'Ada', text: 'Welcome back, everyone.' },
      { startMs: 2000, endMs: 4250, speaker: null, text: 'Tonight we look at Orion.' },
    ]);
  });

  it('reads WebVTT with voice tags and hours', () => {
    expect(parseTranscript(fixture('transcript.vtt'), 'text/vtt')).toEqual([
      { startMs: 500, endMs: 2000, speaker: 'Ada', text: 'Welcome back, everyone.' },
      { startMs: 3_602_000, endMs: 3_604_000, speaker: 'Grace Hopper', text: 'Hello & goodbye!' },
    ]);
  });

  it('shows HTML as untimed paragraphs', () => {
    expect(parseTranscript('<p>One</p><p>Two &amp; three</p>', 'text/html')).toEqual([
      { startMs: null, endMs: null, speaker: null, text: 'One' },
      { startMs: null, endMs: null, speaker: null, text: 'Two & three' },
    ]);
  });

  it('finds the line playing at a position', () => {
    const cues = parseTranscript(fixture('transcript.srt'), 'text/srt');
    expect(cueAt(cues, 0)).toBe(-1);
    expect(cueAt(cues, 1000)).toBe(0);
    expect(cueAt(cues, 9000)).toBe(1);
  });
});

describe('storing Podcasting 2.0 fields', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  const save = () =>
    saveFeed(
      db,
      FEED_URL,
      parseFeed(fixture('podcasting2.xml')),
      { etag: '"v1"', lastModified: null },
      1,
      newId,
    );

  it('keeps extras on the podcast and its episodes', () => {
    const { podcastId } = save();
    const orion = listEpisodes(db, ME, podcastId).find((e) => e.title === 'Orion in winter');
    const bookId = episodeBook(db, orion?.id ?? '', 2, newId);
    const detail = episodeDetail(db, bookId);
    expect(detail?.podcastTitle).toBe('Night Sky Notes');
    expect(detail?.extras?.chaptersUrl).toBe('https://example.org/orion/chapters.json');
    expect(detail?.podcastExtras?.funding).toHaveLength(2);
    expect(episodeDetail(db, 'not-an-episode')).toBeNull();
  });

  it('reads a feed stored before the fields existed in full once', () => {
    const { podcastId } = save();
    expect(feedCache(db, FEED_URL)).toEqual({ etag: '"v1"', lastModified: null });
    db.update(podcasts).set({ extras: null }).where(eq(podcasts.id, podcastId)).run();
    expect(feedCache(db, FEED_URL)).toEqual({ etag: null, lastModified: null });
    // Stored by M23 to M74, without M75's fields.
    db.update(podcasts)
      .set({ extras: { persons: [], funding: [] } })
      .where(eq(podcasts.id, podcastId))
      .run();
    expect(feedCache(db, FEED_URL)).toEqual({ etag: null, lastModified: null });
  });

  it('gives an episode without chapters the chapters file, once', () => {
    const { podcastId } = save();
    const orion = listEpisodes(db, ME, podcastId).find((e) => e.title === 'Orion in winter');
    const bookId = episodeBook(db, orion?.id ?? '', 2, newId);
    const list = parseChaptersFile(fixture('chapters.json'));
    expect(saveEpisodeChapters(db, bookId, list, 3, newId)).toBe(true);
    expect(getBook(db, ME, bookId)?.chapters).toEqual(list);
    expect(saveEpisodeChapters(db, bookId, [{ title: 'Other', startMs: 0 }], 4, newId)).toBe(false);
    expect(getBook(db, ME, bookId)?.chapters).toEqual(list);
  });

  it('never replaces chapters embedded in the audio', () => {
    const { podcastId } = save();
    const orion = listEpisodes(db, ME, podcastId).find((e) => e.title === 'Orion in winter');
    const bookId = episodeBook(db, orion?.id ?? '', 2, newId);
    db.update(bookFiles)
      .set({ chaptersJson: [{ title: 'Embedded', startMs: 0 }] })
      .where(eq(bookFiles.bookId, bookId))
      .run();
    expect(saveEpisodeChapters(db, bookId, [{ title: 'File', startMs: 0 }], 3, newId)).toBe(false);
  });
});

describe('seasons and people on the podcast page', () => {
  const ep = (season: number | null, seasonName: string | null = null) => ({
    season,
    extras: { chaptersUrl: null, transcripts: [], persons: [], seasonName },
  });

  it('groups by season, newest season first, unnumbered episodes last', () => {
    const list = [ep(2, 'Winter'), ep(null), ep(2), ep(1)];
    const groups = groupBySeason(list);
    expect(groups.map((g) => [g.season, g.name, g.episodes.length])).toEqual([
      [2, 'Winter', 2],
      [1, null, 1],
      [null, null, 1],
    ]);
  });

  it('keeps a feed with one season as a single list', () => {
    expect(groupBySeason([ep(1), ep(1), ep(null)])).toHaveLength(1);
  });

  it('lists hosts before guests and each name once', () => {
    const person = (name: string, role: string) => ({
      name,
      role,
      group: 'cast',
      img: null,
      href: null,
    });
    expect(
      castOf([
        person('Grace', 'guest'),
        person('Ada', 'host'),
        person('ada', 'guest'),
        person('Sam', 'producer'),
      ]).map((p) => p.name),
    ).toEqual(['Ada', 'Grace', 'Sam']);
  });
});

describe('caption files', () => {
  it('joins lines cut mid-sentence', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
We are going to talk

2
00:00:02,000 --> 00:00:03,000
about podcasting.

3
00:00:03,000 --> 00:00:04,000
Next sentence.`;
    expect(parseTranscript(srt, 'application/srt')).toEqual([
      { startMs: 1000, endMs: 3000, speaker: null, text: 'We are going to talk about podcasting.' },
      { startMs: 3000, endMs: 4000, speaker: null, text: 'Next sentence.' },
    ]);
  });
});
