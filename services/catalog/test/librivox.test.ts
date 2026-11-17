import type { MetaPreview } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import {
  chooseParts,
  type Item,
  parseItem,
  parseSearch,
  ratingOf,
  readerOf,
  toPreview,
} from '../src/librivox/archive';
import { createLibrivoxAddon, manifest } from '../src/librivox/addon';
import { createUpstream } from '../src/upstream';
import { fakeFetch, fixture, path, platform } from './helpers';

const BASE = 'https://addons.test/librivox';
const SECRET_GARDEN = fixture('archive-metadata-secret_garden_librivox.json');
const SECRET_GARDEN_V3 = fixture('archive-metadata-secret_garden_1105_librivox.json');

function setup(extra: Parameters<typeof fakeFetch>[0] = []) {
  // Extra routes come first so they can override the defaults.
  const fetch = fakeFetch([
    ...extra,
    [path('/advancedsearch.php'), fixture('archive-search-secret-garden.json')],
    [path('/metadata/secret_garden_librivox'), SECRET_GARDEN],
    [path('/metadata/secret_garden_1105_librivox'), SECRET_GARDEN_V3],
    [path('/metadata/unknown_item'), {}],
  ]);
  const addon = createLibrivoxAddon(createUpstream(platform(fetch), 'Lelap/1 (test)'));
  const get = async (route: string) => {
    const response = await addon.fetch(new Request(`${BASE}/${route}`));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { fetch, get };
}

const item = (data: unknown): Item => {
  const parsed = parseItem(data);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
};

describe('LibriVox manifest', () => {
  it('declares the catalogs and their extras', () => {
    expect(manifest.catalogs.map((c) => [c.id, c.extra?.map((e) => e.name)])).toEqual([
      ['new', ['genre', 'skip']],
      ['popular', ['genre', 'skip']],
      ['search', ['search', 'skip']],
    ]);
    expect(manifest.idPrefixes).toEqual(['librivox:', 'ol:']);
  });
});

describe('LibriVox catalogs', () => {
  it('maps search results to previews', async () => {
    const { get, fetch } = setup();
    const { status, body } = await get('catalog/audiobook/search/search=secret%20garden.json');
    expect(status).toBe(200);
    expect(body.cacheMaxAge).toBe(21600);
    expect(body.metas).toContainEqual({
      id: 'librivox:secret_garden_librivox',
      type: 'audiobook',
      name: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      cover: 'https://archive.org/services/img/secret_garden_librivox',
      year: 2006,
      durationMs: 32_905_000,
      badges: { rating: 4.7 },
    });
    const q = fetch.calls[0]?.url.searchParams.get('q');
    expect(q).toBe(
      'collection:librivoxaudio AND mediatype:audio AND ((title:secret OR creator:secret) AND (title:garden OR creator:garden))',
    );
  });

  it('rates a cover only from enough reviews', async () => {
    const { get, fetch } = setup();
    const { body } = await get('catalog/audiobook/search/search=secret%20garden.json');
    const badges = Object.fromEntries(
      (body.metas as MetaPreview[]).map((m) => [m.id, m.badges ?? null]),
    );
    // One five-star review, and none at all.
    expect(badges['librivox:secretgarden_1212_librivox']).toBeNull();
    expect(badges['librivox:secret_garden_version2_librivox']).toBeNull();
    expect(fetch.calls[0]?.url.searchParams.getAll('fl[]')).toContain('avg_rating');
  });

  it('reads ratings that archive.org sends as text', () => {
    expect(ratingOf({ avg_rating: '3.25', num_reviews: '4' })).toBe(3.3);
    expect(ratingOf({ avg_rating: '', num_reviews: 9 })).toBeUndefined();
    expect(ratingOf({ avg_rating: 9, num_reviews: 9 })).toBeUndefined();
    expect(ratingOf({ avg_rating: undefined, num_reviews: undefined })).toBeUndefined();
  });

  it('escapes search input', async () => {
    const { get, fetch } = setup();
    await get(`catalog/audiobook/search/search=${encodeURIComponent('x) OR (*:*')}.json`);
    expect(fetch.calls[0]?.url.searchParams.get('q')).toBe(
      'collection:librivoxaudio AND mediatype:audio AND ((title:or OR creator:or))',
    );
  });

  it('answers an empty search without calling archive.org', async () => {
    const { get, fetch } = setup();
    const { body } = await get('catalog/audiobook/search/search=%2A%3A%2A.json');
    expect(body.metas).toEqual([]);
    expect(fetch.calls).toHaveLength(0);
  });

  it('sorts, filters by genre and pages', async () => {
    const { get, fetch } = setup();
    await get('catalog/audiobook/popular/genre=science%20fiction&skip=60.json');
    const params = fetch.calls[0]?.url.searchParams;
    expect(params?.get('q')).toBe(
      'collection:librivoxaudio AND mediatype:audio AND (subject:"science fiction")',
    );
    expect(params?.get('sort[]')).toBe('downloads desc');
    expect(params?.get('page')).toBe('3');
    expect(params?.get('rows')).toBe('30');

    await get('catalog/audiobook/new/genre=%22%29%20OR%20%28x.json');
    const unknownGenre = fetch.calls[1]?.url.searchParams;
    expect(unknownGenre?.get('q')).toBe('collection:librivoxaudio AND mediatype:audio');
    expect(unknownGenre?.get('sort[]')).toBe('publicdate desc');
  });

  it('skips search documents without a title', () => {
    const docs = parseSearch({ response: { docs: [{ identifier: 'a' }, { title: 'No id' }] } });
    expect(docs.map(toPreview)).toEqual([null]);
  });
});

describe('LibriVox meta', () => {
  it('maps archive.org metadata', async () => {
    const { get } = setup();
    const { status, body } = await get('meta/audiobook/librivox%3Asecret_garden_librivox.json');
    expect(status).toBe(200);
    expect(body.cacheMaxAge).toBe(86400);
    const meta = body.meta as Record<string, unknown>;
    expect(meta).toMatchObject({
      id: 'librivox:secret_garden_librivox',
      name: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      narrators: ['Kara Shallenberg'],
      year: 2006,
      language: 'eng',
      genres: ['children'],
      link: 'https://archive.org/details/secret_garden_librivox',
      externalIds: { archive: 'secret_garden_librivox', librivox: '56' },
      // Three reviews with stars: 5, 4 and 4.
      badges: { rating: 4.3 },
    });
    const description = meta.description as string;
    expect(description).toMatch(/^Librivox recording of The Secret Garden/);
    expect(description).toContain('Mary Lennox is a spoiled');
    expect(description).not.toMatch(/<a|For further information|Download M4B/);
    expect(meta.chapters).toEqual([
      { title: '01 - There is No One Left', startMs: 0 },
      { title: '02 - Mistress Mary Quite Contrary', startMs: 808_000 },
      { title: '03 - Across the Moor', startMs: 808_000 + 1_056_000 },
    ]);
  });

  it('leaves the title and author out of the genres', async () => {
    const { get } = setup();
    const { body } = await get('meta/audiobook/librivox%3Asecret_garden_1105_librivox.json');
    expect((body.meta as { genres: string[] }).genres).toEqual(['children']);
  });

  it('rates nothing without enough reviews', async () => {
    const { get } = setup();
    const { body } = await get('meta/audiobook/librivox%3Asecret_garden_1105_librivox.json');
    expect((body.meta as MetaPreview).badges).toBeUndefined();
  });

  it('is a 404 for unknown identifiers and items outside LibriVox', async () => {
    const { get } = setup([
      [path('/metadata/other_item'), { metadata: { identifier: 'other_item', collection: 'x' } }],
    ]);
    expect((await get('meta/audiobook/librivox%3Aunknown_item.json')).status).toBe(404);
    expect((await get('meta/audiobook/librivox%3Aother_item.json')).status).toBe(404);
    expect((await get('meta/audiobook/librivox%3Amissing.json')).status).toBe(404);
  });

  it('finds the reader in the different credit styles', () => {
    expect(readerOf('LibriVox recording. Read by Ashleighjane.\n\nWhen Mary')).toBe('Ashleighjane');
    expect(readerOf('Read in English by StudioMike\nThe Adventures')).toBe('StudioMike');
    expect(readerOf('Read by J. M. Smith and Ann Lee. Summary')).toBe('J. M. Smith and Ann Lee');
    expect(readerOf('A collection of stories.')).toBeUndefined();
  });
});

describe('LibriVox streams', () => {
  it('returns the 64 kb parts in order with sizes and durations', async () => {
    const { get } = setup();
    const { body } = await get('stream/audiobook/librivox%3Asecret_garden_librivox.json');
    const [stream] = body.streams as Record<string, unknown>[];
    expect(stream).toMatchObject({
      sourceKey: 'librivox:secret_garden_librivox:64kb',
      name: 'LibriVox',
      title: 'Read by Kara Shallenberg',
      mime: 'audio/mpeg',
      downloadable: true,
      size: 6469090 + 8450355 + 4985753,
    });
    expect(stream?.parts).toEqual([
      {
        url: 'https://archive.org/download/secret_garden_librivox/secretgarden_01_burnett_64kb.mp3',
        title: '01 - There is No One Left',
        durationMs: 808_000,
        size: 6469090,
      },
      {
        url: 'https://archive.org/download/secret_garden_librivox/secretgarden_02_burnett_64kb.mp3',
        title: '02 - Mistress Mary Quite Contrary',
        durationMs: 1_056_000,
        size: 8450355,
      },
      {
        url: 'https://archive.org/download/secret_garden_librivox/secretgarden_03_burnett_64kb.mp3',
        title: '03 - Across the Moor',
        durationMs: 623_000,
        size: 4985753,
      },
    ]);
  });

  it('falls back to VBR, then 128 kb', () => {
    const base = item(SECRET_GARDEN);
    const without = (...formats: string[]): Item => ({
      ...base,
      files: base.files.filter((f) => !formats.includes(f.format ?? '')),
    });
    const vbr = chooseParts(without('64Kbps MP3'));
    expect(vbr?.key).toBe('vbr');
    expect(vbr?.parts[0]?.durationMs).toBe(808_540);
    expect(vbr?.parts[0]?.url).toMatch(/secretgarden_01_burnett\.mp3$/);

    const relabelled: Item = {
      ...base,
      files: base.files
        .filter((f) => f.format === 'VBR MP3')
        .map((f) => ({ ...f, format: '128Kbps MP3' })),
    };
    expect(chooseParts(relabelled)?.key).toBe('128kb');
    expect(chooseParts(without('64Kbps MP3', 'VBR MP3'))).toBeNull();
  });

  it('orders by track number, borrowing it from the original file', () => {
    const base = item(SECRET_GARDEN_V3);
    const reversed: Item = { ...base, files: [...base.files].reverse() };
    const titles = chooseParts(reversed)?.parts.map((p) => p.title);
    expect(titles).toEqual([
      '01 - There is No One Left',
      '02 - Mistress Mary Quite Contrary',
      '03 - Across the Moor',
    ]);
  });

  it('falls back to natural file names when tracks are missing', () => {
    const files = ['ch10.mp3', 'ch2.mp3', 'ch1.mp3'].map((name) => ({
      name,
      format: '64Kbps MP3',
      length: '60',
      title: undefined,
      track: name === 'ch10.mp3' ? '1' : undefined,
      size: undefined,
      original: undefined,
    }));
    const chosen = chooseParts({ metadata: { identifier: 'x' }, files } as Item);
    expect(chosen?.parts.map((p) => p.title)).toEqual(['ch1', 'ch2', 'ch10']);
  });

  it('is empty for unknown identifiers', async () => {
    const { get } = setup();
    const { status, body } = await get('stream/audiobook/librivox%3Aunknown_item.json');
    expect(status).toBe(200);
    expect(body.streams).toEqual([]);
  });

  it('finds recordings of an Open Library work', async () => {
    // The recorded lookup lists four identifiers; two have metadata fixtures, two are unknown.
    const { get, fetch } = setup([
      [path('/advancedsearch.php'), fixture('archive-search-ol-lookup.json')],
      [path('/works/OL69612W.json'), fixture('openlibrary-work-OL69612W.json')],
      [path('/authors/OL23767A.json'), fixture('openlibrary-author-OL23767A.json')],
    ]);
    const { body } = await get('stream/audiobook/ol%3AOL69612W.json');
    const streams = body.streams as { sourceKey: string; title?: string }[];
    expect(streams.map((s) => [s.sourceKey, s.title])).toEqual([
      ['librivox:secret_garden_librivox:64kb', 'Read by Kara Shallenberg'],
      ['librivox:secret_garden_1105_librivox:64kb', 'Read by Ashleighjane'],
    ]);
    const search = fetch.calls.find((c) => c.url.pathname === '/advancedsearch.php');
    expect(search?.url.searchParams.get('q')).toBe(
      'collection:librivoxaudio AND mediatype:audio AND (title:(secret AND garden) AND creator:(burnett))',
    );
    expect(search?.url.searchParams.get('rows')).toBe('5');
    expect(search?.url.searchParams.get('sort[]')).toBe('downloads desc');
  });

  it('answers an empty list when the lookup fails', async () => {
    const { get } = setup([[path('/works/OL1W.json'), { error: 'down' }, 503]]);
    const { status, body } = await get('stream/audiobook/ol%3AOL1W.json');
    expect(status).toBe(200);
    expect(body).toEqual({ streams: [], cacheMaxAge: 300 });
  });
});
