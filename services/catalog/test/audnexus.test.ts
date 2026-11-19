import { Meta, MetaResponse } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { asinOf, createAudnexus, regionsFor } from '../src/audnexus';
import { createCatalogAddon } from '../src/catalog/addon';
import { audioAsin, audioEditions, fetchEditions } from '../src/openlibrary';
import { createUpstream, type FetchLike, type ResponseCache, TTL } from '../src/upstream';
import { fakeFetch, fixture, path, platform } from './helpers';

const BASE = 'https://addons.test';
const ASIN = 'B002UZMLXM';
type Routes = Parameters<typeof fakeFetch>[0];

const AUDNEXUS_ROUTES: Routes = [
  [path(`/books/${ASIN}`), fixture(`audnexus-book-${ASIN}.json`)],
  [path(`/books/${ASIN}/chapters`), fixture(`audnexus-chapters-${ASIN}.json`)],
];
const OPEN_LIBRARY_ROUTES: Routes = [
  [path('/works/OL69612W.json'), fixture('openlibrary-work-OL69612W.json')],
  [path('/authors/OL23767A.json'), fixture('openlibrary-author-OL23767A.json')],
];
// A made-up audio edition, so the Open Library work below points at the recorded Audnexus book.
const AUDIO_EDITION = {
  entries: [{ physical_format: 'Audible eAudiobook', identifiers: { amazon: [ASIN] } }],
};

function addonWith(fetch: FetchLike, cache?: ResponseCache) {
  const addon = createCatalogAddon(
    createUpstream({ ...platform(fetch), ...(cache ? { cache } : {}) }, 'Lelap/1 (test)'),
    null,
  );
  return async (route: string) => {
    const response = await addon.fetch(new Request(`${BASE}/${route}`));
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

function memoryCache(): ResponseCache & { keys: () => string[] } {
  const store = new Map<string, string>();
  return {
    match: async (key) => {
      const body = store.get(key);
      return body === undefined ? undefined : new Response(body);
    },
    put: async (key, response) => void store.set(key, await response.text()),
    keys: () => [...store.keys()],
  };
}

describe('asinOf', () => {
  it('reads asin: IDs', () => {
    expect(asinOf('asin:B002UZMLXM')).toBe('B002UZMLXM');
    expect(asinOf('asin:b002uzmlxm')).toBeNull();
    expect(asinOf('asin:../books')).toBeNull();
    expect(asinOf('ol:OL1W')).toBeNull();
  });
});

describe('audioAsin', () => {
  it('takes the Audible edition, not the ebook or the CD', async () => {
    const fetch = fakeFetch([
      [path('/works/OL21745884W/editions.json'), fixture('openlibrary-editions-OL21745884W.json')],
    ]);
    const upstream = createUpstream(platform(fetch), 'Lelap/1 (test)');
    expect(audioAsin(await fetchEditions(upstream, 'OL21745884W'))).toBe('B08GB58KD5');
  });

  it('finds nothing without editions', async () => {
    const upstream = createUpstream(platform(fakeFetch([])), 'Lelap/1 (test)');
    expect(audioAsin(await fetchEditions(upstream, 'OL1W'))).toBeNull();
  });
});

describe('audioEditions', () => {
  it('lists the audio editions with their publisher, narrators and own IDs', async () => {
    const fetch = fakeFetch([
      [path('/works/OL21745884W/editions.json'), fixture('openlibrary-editions-OL21745884W.json')],
    ]);
    const upstream = createUpstream(platform(fetch), 'Lelap/1 (test)');
    const editions = audioEditions(await fetchEditions(upstream, 'OL21745884W'));
    expect(editions).toEqual([
      {
        key: 'OL57487091M',
        name: 'Audible Studios, 2021',
        year: 2021,
        publisher: 'Audible Studios',
        narrators: ['Ray Porter'],
        language: 'eng',
        cover: 'https://covers.openlibrary.org/b/id/14837125-L.jpg',
        externalIds: { asin: 'B08GB58KD5' },
      },
      {
        key: 'OL32436340M',
        name: 'Audible Studios on Brilliance Audio, 2021',
        year: 2021,
        publisher: 'Audible Studios on Brilliance Audio',
        cover: 'https://covers.openlibrary.org/b/id/11471446-L.jpg',
        externalIds: { isbn: '9781713630296' },
      },
    ]);
    // Every one fits the protocol.
    expect(
      Meta.parse({ id: 'ol:OL21745884W', type: 'audiobook', name: 'P', editions }).editions,
    ).toHaveLength(2);
  });
});

describe('asin: meta', () => {
  it('builds a meta from Audnexus', async () => {
    const get = addonWith(fakeFetch([...AUDNEXUS_ROUTES]));
    const { status, body } = await get(`meta/audiobook/asin:${ASIN}.json`);
    expect(status).toBe(200);
    const { meta, cacheMaxAge } = MetaResponse.parse(body);
    expect(cacheMaxAge).toBe(TTL.item);
    expect(meta).toMatchObject({
      id: `asin:${ASIN}`,
      name: 'The Name of the Wind',
      author: 'Patrick Rothfuss',
      narrators: ['Nick Podehl'],
      series: [{ name: 'Kingkiller Chronicle', position: '1' }],
      durationMs: 100_554_364,
      year: 2009,
      externalIds: { asin: ASIN },
    });
    expect(meta.chapters).toHaveLength(96);
    expect(meta.chapters?.slice(0, 2)).toEqual([
      { title: 'Opening Credits', startMs: 0 },
      { title: 'Prologue: A Silence of Three Parts', startMs: 42_662 },
    ]);
    expect(meta.description).not.toMatch(/<[a-z]/i);
  });

  it('asks the UK store when the US one lacks the ASIN', async () => {
    const uk = (u: URL) => u.searchParams.get('region') === 'uk';
    const fetch = fakeFetch([
      [(u) => uk(u) && u.pathname === `/books/${ASIN}`, fixture(`audnexus-book-${ASIN}.json`)],
      [
        (u) => uk(u) && u.pathname === `/books/${ASIN}/chapters`,
        fixture(`audnexus-chapters-${ASIN}.json`),
      ],
    ]);
    const { status, body } = await addonWith(fetch)(`meta/audiobook/asin:${ASIN}.json`);
    expect(status).toBe(200);
    expect(MetaResponse.parse(body).meta.chapters?.length).toBeGreaterThan(0);
    expect(regionsFor('ger')).toEqual(['de']);
    expect(regionsFor(undefined)).toEqual(['us', 'uk']);
  });

  it('answers 404 for an ASIN Audnexus does not know', async () => {
    const fetch = fakeFetch([[() => true, fixture('audnexus-book-unavailable.json'), 404]]);
    expect((await addonWith(fetch)(`meta/audiobook/asin:B08GB58KD5.json`)).status).toBe(404);
  });
});

describe('Open Library meta with Audnexus', () => {
  it('adds narrators, series, length and chapters', async () => {
    const fetch = fakeFetch([
      ...OPEN_LIBRARY_ROUTES,
      [path('/works/OL69612W/editions.json'), AUDIO_EDITION],
      ...AUDNEXUS_ROUTES,
    ]);
    const { body } = await addonWith(fetch)('meta/audiobook/ol:OL69612W.json');
    const { meta, cacheMaxAge } = MetaResponse.parse(body);
    expect(cacheMaxAge).toBe(TTL.item);
    // Open Library stays the source of title, author and cover.
    expect(meta.name).toBe('The Secret Garden');
    expect(meta.externalIds).toEqual({ ol: 'OL69612W', asin: ASIN });
    expect(meta.narrators).toEqual(['Nick Podehl']);
    expect(meta.series).toEqual([{ name: 'Kingkiller Chronicle', position: '1' }]);
    expect(meta.durationMs).toBe(100_554_364);
    expect(meta.chapters).toHaveLength(96);
  });

  it('still answers when Audnexus is down, and asks again soon', async () => {
    const fetch = fakeFetch([
      ...OPEN_LIBRARY_ROUTES,
      [path('/works/OL69612W/editions.json'), AUDIO_EDITION],
      [(u) => u.hostname === 'api.audnex.us', { error: 'down' }, 502],
    ]);
    const { status, body } = await addonWith(fetch)('meta/audiobook/ol:OL69612W.json');
    expect(status).toBe(200);
    const { meta, cacheMaxAge } = MetaResponse.parse(body);
    expect(cacheMaxAge).toBe(TTL.failure);
    expect(meta.name).toBe('The Secret Garden');
    expect(meta.narrators).toBeUndefined();
    expect(meta.chapters).toBeUndefined();
  });

  it('leaves a work without an audio edition alone', async () => {
    const fetch = fakeFetch([...OPEN_LIBRARY_ROUTES]);
    const { body } = await addonWith(fetch)('meta/audiobook/ol:OL69612W.json');
    expect(MetaResponse.parse(body).meta.externalIds).toEqual({ ol: 'OL69612W' });
    expect(fetch.calls.some((c) => c.url.hostname === 'api.audnex.us')).toBe(false);
  });
});

describe('Audnexus for editions', () => {
  it('fills narrators, length and cover of other editions with an ASIN, a few only', async () => {
    const other = 'B000000001';
    const fetch = fakeFetch([
      ...AUDNEXUS_ROUTES,
      [path(`/books/${other}`), fixture(`audnexus-book-${ASIN}.json`)],
      [path(`/books/${other}/chapters`), fixture(`audnexus-chapters-${ASIN}.json`)],
      [(u) => u.hostname === 'api.audnex.us', { error: 'not found' }, 404],
    ]);
    const audnexus = createAudnexus(createUpstream(platform(fetch), 'Lelap/1 (test)'));
    const editions = [
      { key: 'own', name: 'Own', externalIds: { asin: ASIN } },
      { key: 'other', name: 'Other', externalIds: { asin: other } },
      {
        key: 'told',
        name: 'Told',
        narrators: ['Kept'],
        durationMs: 1,
        cover: 'https://a.example/c.jpg',
        externalIds: { asin: 'B000000002' },
      },
      ...['3', '4', '5'].map((n) => ({ key: n, name: n, externalIds: { asin: `B00000000${n}` } })),
    ];
    const { meta } = await audnexus.enrich({
      id: 'ol:OL1W',
      type: 'audiobook',
      name: 'A work',
      externalIds: { asin: ASIN },
      editions,
    });
    const byKey = new Map(meta.editions?.map((e) => [e.key, e]));
    expect(byKey.get('other')?.narrators).toEqual(['Nick Podehl']);
    expect(byKey.get('other')?.durationMs).toBe(100_554_364);
    expect(byKey.get('told')).toEqual(editions[2]);
    // The work's own edition was asked already; of the rest, the first three are asked.
    const asked = new Set(fetch.calls.map((c) => c.url.pathname.split('/')[2]));
    expect(asked.has('B000000004')).toBe(true);
    expect(asked.has('B000000005')).toBe(false);
  });
});

describe('Audnexus requests', () => {
  it('pauses after a 429 for as long as Retry-After says', async () => {
    let now = 1_762_905_600_000;
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls++;
      return new Response('{}', { status: 429, headers: { 'Retry-After': '30' } });
    };
    const audnexus = createAudnexus(createUpstream({ fetch, now: () => now }, 'Lelap/1 (test)'));
    expect((await audnexus.details(ASIN)).status).toBe('failed');
    expect(calls).toBe(2);
    now += 29_000;
    expect((await audnexus.details(ASIN)).status).toBe('failed');
    expect(calls).toBe(2);
    now += 2_000;
    await audnexus.details(ASIN);
    expect(calls).toBe(4);
  });

  it('caches answers and misses', async () => {
    const cache = memoryCache();
    const fetch = fakeFetch([
      [path('/books/B08GB58KD5'), fixture('audnexus-book-unavailable.json'), 404],
      ...AUDNEXUS_ROUTES,
    ]);
    const audnexus = createAudnexus(createUpstream({ ...platform(fetch), cache }, 'test'));
    expect((await audnexus.details('B08GB58KD5')).status).toBe('missing');
    expect((await audnexus.details(ASIN)).status).toBe('ok');
    const before = fetch.calls.length;
    expect((await audnexus.details('B08GB58KD5')).status).toBe('missing');
    expect((await audnexus.details(ASIN)).status).toBe('ok');
    expect(fetch.calls.length).toBe(before);
  });

  it('drops chapter lists that do not run forward', async () => {
    const fetch = fakeFetch([
      [path(`/books/${ASIN}`), fixture(`audnexus-book-${ASIN}.json`)],
      [
        path(`/books/${ASIN}/chapters`),
        {
          runtimeLengthMs: 10_000,
          chapters: [
            { title: 'B', startOffsetMs: 5_000 },
            { title: 'A', startOffsetMs: 0 },
          ],
        },
      ],
    ]);
    const audnexus = createAudnexus(createUpstream(platform(fetch), 'test'));
    const meta = Meta.parse({
      id: 'ol:OL1W',
      type: 'audiobook',
      name: 'A',
      externalIds: { asin: ASIN },
    });
    const { meta: enriched } = await audnexus.enrich(meta);
    expect(enriched.chapters).toBeUndefined();
    expect(enriched.durationMs).toBe(10_000);
    expect(enriched.narrators).toEqual(['Nick Podehl']);
  });
});
