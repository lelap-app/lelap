import { CatalogResponse, Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import {
  createLepakAddon,
  isMalayOrIndonesian,
  isSingaporean,
  lepakManifest,
} from '../src/lepak/addon';
import { createUpstream } from '../src/upstream';
import { fakeFetch, fixture, path, platform } from './helpers';

const BASE = 'https://addons.test/lepak';
const GUID = '5b8a6a0e-2d1c-5c3b-9a55-0f3c2a8e1b01';
const guid = (id: number) => `podcast:a1000000-0000-5000-8000-00000000${id}`;
const byFeedId = fixture('podcastindex-lepak-byfeedid.json') as Record<string, unknown>;

// Podcast Index answers, as the shapes it returns: trending and recent feeds for History, trending
// for the Singapore tags, and a search for “sejarah” in several languages.
function setup(fail: { recent?: boolean; lookup?: string } = {}) {
  const isRow = (endpoint: string, lang: string, cat: string | null) => (u: URL) =>
    u.pathname === `/api/1.0/${endpoint}` &&
    u.searchParams.get('lang')?.split(',').includes(lang) === true &&
    u.searchParams.get('cat') === cat;
  const fetch = fakeFetch([
    [
      isRow('podcasts/trending', 'ms', 'History'),
      fixture('podcastindex-lepak-trending-sejarah.json'),
    ],
    [isRow('recent/feeds', 'ms', 'History'), fixture('podcastindex-lepak-recent-sejarah.json')],
    [
      isRow('podcasts/trending', 'en-sg', null),
      fixture('podcastindex-lepak-trending-singapura.json'),
    ],
    [path('/api/1.0/recent/feeds'), fixture('podcastindex-lepak-recent-empty.json')],
    [path('/api/1.0/podcasts/trending'), fixture('podcastindex-lepak-recent-empty.json')],
    [path('/api/1.0/search/byterm'), fixture('podcastindex-lepak-search-sejarah.json')],
    [
      (u) => u.pathname === '/api/1.0/podcasts/byguid' && u.searchParams.get('guid') === GUID,
      fixture('podcastindex-byguid.json'),
    ],
    [path('/api/1.0/episodes/bypodcastguid'), fixture('podcastindex-episodes.json')],
  ]);
  // Feed lookups come from one fixture, keyed by feed ID.
  const answer: typeof fetch = Object.assign(
    async (url: string, init: { headers: Record<string, string> }) => {
      const parsed = new URL(url);
      const id = parsed.searchParams.get('id') ?? '';
      const failing =
        (fail.recent === true && parsed.pathname === '/api/1.0/recent/feeds') ||
        (parsed.pathname === '/api/1.0/podcasts/byfeedid' && id === fail.lookup);
      if (failing) return new Response('{}', { status: 503 });
      if (parsed.pathname === '/api/1.0/podcasts/byfeedid' && byFeedId[id] !== undefined) {
        fetch.calls.push({ url: parsed, headers: init.headers });
        return new Response(JSON.stringify(byFeedId[id]));
      }
      return fetch(url, init);
    },
    { calls: fetch.calls },
  );
  const addon = createLepakAddon(createUpstream(platform(answer), 'Lelap/1 (test)'), {
    key: 'TESTKEY',
    secret: 'TESTSECRET',
  });
  const get = async (route: string) => {
    const response = await addon.fetch(new Request(`${BASE}/${route}`));
    return { status: response.status, body: (await response.json()) as unknown };
  };
  const catalog = async (route: string) =>
    CatalogResponse.parse((await get(`catalog/podcast/${route}.json`)).body).metas;
  return { calls: fetch.calls, get, catalog };
}

describe('Lepak manifest', () => {
  it('has four podcast rows and a search, and no books', () => {
    const manifest = Manifest.parse(lepakManifest);
    expect(manifest.id).toBe('app.lelap.lepak');
    expect(manifest.types).toEqual(['podcast']);
    expect(manifest.description).toContain('Podcast Index');
    expect(manifest.catalogs.map((c) => [c.type, c.id, c.name])).toEqual([
      ['podcast', 'cerita', 'Cerita'],
      ['podcast', 'sembang', 'Sembang'],
      ['podcast', 'sejarah', 'Sejarah'],
      ['podcast', 'singapura', 'Singapura'],
      ['podcast', 'lepak-search', 'Lepak'],
    ]);
  });
});

describe('languages', () => {
  it('takes Malay and Indonesian in any region', () => {
    for (const tag of ['ms', 'MS-my', 'id', 'id-ID', 'id_ID', 'in', 'in-ID', 'ms-SG'])
      expect(isMalayOrIndonesian(tag), tag).toBe(true);
    for (const tag of ['en', 'en-MY', 'ind', 'mt', '', 'zh-sg'])
      expect(isMalayOrIndonesian(tag), tag).toBe(false);
  });

  it('takes a Singapore region tag only', () => {
    for (const tag of ['en-SG', 'zh-sg', 'ms-SG', 'ta-SG', 'en_SG'])
      expect(isSingaporean(tag), tag).toBe(true);
    for (const tag of ['en', 'zh', 'sg', 'en-US', 'msg'])
      expect(isSingaporean(tag), tag).toBe(false);
  });
});

describe('Lepak rows', () => {
  it('asks Podcast Index by language and category, signed', async () => {
    const { calls, catalog } = setup();
    await catalog('sejarah');
    const trending = calls.find((c) => c.url.pathname === '/api/1.0/podcasts/trending');
    expect(trending?.url.searchParams.get('lang')).toBe('ms,ms-my,ms-sg,ms-bn,id,id-id,in,in-id');
    expect(trending?.url.searchParams.get('cat')).toBe('History');
    expect(trending?.url.searchParams.get('max')).toBe('40');
    expect(trending?.headers).toMatchObject({ 'X-Auth-Key': 'TESTKEY' });
  });

  it('keeps Malay and Indonesian shows, and fills the row from recent feeds', async () => {
    const metas = await setup().catalog('sejarah');
    expect(metas.map((m) => [m.id, m.name])).toEqual([
      [guid(2001), 'Sembang Sejarah'],
      [guid(2002), 'Jejak Nusantara'],
      [guid(2004), 'Riwayat Kota'],
    ]);
    // A recent feed lists no author, cover or description; the lookup brings them.
    expect(metas[2]).toMatchObject({
      type: 'podcast',
      author: 'Contoh Radio',
      cover: 'https://images.example.org/2004-large.jpg',
      description: 'Kota-kota lama dan orangnya.',
    });
  });

  it('lists only shows whose feed says a Singapore tag in Singapura', async () => {
    const { calls, catalog } = setup();
    const metas = await catalog('singapura');
    expect(metas.map((m) => m.name)).toEqual(['Kopi Talk', 'Kisah Pulau']);
    const trending = calls.find((c) => c.url.pathname === '/api/1.0/podcasts/trending');
    expect(trending?.url.searchParams.get('lang')).toBe('en-sg,zh-sg,ms-sg,ta-sg');
    expect(trending?.url.searchParams.has('cat')).toBe(false);
  });

  it('asks for stories and talk by their category names', async () => {
    const { calls, catalog } = setup();
    expect(await catalog('cerita')).toEqual([]);
    expect(await catalog('sembang')).toEqual([]);
    const cats = calls
      .filter((c) => c.url.pathname === '/api/1.0/podcasts/trending')
      .map((c) => c.url.searchParams.get('cat'));
    expect(cats).toEqual(['Fiction,Drama,Stories', 'Society,Culture,Comedy,Leisure']);
  });

  it('keeps rows for a day', async () => {
    const { body } = await setup().get('catalog/podcast/sejarah.json');
    expect(body).toMatchObject({ cacheMaxAge: 24 * 60 * 60 });
  });

  it('keeps the trending shows when recent feeds fail, for 5 minutes', async () => {
    const { status, body } = await setup({ recent: true }).get('catalog/podcast/sejarah.json');
    expect(status).toBe(200);
    expect(CatalogResponse.parse(body).metas.map((m) => m.name)).toEqual([
      'Sembang Sejarah',
      'Jejak Nusantara',
    ]);
    expect(body).toMatchObject({ cacheMaxAge: 5 * 60 });
  });

  it('keeps a row briefly when a lookup fails', async () => {
    const { body } = await setup({ lookup: '2002' }).get('catalog/podcast/sejarah.json');
    expect(CatalogResponse.parse(body).metas.map((m) => m.name)).toEqual([
      'Sembang Sejarah',
      'Riwayat Kota',
    ]);
    expect(body).toMatchObject({ cacheMaxAge: 5 * 60 });
  });
});

describe('Lepak search', () => {
  it('finds Malay, Indonesian and Singapore shows only', async () => {
    const { calls, catalog } = setup();
    const metas = await catalog('lepak-search/search=sejarah');
    // The same question as the Catalog's podcast search, so one cached answer serves both.
    expect(calls[0]?.url.search).toBe('?q=sejarah&max=30');
    expect(metas.map((m) => m.name)).toEqual(['Sembang Sejarah', 'Jejak Nusantara', 'Kopi Talk']);
  });

  it('asks nobody for an empty search', async () => {
    const { calls, catalog } = setup();
    expect(await catalog('lepak-search/search=%20')).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('Lepak podcasts', () => {
  it('answers a podcast with its episodes', async () => {
    const { status, body } = await setup().get(`meta/podcast/podcast%3A${GUID}.json`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ meta: { id: `podcast:${GUID}`, name: 'The Garden Hour' } });
  });
});
