import { CatalogResponse, catalogPath } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { addon, manifest } from '../src/addon';

const get = (path: string) => addon.fetch(new Request(`https://addon.test/${path}`));

describe('seasonal catalogs', () => {
  it('lists both seasons in the manifest', async () => {
    const response = await get('manifest.json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(manifest.catalogs.map((c) => c.name)).toEqual(['Christmas', 'Autumn']);
  });

  it('serves each season as LibriVox items', async () => {
    for (const catalog of manifest.catalogs) {
      const response = await get(catalogPath(catalog.type, catalog.id));
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
      const { metas } = CatalogResponse.parse(await response.json());
      expect(metas.length).toBeGreaterThan(3);
      for (const meta of metas) expect(meta.id).toMatch(/^librivox:\w+$/);
    }
  });

  it('answers nothing else', async () => {
    expect((await get('catalog/audiobook/summer.json')).status).toBe(404);
    expect((await get('meta/audiobook/librivox%3Agiftofmagi.json')).status).toBe(404);
  });
});
