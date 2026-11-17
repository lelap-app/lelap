import {
  CatalogResponse,
  MetaResponse,
  StreamResponse,
  hasParts,
  metaPath,
  streamPath,
} from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import app from '../src/index';

const get = (path: string, init?: RequestInit) => app.request(`https://addon.test/${path}`, init);
const json = async (path: string) => (await get(path)).json();

describe('template add-on', () => {
  it('serves its manifest with CORS, and sends the base URL to it', async () => {
    const response = await get('manifest.json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(((await response.json()) as { id: string }).id).toBe('org.example.template');
    const root = await get('');
    expect(root.status).toBe(302);
    expect(root.headers.get('Location')).toBe('/manifest.json');
  });

  it('serves its catalog, meta and both kinds of stream', async () => {
    const catalog = CatalogResponse.parse(await json('catalog/audiobook/books.json'));
    expect(catalog.metas.map((m) => m.id)).toEqual(['template:raven', 'template:christmas-carol']);

    const meta = MetaResponse.parse(await json(metaPath('audiobook', 'template:raven')));
    expect(meta.meta.name).toBe('The Raven');

    const raven = StreamResponse.parse(await json(streamPath('audiobook', 'template:raven')));
    expect(raven.streams[0] && hasParts(raven.streams[0])).toBe(false);
    const carol = StreamResponse.parse(
      await json(streamPath('audiobook', 'template:christmas-carol')),
    );
    const [stream] = carol.streams;
    expect(stream && hasParts(stream) ? stream.parts : []).toHaveLength(5);
  });

  it('answers 404 for unknown items and an empty list for unknown streams', async () => {
    expect((await get(metaPath('audiobook', 'template:nope'))).status).toBe(404);
    expect(await json(streamPath('audiobook', 'template:nope'))).toEqual({
      streams: [],
      cacheMaxAge: 86400,
    });
  });

  it('answers preflights', async () => {
    const response = await get('manifest.json', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('template add-on settings', () => {
  it('serves a configure page and sorts by the chosen order', async () => {
    const page = await get('configure');
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(await page.text()).toContain('Sort books by');

    const saved = await get('configure', {
      method: 'POST',
      body: new URLSearchParams({ order: 'Year', return: 'lelap://addon' }),
    });
    expect(saved.status).toBe(303);
    const manifestUrl = decodeURIComponent(
      saved.headers.get('Location')?.split('manifest=')[1] ?? '',
    );
    const base = manifestUrl.replace('https://addon.test/', '').replace('manifest.json', '');
    const catalog = CatalogResponse.parse(await json(`${base}catalog/audiobook/books.json`));
    expect(catalog.metas.map((m) => m.year)).toEqual([1843, 1845]);
  });

  it('answers /health', async () => {
    expect(await json('health')).toEqual({ status: 'ok' });
  });
});
