import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { refreshFeeds } from './refresh';
import { geoPoint, mapLink, valueInfoOf } from './podcasting';
import { listEpisodes, saveFeed, subscribe } from './repository';
import { parseFeed } from './rss';
import { FeedError } from './xml';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

describe('soundbites, location, value and alternate enclosures', () => {
  const feed = parseFeed(fixture('garden-hour.xml'));
  const [tomatoes, leeks, seeds] = feed.episodes;

  it('reads soundbites in order and drops ones without a time or a length', () => {
    expect(tomatoes?.extras.soundbites).toEqual([
      { startMs: 73_000, durationMs: 60_000, title: null },
      { startMs: 1_234_500, durationMs: 42_250, title: 'Watering after a dry spell' },
    ]);
    expect(leeks?.extras.soundbites).toEqual([]);
  });

  it('reads the place of the show and of an episode', () => {
    expect(feed.extras.location).toEqual({
      name: 'Kew, London',
      geo: 'geo:51.4769,-0.2950',
      osm: 'R2589212',
    });
    expect(tomatoes?.extras.location).toEqual({
      name: 'Liverpool allotments',
      geo: 'geo:53.4084,-2.9916',
      osm: null,
    });
    expect(leeks?.extras.location).toBeNull();
  });

  it('keeps value blocks with their recipients, skipping one without an address', () => {
    expect(feed.extras.value).toEqual([
      {
        type: 'lightning',
        method: 'keysend',
        suggested: 0.00000005,
        recipients: [
          expect.objectContaining({ name: 'Rosa Fern', type: 'node', split: 95 }),
          expect.objectContaining({ name: 'Hosting', split: 5 }),
        ],
      },
    ]);
    expect(tomatoes?.extras.value?.[0]?.recipients).toHaveLength(1);
    expect(tomatoes?.extras.value?.[0]?.suggested).toBeNull();
  });

  it('plays the audio alternate of a video episode, the default one first', () => {
    expect(tomatoes).toMatchObject({ url: 'https://cdn.example.org/gh42.mp3', size: 39_680_000 });
    expect(leeks).toMatchObject({
      url: 'https://cdn.example.org/gh41.mp3',
      mime: 'audio/mpeg',
      size: 48_000_000,
    });
  });

  it('takes an episode whose only audio is an alternate, at a web address', () => {
    expect(seeds).toMatchObject({
      url: 'https://cdn.example.org/gh40.opus',
      mime: 'audio/opus',
      size: 12_000_000,
    });
    // The last item's only source is not a web address, so it is left out.
    expect(feed.episodes.map((e) => e.guid)).toEqual([
      'garden-hour-42',
      'garden-hour-41',
      'garden-hour-40',
    ]);
  });

  it('keeps the new fields when stored and listed', () => {
    const db = createTestDb();
    const { podcastId } = saveFeed(
      db,
      'https://feeds.example.org/garden-hour.xml',
      feed,
      { etag: null, lastModified: null },
      100,
      newId,
    );
    const stored = listEpisodes(db, ME, podcastId).find((e) => e.title === 'Why tomatoes split');
    expect(stored?.extras?.soundbites).toHaveLength(2);
  });
});

describe('place links', () => {
  const kew = { name: 'Kew, London', geo: 'geo:51.4769,-0.2950', osm: 'R2589212' };

  it('reads geo URIs with an altitude or parameters and refuses ones off the globe', () => {
    expect(geoPoint('geo:51.4769,-0.2950')).toEqual({ lat: 51.4769, lon: -0.295 });
    expect(geoPoint('geo:-33.86,151.2,40;u=35')).toEqual({ lat: -33.86, lon: 151.2 });
    expect(geoPoint('geo:91,0')).toBeNull();
    expect(geoPoint('geo:abc')).toBeNull();
    expect(geoPoint(null)).toBeNull();
  });

  it('opens the map app at the point, labelled with the name', () => {
    expect(mapLink(kew, 'app')).toBe('geo:51.4769,-0.295?q=51.4769,-0.295(Kew%2C%20London)');
    expect(mapLink({ name: 'Liverpool', geo: null, osm: null }, 'app')).toBe('geo:0,0?q=Liverpool');
  });

  it('opens OpenStreetMap on the web: the object, else the point, else a search', () => {
    expect(mapLink(kew, 'web')).toBe('https://www.openstreetmap.org/relation/2589212');
    expect(mapLink({ ...kew, osm: 'W5013364#2' }, 'web')).toBe(
      'https://www.openstreetmap.org/way/5013364',
    );
    expect(mapLink({ ...kew, osm: 'X1' }, 'web')).toBe(
      'https://www.openstreetmap.org/?mlat=51.4769&mlon=-0.295#map=14/51.4769/-0.295',
    );
    expect(mapLink({ name: 'Kew & Richmond', geo: null, osm: null }, 'web')).toBe(
      'https://www.openstreetmap.org/search?query=Kew%20%26%20Richmond',
    );
  });
});

describe('value information', () => {
  it('takes the fee off the top and shares the rest by split', () => {
    const feed = parseFeed(fixture('garden-hour.xml'));
    expect(valueInfoOf(feed.extras.value ?? [])).toEqual([
      {
        type: 'lightning',
        method: 'keysend',
        shares: [
          { name: 'Rosa Fern', percent: 95 },
          { name: 'Hosting', percent: 5 },
        ],
      },
    ]);
  });

  it('shares by proportion when splits do not add up to 100, and reads old rows without fee', () => {
    const shares = valueInfoOf([
      {
        type: 'lightning',
        method: 'keysend',
        suggested: null,
        recipients: [
          { name: 'Host', type: 'node', address: 'a', split: 3 },
          { name: 'Producer', type: 'node', address: 'b', split: 1 },
          { name: 'App', type: 'node', address: 'c', split: 2, fee: true },
        ],
      },
    ])[0]?.shares;
    expect(shares).toEqual([
      { name: 'Host', percent: 73.5 },
      { name: 'Producer', percent: 24.5 },
      { name: 'App', percent: 2 },
    ]);
  });
});

describe('Atom text constructs', () => {
  const feed = parseFeed(fixture('garden-hour.atom'));
  const [tomatoes, leeks] = feed.episodes;

  it('reads xhtml content with nested elements as text', () => {
    expect(feed.description).toBe('Questions from allotments & balconies.');
    expect(tomatoes?.description).toBe(
      'Rosa answers three questions about tomatoes.\n\nWatering & splitting\nWhich <varieties> hold up',
    );
    expect(leeks?.description).toBe('Leeks, slowly.');
  });

  it('reads Podcasting 2.0 tags and alternates in entries', () => {
    expect(tomatoes?.extras.soundbites).toEqual([
      { startMs: 73_000, durationMs: 60_000, title: 'Splitting after rain' },
    ]);
    expect(leeks?.url).toBe('https://cdn.example.org/gh41.mp3');
  });
});

describe('refreshFeeds', () => {
  it('counts the feeds it asked and names the ones that failed', async () => {
    const db = createTestDb();
    const ids: string[] = [];
    for (const name of ['garden-hour', 'night-sky', 'quiet-hour']) {
      const xml = fixture('garden-hour.xml').replace(
        '<title>Garden Hour</title>',
        `<title>${name}</title>`,
      );
      const { podcastId } = saveFeed(
        db,
        `https://feeds.example.org/${name}.xml`,
        parseFeed(xml),
        { etag: null, lastModified: null },
        100,
        newId,
      );
      subscribe(db, ME, podcastId, 100);
      ids.push(podcastId);
    }
    const result = await refreshFeeds(db, ME, async (url) => {
      if (url.includes('night-sky')) throw new FeedError('The feed answered HTTP 503.');
      return null;
    });
    expect(result.feeds).toBe(3);
    expect(result.failures).toEqual([{ podcastId: ids[1], error: expect.any(FeedError) }]);
  });
});
