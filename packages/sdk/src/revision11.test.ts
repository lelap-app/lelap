import { describe, expect, it } from 'vitest';

import { createAddon } from './addon';
import { checkAddon } from './check';
import { locatePath, parseRoute, seriesPath } from './paths';
import {
  LATEST_PROTOCOL_VERSION,
  LibraryResponse,
  LocateRequest,
  LocateResponse,
  Manifest,
  offersLocate,
  offersSeries,
  SeriesResponse,
} from './protocol';

// Revision 11 (M100): a library listing may hand back new settings, and an add-on inside the app
// may say where its files are before a book streams.

const inApp = {
  id: 'org.example.server',
  version: '1.0.0',
  protocol: 1 as const,
  protocolVersion: 11,
  name: 'Server',
  description: 'A media server',
  types: ['audiobook' as const],
  catalogs: [],
  resources: ['library', 'locate'],
  sandbox: { hosts: [] },
  settings: [{ key: 'url', label: 'Address', type: 'url' as const, host: true }],
};

describe('revision 11', () => {
  it('is the newest revision', () => {
    expect(LATEST_PROTOCOL_VERSION).toBe(11);
  });

  it('locates files only for an add-on inside the app with a library', () => {
    expect(offersLocate(Manifest.parse(inApp))).toBe(true);
    expect(offersLocate(Manifest.parse({ ...inApp, resources: ['library'] }))).toBe(false);
    const web = { ...inApp, sandbox: undefined, settings: undefined, resources: ['locate'] };
    expect(Manifest.safeParse(web).success).toBe(false);
    expect(locatePath()).toBe('locate/audiobook/all.json');
  });

  it('takes settings with a listing, by field key', () => {
    const parsed = LibraryResponse.parse({ files: [], settings: { url: 'https://new.example' } });
    expect(parsed.settings).toEqual({ url: 'https://new.example' });
    expect(LibraryResponse.safeParse({ files: [], settings: { url: 3 } }).success).toBe(false);
  });

  it('asks with at least one file, and may answer with none', () => {
    const file = { path: 'A/B/01.mp3', url: 'https://nas.example/01.mp3' };
    expect(LocateRequest.safeParse({ files: [] }).success).toBe(false);
    expect(LocateRequest.parse({ files: [file] }).files).toEqual([file]);
    expect(LocateResponse.parse({ files: [] }).files).toEqual([]);
    expect(LocateResponse.safeParse({ files: [{ ...file, url: 'ftp://x' }] }).success).toBe(false);
  });
});

// Revision 11 (M127): every book of a series, asked by its name.
describe('series', () => {
  const web: Manifest = {
    id: 'org.example.series',
    version: '1.0.0',
    protocol: 1,
    name: 'Series',
    description: 'Whole series',
    types: ['audiobook'],
    catalogs: [],
    resources: [{ name: 'series', types: ['audiobook'] }],
  };
  const volumes = [
    { title: 'Kvinden i buret', position: '1', released: '2007' },
    { title: 'Natrium Chlorid', position: '9', titles: { en: 'The Shadow Murders' } },
    { title: 'A companion' },
  ];
  const addon = createAddon({
    manifest: web,
    series: ({ name, extra }) => ({
      series:
        name === 'Afdeling Q' && extra.author === 'Jussi Adler-Olsen'
          ? { name, id: 'wikidata:Q86567441', volumes }
          : null,
      cacheMaxAge: 3600,
    }),
  });

  it('asks by name with extras and parses back', () => {
    const path = seriesPath('audiobook', 'Afdeling Q', { author: 'Jussi Adler-Olsen' });
    expect(path).toBe('series/audiobook/Afdeling%20Q/author=Jussi%20Adler-Olsen.json');
    expect(parseRoute(path)).toEqual({
      resource: 'series',
      type: 'audiobook',
      id: 'Afdeling Q',
      extra: { author: 'Jussi Adler-Olsen' },
    });
    expect(seriesPath('audiobook', 'A/B')).toBe('series/audiobook/A%2FB.json');
  });

  it('answers through createAddon, null for a series it does not know', async () => {
    const ask = async (path: string) =>
      (await (await addon.fetch(new Request(`https://addon.test/${path}`))).json()) as unknown;
    const found = SeriesResponse.parse(
      await ask(seriesPath('audiobook', 'Afdeling Q', { author: 'Jussi Adler-Olsen' })),
    );
    expect(found.series?.volumes.map((v) => v.position)).toEqual(['1', '9', undefined]);
    expect(await ask(seriesPath('audiobook', 'Dune'))).toEqual({ series: null, cacheMaxAge: 3600 });
  });

  it('is offered for its types, whatever the ID prefixes', () => {
    expect(offersSeries(Manifest.parse(web))).toBe(true);
    expect(offersSeries(Manifest.parse({ ...web, idPrefixes: ['ol:'] }))).toBe(true);
    expect(offersSeries(Manifest.parse(web), 'podcast')).toBe(false);
    expect(offersSeries(Manifest.parse({ ...web, resources: ['catalog'] }))).toBe(false);
  });

  it('takes a year or a date as the release, nothing else', () => {
    const valid = (released: string) =>
      SeriesResponse.safeParse({ series: { name: 'X', volumes: [{ title: 'Y', released }] } })
        .success;
    expect(valid('1997')).toBe(true);
    expect(valid('1997-06-26')).toBe(true);
    expect(valid('June 1997')).toBe(false);
  });

  it('is checked by lelap-sdk check', async () => {
    const report = await checkAddon('https://addon.test/manifest.json', {
      fetch: async (url, init) => addon.fetch(new Request(url, init)),
      series: { name: 'Afdeling Q', author: 'Jussi Adler-Olsen' },
    });
    expect(report.problems.filter((p) => p.kind === 'series')).toEqual([
      expect.objectContaining({
        level: 'warning',
        field: 'series.volumes[2]',
        message: 'Neither a position nor a release date, so the app lists this book last.',
      }),
    ]);
  });

  it('warns of an add-on that answers every name', async () => {
    const eager = createAddon({
      manifest: web,
      series: ({ name }) => ({ series: { name, volumes: [] }, cacheMaxAge: 60 }),
    });
    const report = await checkAddon('https://addon.test/manifest.json', {
      fetch: async (url, init) => eager.fetch(new Request(url, init)),
    });
    expect(report.problems.map((p) => p.message)).toContain(
      'Answered a series for a name no series has; the app would list its books on the wrong series page. Send {"series": null}.',
    );
    expect(report.notes).toContain(
      'No series to check the series resource with; pass one with --series.',
    );
  });
});
