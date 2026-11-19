import { SeriesResponse, seriesPath } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createCatalogAddon } from '../src/catalog/addon';
import { createSeriesAddon } from '../src/series/addon';
import { createUpstream } from '../src/upstream';
import { findSeries, languageOf, nameKey, workSeriesUrl } from '../src/wikidata';
import { fakeFetch, fixture, platform } from './helpers';

// Wikidata's answers as recorded on 2026-11-19 for Harry Potter (en, da) and Department Q
// (en, and Afdeling Q in da), keyed by the search or the SPARQL query.
const answers = fixture('wikidata-answers.json') as Record<string, unknown>;

const keyOf = (url: URL) =>
  url.searchParams.get('action') === 'wbsearchentities'
    ? `search:${url.searchParams.get('search')}:${url.searchParams.get('language')}`
    : `sparql:${url.searchParams.get('query')}`;

function setup() {
  const fetch = fakeFetch([[(url) => keyOf(url) in answers, null]]);
  // fakeFetch answers one body per route, so route by key here instead.
  const routed = Object.assign(
    async (url: string, init: { headers: Record<string, string> }) => {
      await fetch(url, init);
      const body = answers[keyOf(new URL(url))];
      return body === undefined
        ? new Response('{"error":"not found"}', { status: 404 })
        : new Response(JSON.stringify(body));
    },
    { calls: fetch.calls },
  );
  const upstream = createUpstream(platform(routed), 'Lelap/1 (+https://example.org/lelap)');
  return { upstream, calls: fetch.calls };
}

const positions = (list: { position?: string | undefined; title: string }[]) =>
  list.map((v) => `${v.position ?? '-'} ${v.title}`);

describe('Wikidata series', () => {
  it('finds Harry Potter in release order, with the prequel and the play in place', async () => {
    const { upstream } = setup();
    const series = await findSeries(upstream, {
      name: 'Harry Potter',
      author: 'J. K. Rowling',
      language: 'en',
    });
    expect(series?.id).toBe('wikidata:Q8337');
    expect(positions(series?.volumes ?? [])).toEqual([
      '0.5 Harry Potter prequel',
      "1 Harry Potter and the Philosopher's Stone",
      '2 Harry Potter and the Chamber of Secrets',
      '3 Harry Potter and the Prisoner of Azkaban',
      '4 Harry Potter and the Goblet of Fire',
      '5 Harry Potter and the Order of the Phoenix',
      '6 Harry Potter and the Half-Blood Prince',
      '7 Harry Potter and the Deathly Hallows',
      '- Harry Potter and the Cursed Child',
    ]);
    const first = series?.volumes[1];
    expect(first?.released).toBe('1997-06-26');
    expect(first?.externalIds).toEqual({ wikidata: 'Q43361' });
    // Wikidata writes 1 January for a year alone.
    expect(series?.volumes[2]?.released).toBe('1998');
  });

  it('names the books in the asked language, with English next to them', async () => {
    const { upstream } = setup();
    const series = await findSeries(upstream, {
      name: 'Harry Potter',
      author: 'J.K. Rowling',
      language: 'da',
    });
    expect(series?.volumes[1]?.title).toBe('Harry Potter og De Vises Sten');
    expect(series?.volumes[1]?.titles).toEqual({
      da: 'Harry Potter og De Vises Sten',
      en: "Harry Potter and the Philosopher's Stone",
    });
    // No Danish title: the original language's, which is English.
    expect(series?.volumes[0]?.title).toBe('Harry Potter prequel');
  });

  it('finds Department Q, not the TV series, with the Danish titles', async () => {
    const { upstream } = setup();
    const english = await findSeries(upstream, {
      name: 'Department Q',
      author: 'Jussi Adler-Olsen',
      language: 'en',
    });
    expect(english?.id).toBe('wikidata:Q86567441');
    expect(english?.volumes[0]?.titles).toEqual({
      en: 'The Keeper of Lost Causes',
      da: 'Kvinden i buret',
    });
    const danish = await findSeries(upstream, {
      name: 'Afdeling Q',
      author: 'Jussi Adler-Olsen',
      language: 'da',
    });
    expect(positions(danish?.volumes ?? [])).toEqual([
      '1 Kvinden i buret',
      '2 Fasandræberne',
      '3 Flaskepost fra P',
      '4 Journal 64',
      '5 Marco Effekten',
      '6 Den grænseløse',
      '7 Selfies',
      '8 Offer 2117',
      '9 Natrium Chlorid',
    ]);
    // Wikidata has a year for some only.
    expect(danish?.volumes.map((v) => v.released ?? null)).toEqual([
      '2007',
      '2008',
      null,
      '2010',
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('wants the author when it is given', async () => {
    const { upstream } = setup();
    expect(
      await findSeries(upstream, { name: 'Afdeling Q', author: 'Someone Else', language: 'da' }),
    ).toBeNull();
  });

  it('finds the series of an Open Library work', async () => {
    const { upstream, calls } = setup();
    const series = await findSeries(upstream, {
      name: 'Harry Potter',
      author: 'J. K. Rowling',
      language: 'en',
      olWork: 'OL82563W',
    });
    expect(series?.id).toBe('wikidata:Q8337');
    expect(calls.some((c) => c.url.searchParams.get('query')?.includes('"OL82563W"'))).toBe(true);
    expect(() => workSeriesUrl('OL1W" } DROP')).toThrow();
  });

  it('sends the name, author and language only, with its User-Agent', async () => {
    const { upstream, calls } = setup();
    await findSeries(upstream, { name: 'Afdeling Q', author: 'Jussi Adler-Olsen', language: 'da' });
    for (const call of calls) {
      expect(['www.wikidata.org', 'query.wikidata.org']).toContain(call.url.host);
      expect(call.headers['User-Agent']).toBe('Lelap/1 (+https://example.org/lelap)');
    }
    const search = calls.find((c) => c.url.searchParams.get('action') === 'wbsearchentities');
    expect(search?.url.searchParams.get('search')).toBe('Afdeling Q');
    // The author is compared here, never sent.
    expect(calls.some((c) => c.url.href.includes('Adler'))).toBe(false);
  });

  it('folds names and languages', () => {
    expect(nameKey('The Expanse Series')).toBe('expanse');
    expect(languageOf('da-DK')).toBe('da');
    expect(languageOf('"; DROP')).toBe('en');
    expect(languageOf(undefined)).toBe('en');
  });
});

describe('Whole series add-on', () => {
  it('answers the app with the series, cached for a week', async () => {
    const { upstream } = setup();
    const addon = createSeriesAddon(upstream);
    expect(addon.manifest.resources).toContainEqual({ name: 'series', types: ['audiobook'] });
    const response = await addon.fetch(
      new Request(
        `https://addons.test/series/${seriesPath('audiobook', 'Afdeling Q', { author: 'Jussi Adler-Olsen', language: 'da' })}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=604800');
    const body = SeriesResponse.parse(await response.json());
    expect(body.series?.volumes).toHaveLength(9);
    const unknown = await addon.fetch(
      new Request(`https://addons.test/series/${seriesPath('audiobook', 'Nothing here')}`),
    );
    expect(await unknown.json()).toEqual({ series: null, cacheMaxAge: 604800 });
  });

  it('leaves the Open Library catalog as apps before revision 11 read it', () => {
    // Those apps refuse a manifest with a resource they don't know.
    const names = createCatalogAddon(setup().upstream, null).manifest.resources.map((r) =>
      typeof r === 'string' ? r : r.name,
    );
    expect(names).toEqual(['catalog', 'meta']);
  });
});
