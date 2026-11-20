import { checkAddon, mockFetch } from '@lelap/sdk/check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSourceAddon, manifest } from './addon.mjs';
import { createAddonServer } from './server.mjs';

// Open Library as the add-on sees it for A Christmas Carol; nothing else is known. Any request
// to another host fails, so the tests never reach a real service.
const openLibrary = mockFetch({
  'https://ol.test/works/OL1W.json': {
    title: 'A Christmas Carol',
    authors: [{ author: { key: '/authors/OL2A' } }],
  },
  'https://ol.test/authors/OL2A.json': { name: 'Charles Dickens' },
  'https://ol.test/works/OL1W/editions.json*': { entries: [] },
  'https://ol.test/*': () => new Response('{}', { status: 404 }),
});

const addon = createSourceAddon({ fetch: openLibrary, openLibrary: 'https://ol.test' });
const streams = async (id) => {
  const response = await addon.fetch(
    new Request(`https://addon.test/stream/audiobook/${encodeURIComponent(id)}.json`),
  );
  expect(response.status).toBe(200);
  return (await response.json()).streams;
};

describe('source add-on', () => {
  it('declares the work IDs its stream resource takes', async () => {
    const response = await addon.fetch(new Request('https://addon.test/manifest.json'));
    const body = await response.json();
    expect(body.resources).toEqual([
      { name: 'stream', types: ['audiobook'], idPrefixes: ['ol:', 'isbn:', 'asin:'] },
    ]);
    expect(body.id).toBe(manifest.id);
  });

  it('answers an ISBN from the tags without asking anyone', async () => {
    const found = await streams('isbn:9780000000002');
    expect(found.map((s) => s.title)).toEqual(['The Raven']);
    expect(openLibrary.calls).toHaveLength(0);
  });

  it('answers a Catalog work page by title and author', async () => {
    const found = await streams('ol:OL1W');
    expect(found.map((s) => s.title)).toEqual(['A Christmas Carol (Unabridged)']);
    expect(found[0].parts).toHaveLength(5);
    expect(openLibrary.unmatched).toEqual([]);
  });

  it('has nothing for works it does not have', async () => {
    expect(await streams('ol:OL9W')).toEqual([]);
    expect(await streams('asin:B002UZMLXM')).toEqual([]);
  });
});

describe('the node:http server', () => {
  let base;
  const server = createAddonServer(addon);

  beforeAll(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server.close());

  it('serves the add-on with CORS', async () => {
    const response = await fetch(`${base}/stream/audiobook/isbn%3A9780000000002.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect((await response.json()).streams).toHaveLength(1);
  });

  it('passes the add-on test kit over HTTP', async () => {
    const report = await checkAddon(base, {
      ids: [
        { type: 'audiobook', id: 'isbn:9780000000002' },
        { type: 'audiobook', id: 'ol:OL1W' },
      ],
    });
    expect(report.problems).toEqual([]);
  });
});
