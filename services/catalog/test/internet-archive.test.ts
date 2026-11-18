import { CatalogResponse, Manifest, MetaResponse, StreamResponse } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { createInternetArchiveAddon, manifest } from '../src/internet-archive/addon';
import {
  airDateOf,
  audioFiles,
  parseItem,
  parseSearch,
  stemOf,
} from '../src/internet-archive/archive';
import { licenceKind, rightsOf } from '../src/internet-archive/rights';
import { createUpstream } from '../src/upstream';
import { fakeFetch, fixture, path, platform } from './helpers';

const BASE = 'https://addons.test/internet-archive';
const DRAGNET = fixture('ia-metadata-Dragnet_OTR.json') as { metadata: Record<string, unknown> };
const KIERKEGAARD = fixture('ia-metadata-KierkegaardAndTheCrisisInReligion.json') as {
  metadata: Record<string, unknown>;
};
const WHISTLER = fixture('ia-metadata-The_Whistler_508_Episodes.json');

/** The fixture with its metadata changed, for the licence cases. */
const withMetadata = (item: { metadata: Record<string, unknown> }, changes: object) => ({
  ...item,
  metadata: { ...item.metadata, ...changes },
});

function setup(extra: Parameters<typeof fakeFetch>[0] = []) {
  const fetch = fakeFetch([
    ...extra,
    [
      (url) => url.pathname === '/advancedsearch.php' && /dragnet/.test(url.search),
      fixture('ia-search-dragnet.json'),
    ],
    [path('/advancedsearch.php'), fixture('ia-search-old-time-radio.json')],
    [path('/metadata/Dragnet_OTR'), DRAGNET],
    [path('/metadata/dragnet_otr'), DRAGNET],
    [path('/metadata/KierkegaardAndTheCrisisInReligion'), KIERKEGAARD],
    [path('/metadata/The_Whistler_508_Episodes'), WHISTLER],
    [path('/metadata/unknown_item'), {}],
  ]);
  const addon = createInternetArchiveAddon(createUpstream(platform(fetch), 'Lelap/1 (test)'));
  const request = (route: string) => addon.fetch(new Request(`${BASE}/${route}`));
  const get = async (route: string) => {
    const response = await request(route);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { fetch, get, request };
}

describe('which items are free to share', () => {
  it('reads Creative Commons licence URLs', () => {
    expect(licenceKind('http://creativecommons.org/licenses/publicdomain/')).toBe('public-domain');
    expect(licenceKind('https://creativecommons.org/publicdomain/mark/1.0/')).toBe('public-domain');
    expect(licenceKind('https://creativecommons.org/publicdomain/zero/1.0/')).toBe('public-domain');
    expect(licenceKind('http://creativecommons.org/licenses/by/3.0/')).toBe('open');
    expect(licenceKind('https://creativecommons.org/licenses/by-sa/4.0/deed.en')).toBe('open');
    expect(licenceKind('http://creativecommons.org/licenses/by-nc-nd/2.5/')).toBe('restricted');
    expect(licenceKind('http://creativecommons.org/licenses/by-nc-sa/3.0/us/')).toBe('restricted');
    expect(licenceKind('http://creativecommons.org/licenses/by-nd-nc/1.0/')).toBe('restricted');
    expect(licenceKind(' http://www.creativecommons.org/licenses/by/2.0/ ')).toBe('open');
  });

  it('refuses everything else', () => {
    for (const url of [
      undefined,
      '',
      'not a url',
      'http://creativecommons.org/licenses/sampling+/1.0/',
      'http://creativecommons.org/licenses/sampling/1.0/',
      'http://creativecommons.org/licenses/constructor/1.0/',
      'http://creativecommons.org/licenses/',
      'http://creativecommons.org/',
      'https://creativecommons.org.example.com/licenses/by/4.0/',
      'https://example.com/creativecommons.org/licenses/by/4.0/',
      'https://www.gnu.org/licenses/gpl-3.0.html',
      'ftp://creativecommons.org/licenses/by/4.0/',
      'All rights reserved',
    ])
      expect(licenceKind(url), String(url)).toBeNull();
  });

  it('serves public domain, Creative Commons and known public-domain collections only', () => {
    expect(rightsOf({ possibleCopyrightStatus: 'NOT_IN_COPYRIGHT' })).toBe('public-domain');
    // Only archive.org's own value; free text is not enough.
    expect(rightsOf({ possibleCopyrightStatus: 'Public Domain' })).toBeNull();
    expect(rightsOf({ collections: ['oldtimeradio', 'librivoxaudio'] })).toBe('public-domain');
    expect(rightsOf({ licenseurl: 'http://creativecommons.org/licenses/by-sa/3.0/' })).toBe('open');

    expect(rightsOf({})).toBeNull();
    expect(rightsOf({ collections: ['oldtimeradio', 'radioprograms'] })).toBeNull();
    expect(rightsOf({ possibleCopyrightStatus: 'IN_COPYRIGHT' })).toBeNull();
    expect(rightsOf({ possibleCopyrightStatus: 'not public domain' })).toBeNull();
    expect(rightsOf({ licenseurl: 'https://www.gnu.org/licenses/gpl-3.0.html' })).toBeNull();
    // Lending-library items stay out whatever their licence says.
    expect(
      rightsOf({
        licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/',
        accessRestricted: true,
      }),
    ).toBeNull();
  });

  it('skips items without a licence, even in an old-time radio collection', () => {
    expect(parseItem(WHISTLER)).toBeNull();
    expect(parseItem(DRAGNET)?.type).toBe('podcast');
    expect(parseItem(withMetadata(DRAGNET, { licenseurl: undefined }))).toBeNull();
    expect(
      parseItem(withMetadata(DRAGNET, { 'possible-copyright-status': 'NOT_IN_COPYRIGHT' })),
    ).not.toBeNull();
    expect(parseItem(withMetadata(DRAGNET, { 'access-restricted-item': 'true' }))).toBeNull();
    expect(parseItem(withMetadata(DRAGNET, { 'access-restricted-item': ['true'] }))).toBeNull();
    // Anything unexpected counts as restricted.
    expect(parseItem(withMetadata(DRAGNET, { 'access-restricted-item': { x: 1 } }))).toBeNull();
    expect(parseItem(withMetadata(DRAGNET, { 'access-restricted-item': 'false' }))).not.toBeNull();
    expect(parseItem(withMetadata(KIERKEGAARD, { mediatype: 'texts' }))).toBeNull();
    expect(parseItem({})).toBeNull();
  });

  it('drops search results the filter let through', () => {
    const docs = parseSearch({
      response: {
        docs: [
          {
            identifier: 'a',
            title: 'A',
            licenseurl: 'http://creativecommons.org/licenses/by/3.0/',
          },
          { identifier: 'b', title: 'B', licenseurl: 'http://creativecommons.org/licenses/x/' },
          { identifier: 'c', title: 'C' },
          { identifier: 'd', title: 'D', 'possible-copyright-status': 'NOT_IN_COPYRIGHT' },
          {
            identifier: 'e',
            title: 'E',
            licenseurl: 'http://creativecommons.org/licenses/by/3.0/',
            'access-restricted-item': ['true'],
          },
        ],
      },
    });
    expect(docs.map((doc) => doc.identifier)).toEqual(['a', 'd']);
  });
});

describe('Internet Archive manifest', () => {
  it('is a valid manifest with podcast and audiobook catalogs', () => {
    expect(Manifest.safeParse(manifest).success).toBe(true);
    expect(manifest.catalogs.map((c) => [c.type, c.id])).toEqual([
      ['podcast', 'old-time-radio'],
      ['audiobook', 'lectures'],
      ['audiobook', 'readings'],
      ['podcast', 'old-time-radio-search'],
      ['audiobook', 'search'],
    ]);
  });
});

describe('Internet Archive catalogs', () => {
  it('lists old-time radio as podcasts, most downloaded first', async () => {
    const { get, fetch } = setup();
    const { status, body } = await get('catalog/podcast/old-time-radio/skip=30.json');
    expect(status).toBe(200);
    expect(CatalogResponse.safeParse(body).success).toBe(true);
    const metas = body.metas as { id: string; type: string; name: string }[];
    expect(metas[2]).toEqual({
      id: 'ia:Dragnet_OTR',
      type: 'podcast',
      name: "Dragnet the 50's radio show",
      cover: 'https://archive.org/services/img/Dragnet_OTR',
      badges: { rating: 4.7 },
    });
    expect(metas.every((meta) => meta.type === 'podcast')).toBe(true);
    const params = fetch.calls[0]?.url.searchParams;
    expect(params?.get('q')).toBe(
      'mediatype:audio AND (collection:oldtimeradio) AND NOT collection:librivoxaudio AND NOT access-restricted-item:true AND (licenseurl:*creativecommons.org* OR possible-copyright-status:NOT_IN_COPYRIGHT)',
    );
    expect(params?.get('sort[]')).toBe('downloads desc');
    expect(params?.get('page')).toBe('2');
    expect(params?.getAll('fl[]')).toContain('licenseurl');
  });

  it('finds an old radio show by name', async () => {
    const { get, fetch } = setup();
    const { body } = await get('catalog/podcast/old-time-radio-search/search=Dragnet.json');
    const ids = (body.metas as { id: string }[]).map((meta) => meta.id);
    expect(ids).toContain('ia:Dragnet_OTR');
    expect(ids).toHaveLength(5);
    const params = fetch.calls[0]?.url.searchParams;
    expect(params?.get('q')).toMatch(
      / AND \(collection:oldtimeradio\) .* AND \(\(title:dragnet OR creator:dragnet OR subject:dragnet\)\)$/,
    );
    expect(params?.get('sort[]')).toBeNull();
  });

  it('keeps lectures and readings to spoken word, and escapes search input', async () => {
    const { get, fetch } = setup();
    await get('catalog/audiobook/lectures.json');
    expect(fetch.calls[0]?.url.searchParams.get('q')).toContain(
      'AND ((collection:ucberkeleylectures OR subject:(lecture OR lectures)) AND NOT collection:oldtimeradio) AND NOT collection:librivoxaudio',
    );
    await get(`catalog/audiobook/search/search=${encodeURIComponent('x) OR (*:*')}.json`);
    expect(fetch.calls[1]?.url.searchParams.get('q')).toMatch(
      /AND \(\(title:or OR creator:or OR subject:or\)\)$/,
    );
    const { body } = await get('catalog/audiobook/search/search=%2A%3A%2A.json');
    expect(body.metas).toEqual([]);
    expect(fetch.calls).toHaveLength(2);
  });
});

describe('Internet Archive meta', () => {
  it('answers a radio series as a podcast with its feed', async () => {
    const { get } = setup();
    const { status, body } = await get('meta/podcast/ia%3ADragnet_OTR.json');
    expect(status).toBe(200);
    expect(MetaResponse.safeParse(body).success).toBe(true);
    expect(body.meta).toMatchObject({
      id: 'ia:Dragnet_OTR',
      type: 'podcast',
      name: "Dragnet the 50's radio show",
      description: 'Old Time Radio Programs. Detective series. 298 episodes of Dragnet.',
      feed: 'https://addons.test/internet-archive/feed/Dragnet_OTR.xml',
      link: 'https://archive.org/details/Dragnet_OTR',
      genres: ['Detective series', 'Jack Webb', 'Crime Drama'],
      externalIds: { archive: 'Dragnet_OTR' },
      // Four reviews: 5, 5, 4 and 0 stars.
      badges: { rating: 3.5 },
    });
  });

  it('answers a lecture as an audiobook with chapters', async () => {
    const { get } = setup();
    const { body } = await get('meta/audiobook/ia%3AKierkegaardAndTheCrisisInReligion.json');
    expect(body.meta).toMatchObject({
      type: 'audiobook',
      author: 'Walter Kaufmann',
      chapters: [
        { title: 'Kierkegaard Part One', startMs: 0 },
        { title: 'Kierkegaard Part Two', startMs: 2_460_000 },
      ],
      durationMs: 2_460_000 + 2_411_000,
      // “religion” and “Kierkegaard” are in the title, so they are not genres.
      genres: ['philosophy', 'lecture', 'existentialism', 'morality'],
    });
    expect((body.meta as { feed?: string }).feed).toBeUndefined();
  });

  it('is a 404 for unlicensed, unknown and malformed items', async () => {
    const { get, fetch } = setup();
    expect((await get('meta/podcast/ia%3AThe_Whistler_508_Episodes.json')).status).toBe(404);
    expect((await get('meta/podcast/ia%3Aunknown_item.json')).status).toBe(404);
    // archive.org answering for another identifier than the one asked for.
    expect((await get('meta/podcast/ia%3Adragnet_otr.json')).status).toBe(404);
    const calls = fetch.calls.length;
    expect((await get('meta/podcast/ia%3A..%2Fsecret.json')).status).toBe(404);
    expect(fetch.calls).toHaveLength(calls);
  });
});

describe('Internet Archive streams', () => {
  it('plays a lecture from archive.org, the 64 kb copy of each recording', async () => {
    const { get } = setup();
    const { body } = await get('stream/audiobook/ia%3AKierkegaardAndTheCrisisInReligion.json');
    expect(StreamResponse.safeParse(body).success).toBe(true);
    expect(body.streams).toEqual([
      {
        sourceKey: 'ia:KierkegaardAndTheCrisisInReligion:mp3',
        name: 'Internet Archive',
        mime: 'audio/mpeg',
        downloadable: true,
        size: 19_686_213 + 19_291_869,
        parts: [
          {
            url: 'https://archive.org/download/KierkegaardAndTheCrisisInReligion/KierkegaardPartOne_64kb.mp3',
            title: 'Kierkegaard Part One',
            durationMs: 2_460_000,
            size: 19_686_213,
          },
          {
            url: 'https://archive.org/download/KierkegaardAndTheCrisisInReligion/KierkegaardPartTwo_64kb.mp3',
            title: 'Kierkegaard Part Two',
            durationMs: 2_411_000,
            size: 19_291_869,
          },
        ],
      },
    ]);
  });

  it('has no streams for unlicensed items or podcasts', async () => {
    const { get } = setup();
    expect(
      (await get('stream/audiobook/ia%3AThe_Whistler_508_Episodes.json')).body.streams,
    ).toEqual([]);
    expect((await get('stream/audiobook/ia%3ADragnet_OTR.json')).body.streams).toEqual([]);
  });

  it('leaves out files archive.org keeps private', () => {
    const data = KIERKEGAARD as unknown as { files: { name: string }[] };
    const item = parseItem({
      ...data,
      files: data.files.map((file) =>
        file.name.startsWith('KierkegaardPartTwo') ? { ...file, private: 'true' } : file,
      ),
    });
    if (!item) throw new Error('fixture did not parse');
    expect(audioFiles(item).map((file) => file.name)).toEqual(['KierkegaardPartOne_64kb.mp3']);
  });

  it('merges copies of one recording uploaded apart at two bitrates', () => {
    const item = parseItem({
      metadata: {
        identifier: 'Show_OTR',
        title: 'Show',
        mediatype: 'audio',
        licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/',
      },
      files: [
        { name: 'Show_ep01_128kb.mp3', format: 'VBR MP3', source: 'original', length: '1800' },
        { name: 'Show_ep01_64kb.mp3', format: 'VBR MP3', source: 'original', length: '1800' },
        { name: 'Show_ep02_128kb.mp3', format: 'VBR MP3', source: 'original', length: '1700' },
      ],
    });
    if (!item) throw new Error('did not parse');
    expect(audioFiles(item).map((file) => file.name)).toEqual([
      'Show_ep01_64kb.mp3',
      'Show_ep02_128kb.mp3',
    ]);
    expect(stemOf('Show_ep01_128Kbps.mp3')).toBe('show_ep01.mp3');
  });

  it('keeps every recording of a series with mixed bitrates', () => {
    const item = parseItem(DRAGNET);
    if (!item) throw new Error('fixture did not parse');
    expect(audioFiles(item).map((file) => [file.title, file.durationMs])).toEqual([
      ['Dragnet 49-06-10 ep002 Homicide', 1_722_230],
      ['Dragnet 49-06-17 ep003 The Werewolf', 1_763_540],
      ['Dragnet 51-06-28 ep107 Big Cliff', 1_592_600],
    ]);
  });
});

describe('Internet Archive feeds', () => {
  it('serves a radio series as RSS with enclosures on archive.org', async () => {
    const { request } = setup();
    const response = await request('feed/Dragnet_OTR.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const xml = await response.text();
    expect(xml).toContain('<title>Dragnet the 50&apos;s radio show</title>');
    expect(xml).toContain(
      '<enclosure url="https://archive.org/download/Dragnet_OTR/Dragnet_49-06-10_ep002_Homicide.mp3" length="6890545" type="audio/mpeg"/>',
    );
    expect(xml).toContain(
      '<guid isPermaLink="false">ia:Dragnet_OTR/Dragnet_49-06-10_ep002_Homicide.mp3</guid>',
    );
    expect(xml).toContain('<pubDate>Fri, 10 Jun 1949 12:00:00 GMT</pubDate>');
    expect(xml).toContain('<itunes:duration>1593</itunes:duration>');
    expect(xml).toContain(
      '<atom:link href="https://addons.test/internet-archive/feed/Dragnet_OTR.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(xml.match(/<item>/g)).toHaveLength(3);
    // Every link in the feed goes to archive.org; no audio passes through this service.
    for (const [, url] of xml.matchAll(/url="([^"]+)"/g))
      expect(url).toMatch(/^https:\/\/archive\.org\//);
  });

  it('dates episodes in file order when the names have no broadcast dates', async () => {
    const renamed = {
      ...DRAGNET,
      files: (DRAGNET as unknown as { files: { name: string; original?: string }[] }).files.map(
        (file) => ({
          ...file,
          name: file.name.replace(/_\d{2}-\d{2}-\d{2}_/, '_'),
          ...(file.original ? { original: file.original.replace(/_\d{2}-\d{2}-\d{2}_/, '_') } : {}),
        }),
      ),
    };
    const { request } = setup([[path('/metadata/Dragnet_OTR'), renamed]]);
    const xml = await (await request('feed/Dragnet_OTR.xml')).text();
    expect([...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1])).toEqual([
      'Sun, 11 Mar 2007 13:15:50 GMT',
      'Sun, 11 Mar 2007 13:15:51 GMT',
      'Sun, 11 Mar 2007 13:15:52 GMT',
    ]);
  });

  it('is a 404 for unlicensed items and audiobooks', async () => {
    const { request } = setup();
    expect((await request('feed/The_Whistler_508_Episodes.xml')).status).toBe(404);
    expect((await request('feed/KierkegaardAndTheCrisisInReligion.xml')).status).toBe(404);
    expect((await request('feed/unknown_item.xml')).status).toBe(404);
    expect((await request('feed/%E0%A4%A.xml')).status).toBe(404);
  });

  it('reads broadcast dates from old-time radio file names', () => {
    expect(airDateOf('Dragnet_49-06-10_ep002_Homicide.mp3')?.toISOString()).toBe(
      '1949-06-10T12:00:00.000Z',
    );
    expect(airDateOf('The_Whistler_420516_001_30m14s_Retribution_.mp3')?.toISOString()).toBe(
      '1942-05-16T12:00:00.000Z',
    );
    expect(airDateOf('Show_49-13-40_x.mp3')).toBeUndefined();
    expect(airDateOf('KierkegaardPartOne.mp3')).toBeUndefined();
  });

  it('dates a recreation from the 2000s in its own century', () => {
    const uploaded = Date.UTC(2010, 0, 1);
    // Below 1920 there was no radio to record.
    expect(airDateOf('Recreation_05-03-12.mp3')?.getUTCFullYear()).toBe(2005);
    // Never after the upload, so `49` stays 1949.
    expect(airDateOf('Show_49-06-10.mp3', { before: uploaded })?.getUTCFullYear()).toBe(1949);
    // The item's own year picks the century.
    expect(airDateOf('Revival_25-04-01.mp3', { year: 2025 })?.getUTCFullYear()).toBe(2025);
    expect(airDateOf('Revival_25-04-01.mp3', { year: 1925 })?.getUTCFullYear()).toBe(1925);
  });
});

describe('Internet Archive on the worker', () => {
  it('is mounted under /internet-archive and listed at the root', async () => {
    const fetch = fakeFetch([[path('/metadata/Dragnet_OTR'), DRAGNET]]);
    const app = createApp({ fetch }, {});
    const root = (await (await app.request('https://addons.test/')).json()) as { addons: string[] };
    expect(root.addons).toContain('https://addons.test/internet-archive/manifest.json');
    const response = await app.request('https://addons.test/internet-archive/manifest.json');
    expect(((await response.json()) as { id: string }).id).toBe('app.lelap.internet-archive');
    const feed = await app.request('https://addons.test/internet-archive/feed/Dragnet_OTR.xml');
    expect(feed.status).toBe(200);
    expect(feed.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
