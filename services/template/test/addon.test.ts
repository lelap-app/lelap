import { describe, expect, it } from 'vitest';

import app from '../src/index';

const get = async (path: string) => {
  const response = await app.request(`https://addon.test/${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe('template add-on', () => {
  it('serves its manifest, catalog, meta and streams', async () => {
    expect((await get('manifest.json')).body.id).toBe('org.example.template');
    const catalog = await get('catalog/audiobook/books.json');
    expect((catalog.body.metas as { id: string }[]).map((m) => m.id)).toEqual([
      'template:raven',
      'template:christmas-carol',
    ]);
    const meta = await get('meta/audiobook/template%3Araven.json');
    expect((meta.body.meta as { name: string }).name).toBe('The Raven');
    const streams = await get('stream/audiobook/template%3Achristmas-carol.json');
    expect((streams.body.streams as { parts: unknown[] }[])[0]?.parts).toHaveLength(5);
  });

  it('answers 404 for unknown items', async () => {
    expect((await get('meta/audiobook/template%3Anope.json')).status).toBe(404);
  });
});
