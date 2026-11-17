import { createHash } from 'node:crypto';

import { Manifest, supports } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { catalogManifest, createCatalogAddon } from '../src/catalog/addon';
import { authHeaders } from '../src/podcastindex';
import { createUpstream } from '../src/upstream';
import { fakeFetch, fixture, path, platform } from './helpers';

const BASE = 'https://addons.test';
const CREDENTIALS = { key: 'TESTKEY', secret: 'TESTSECRET' };
const GUID = '5b8a6a0e-2d1c-5c3b-9a55-0f3c2a8e1b01';
const NOW = 1_762_905_600_000;

function setup(podcasts: boolean) {
  const fetch = fakeFetch([
    [path('/search.json'), fixture('openlibrary-search-secret-garden.json')],
    [path('/works/OL69612W.json'), fixture('openlibrary-work-OL69612W.json')],
    [
      path('/works/OL2W.json'),
      { key: '/works/OL2W', type: { key: '/type/redirect' }, location: '/works/OL69612W' },
    ],
    [path('/authors/OL23767A.json'), fixture('openlibrary-author-OL23767A.json')],
    [path('/api/1.0/podcasts/trending'), fixture('podcastindex-trending.json')],
    [
      (u) => u.pathname === '/api/1.0/podcasts/byfeedid' && u.searchParams.get('id') === '1001',
      fixture('podcastindex-byfeedid-1001.json'),
    ],
    [
      (u) => u.pathname === '/api/1.0/podcasts/byfeedid' && u.searchParams.get('id') === '1002',
      fixture('podcastindex-byfeedid-1002.json'),
    ],
    [path('/api/1.0/search/byterm'), fixture('podcastindex-search.json')],
    [
      (u) => u.pathname === '/api/1.0/podcasts/byguid' && u.searchParams.get('guid') === GUID,
      fixture('podcastindex-byguid.json'),
    ],
    [path('/api/1.0/podcasts/byguid'), fixture('podcastindex-byguid-unknown.json')],
    [path('/api/1.0/episodes/bypodcastguid'), fixture('podcastindex-episodes.json')],
  ]);
  const addon = createCatalogAddon(
    createUpstream(platform(fetch), 'Lelap/1 (test)'),
    podcasts ? CREDENTIALS : null,
  );
  const get = async (route: string) => {
    const response = await addon.fetch(new Request(`${BASE}/${route}`));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { fetch, get, addon };
}

describe('Catalog manifest', () => {
  it('leaves Podcast Index out without its secrets', () => {
    const manifest = Manifest.parse(catalogManifest(false));
    expect(manifest.types).toEqual(['audiobook']);
    expect(manifest.idPrefixes).toEqual(['ol:', 'asin:']);
    expect(manifest.catalogs.map((c) => [c.type, c.id, c.extra?.map((e) => e.name)])).toEqual([
      ['audiobook', 'openlibrary-search', ['search', 'skip']],
    ]);
    expect(supports(manifest, 'meta', 'podcast', `podcast:${GUID}`)).toBe(false);
  });

  it('adds the podcast catalogs and prefix with them', () => {
    const manifest = Manifest.parse(catalogManifest(true));
    expect(manifest.types).toEqual(['audiobook', 'podcast']);
    expect(manifest.idPrefixes).toEqual(['ol:', 'asin:', 'podcast:']);
    expect(manifest.catalogs.map((c) => [c.type, c.id, c.extra?.map((e) => e.name)])).toEqual([
      ['audiobook', 'openlibrary-search', ['search', 'skip']],
      ['podcast', 'trending', undefined],
      ['podcast', 'podcast-search', ['search']],
    ]);
    expect(supports(manifest, 'meta', 'podcast', `podcast:${GUID}`)).toBe(true);
    expect(supports(manifest, 'stream', 'audiobook', 'ol:OL1W')).toBe(false);
  });

  it('serves the manifest that matches the secrets', async () => {
    expect((await setup(false).get('manifest.json')).body.types).toEqual(['audiobook']);
    expect((await setup(true).get('manifest.json')).body.types).toEqual(['audiobook', 'podcast']);
  });
});

describe('Open Library', () => {
  it('maps search results to previews', async () => {
    const { get, fetch } = setup(false);
    const { body } = await get(
      'catalog/audiobook/openlibrary-search/search=secret%20garden&skip=30.json',
    );
    expect((body.metas as unknown[])[0]).toEqual({
      id: 'ol:OL69612W',
      type: 'audiobook',
      name: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      year: 1911,
      cover: 'https://covers.openlibrary.org/b/id/12622062-M.jpg',
    });
    const params = fetch.calls[0]?.url.searchParams;
    expect(params?.get('q')).toBe('secret garden');
    expect(params?.get('offset')).toBe('30');
    expect(params?.get('limit')).toBe('30');
    expect(fetch.calls[0]?.headers['User-Agent']).toBe('Lelap/1 (test)');
  });

  it('maps a work to meta with its author', async () => {
    const { get } = setup(false);
    const { status, body } = await get('meta/audiobook/ol%3AOL69612W.json');
    expect(status).toBe(200);
    expect(body.meta).toMatchObject({
      id: 'ol:OL69612W',
      name: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      cover: 'https://covers.openlibrary.org/b/id/12622062-L.jpg',
      link: 'https://openlibrary.org/works/OL69612W',
      externalIds: { ol: 'OL69612W' },
    });
    expect((body.meta as { description: string }).description).toMatch(/^A ten-year-old orphan/);
    expect((body.meta as { genres: string[] }).genres).toHaveLength(10);
  });

  it('follows a redirected work', async () => {
    const { body } = await setup(false).get('meta/audiobook/ol%3AOL2W.json');
    expect((body.meta as { name: string }).name).toBe('The Secret Garden');
  });

  it('is a 404 for unknown works and malformed IDs', async () => {
    const { get } = setup(false);
    expect((await get('meta/audiobook/ol%3AOL404W.json')).status).toBe(404);
    expect((await get('meta/audiobook/ol%3Anot-a-work.json')).status).toBe(404);
  });
});

describe('Podcast Index', () => {
  it('signs requests with key, date and the SHA-1 of key, secret and date', async () => {
    const headers = await authHeaders(CREDENTIALS, NOW);
    expect(headers).toEqual({
      'X-Auth-Key': 'TESTKEY',
      'X-Auth-Date': '1762905600',
      Authorization: createHash('sha1').update('TESTKEYTESTSECRET1762905600').digest('hex'),
    });
  });

  it('sends the auth headers and User-Agent upstream', async () => {
    const { get, fetch } = setup(true);
    await get('catalog/podcast/podcast-search/search=garden.json');
    expect(fetch.calls[0]?.headers).toMatchObject({
      'User-Agent': 'Lelap/1 (test)',
      'X-Auth-Key': 'TESTKEY',
      'X-Auth-Date': '1762905600',
    });
  });

  it('maps trending feeds, looking up their GUIDs', async () => {
    const { body } = await setup(true).get('catalog/podcast/trending.json');
    expect(body.metas).toEqual([
      {
        id: `podcast:${GUID}`,
        type: 'podcast',
        name: 'The Garden Hour',
        author: 'Example Media',
        cover: 'https://images.example.org/garden-hour-large.jpg',
        description: 'Weekly talk about gardens & growing things.',
      },
      {
        id: 'podcast:c7e2f4d1-8a3b-5e6f-b1c2-d3e4f5a6b7c8',
        type: 'podcast',
        name: 'Night Reading',
        description: 'Public-domain stories read aloud.',
      },
    ]);
  });

  it('maps search results', async () => {
    const { body } = await setup(true).get('catalog/podcast/podcast-search/search=garden.json');
    expect((body.metas as { id: string }[]).map((m) => m.id)).toEqual([`podcast:${GUID}`]);
  });

  it('maps a podcast with its episodes', async () => {
    const { status, body } = await setup(true).get(`meta/podcast/podcast%3A${GUID}.json`);
    expect(status).toBe(200);
    expect(body.meta).toMatchObject({
      id: `podcast:${GUID}`,
      type: 'podcast',
      name: 'The Garden Hour',
      language: 'en',
      genres: ['Home', 'Garden'],
      link: 'https://example.org/garden-hour',
      feed: 'https://feeds.example.org/garden-hour.xml',
      episodes: [
        {
          id: 'episode:garden-hour-episode-2',
          title: 'Planting bulbs',
          released: '2025-11-12T00:00:00.000Z',
          durationMs: 1_830_000,
          description: 'When and how deep.',
        },
        {
          id: 'episode:garden-hour-episode-1',
          title: 'Welcome',
          released: '2025-11-05T00:00:00.000Z',
        },
      ],
    });
  });

  it('is a 404 for unknown podcasts, and when podcasts are off', async () => {
    expect(
      (await setup(true).get('meta/podcast/podcast%3A00000000-0000-0000-0000-000000000000.json'))
        .status,
    ).toBe(404);
    expect((await setup(false).get(`meta/podcast/podcast%3A${GUID}.json`)).status).toBe(404);
    expect((await setup(false).get('catalog/podcast/trending.json')).status).toBe(404);
  });
});
