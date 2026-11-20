import { describe, expect, it } from 'vitest';

import { createApp, podcastIndexCredentials, userAgent } from '../src/app';
import type { ResponseCache } from '../src/upstream';
import { fakeFetch, fixture, path } from './helpers';

function memoryCache(): ResponseCache & { keys: string[] } {
  const store = new Map<string, string>();
  return {
    keys: [],
    async match(key) {
      const body = store.get(key);
      return body === undefined ? undefined : new Response(body);
    },
    async put(key, response) {
      this.keys.push(key);
      store.set(key, await response.text());
    },
  };
}

function setup(env = {}) {
  const fetch = fakeFetch([
    [path('/advancedsearch.php'), fixture('archive-search-secret-garden.json')],
    [path('/search.json'), fixture('openlibrary-search-secret-garden.json')],
  ]);
  const cache = memoryCache();
  const app = createApp({ fetch, cache }, { SOURCE_URL: 'https://example.org/source', ...env });
  return { app, fetch, cache };
}

describe('the worker app', () => {
  it('points at the manifests and configure pages from the root', async () => {
    const response = await setup().app.request('https://addons.test/');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(await response.json()).toEqual({
      name: 'Lelap add-ons',
      addons: [
        'https://addons.test/manifest.json',
        'https://addons.test/librivox/manifest.json',
        'https://addons.test/internet-archive/manifest.json',
        'https://addons.test/series/manifest.json',
        'https://addons.test/lectures/manifest.json',
      ],
      configure: [
        'https://addons.test/hardcover/configure',
        'https://addons.test/gpodder/configure',
        'https://addons.test/bookwyrm/configure',
      ],
    });
  });

  it('routes the Catalog at the root and LibriVox under /librivox', async () => {
    const { app } = setup();
    const catalog = await app.request('https://addons.test/manifest.json');
    expect(((await catalog.json()) as { id: string }).id).toBe('app.lelap.catalog');
    const librivox = await app.request('https://addons.test/librivox/manifest.json');
    expect(((await librivox.json()) as { id: string }).id).toBe('app.lelap.librivox');
    expect(librivox.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(librivox.headers.get('Cache-Control')).toBe('public, max-age=3600');

    const search = await app.request(
      'https://addons.test/librivox/catalog/audiobook/search/search=secret%20garden.json',
    );
    expect(search.status).toBe(200);
    expect(search.headers.get('Cache-Control')).toBe('public, max-age=21600');
    const books = await app.request(
      'https://addons.test/catalog/audiobook/openlibrary-search/search=secret%20garden.json',
    );
    expect(((await books.json()) as { metas: unknown[] }).metas).toHaveLength(3);
  });

  it('answers CORS preflight and 404s', async () => {
    const { app } = setup();
    const preflight = await app.request('https://addons.test/librivox/manifest.json', {
      method: 'OPTIONS',
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(
      (await app.request('https://addons.test/librivox/catalog/audiobook/nope.json')).status,
    ).toBe(404);
    expect((await app.request('https://addons.test/librivoxes/manifest.json')).status).toBe(404);
    expect((await app.request('https://addons.test/stream/audiobook/ol%3AOL1W.json')).status).toBe(
      404,
    );
  });

  it('caches upstream answers by URL', async () => {
    const { app, fetch, cache } = setup();
    const url = 'https://addons.test/librivox/catalog/audiobook/popular.json';
    await app.request(url);
    await app.request(url);
    expect(fetch.calls).toHaveLength(1);
    expect(cache.keys).toHaveLength(1);
    expect(fetch.calls[0]?.headers['User-Agent']).toBe('Lelap/1 (+https://example.org/source)');
  });

  it('serves Lepak only with Podcast Index keys', async () => {
    const without = setup().app;
    expect((await without.request('https://addons.test/lepak/manifest.json')).status).toBe(404);
    const withKeys = setup({ PODCASTINDEX_KEY: 'k', PODCASTINDEX_SECRET: 's' }).app;
    const root = (await (await withKeys.request('https://addons.test/')).json()) as {
      addons: string[];
    };
    expect(root.addons).toContain('https://addons.test/lepak/manifest.json');
    const lepak = await withKeys.request('https://addons.test/lepak/manifest.json');
    expect(((await lepak.json()) as { id: string }).id).toBe('app.lelap.lepak');
  });

  it('reads settings from the environment', () => {
    expect(userAgent({})).toBe('Lelap/1');
    expect(podcastIndexCredentials({ PODCASTINDEX_KEY: 'k' })).toBeNull();
    expect(podcastIndexCredentials({ PODCASTINDEX_KEY: 'k', PODCASTINDEX_SECRET: ' s ' })).toEqual({
      key: 'k',
      secret: 's',
    });
  });
});
