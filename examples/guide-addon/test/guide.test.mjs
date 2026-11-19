// Runs every step of the developer guide (/docs/guide/) the way the page tells readers to.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CatalogResponse, Manifest, MetaResponse, PAGE_STYLE, StreamResponse } from '@lelap/sdk';
import { checkAddon } from '@lelap/sdk/check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addon as catalogAddon } from '../catalog.mjs';
import { ownPage } from '../page.mjs';
import { serve } from '../server.mjs';
import { addon as settingsAddon } from '../settings.mjs';
import { createSourceAddon, scanFolder } from '../source.mjs';
import worker from '../worker.mjs';

const get = async (addon, path) => {
  const response = await addon.fetch(new Request(`https://addon.test${path}`));
  return { status: response.status, body: await response.json() };
};

// The add-on test kit, as the guide tells readers to run it, but without a server.
const check = (addon, options = {}) =>
  checkAddon('https://addon.test/', {
    fetch: (url, init) => addon.fetch(new Request(url, init)),
    ...options,
  });

describe('step 1: a catalog', () => {
  it('serves a valid manifest and a catalog without descriptions', async () => {
    Manifest.parse((await get(catalogAddon, '/manifest.json')).body);
    const { body } = await get(catalogAddon, '/catalog/audiobook/classics.json');
    const { metas } = CatalogResponse.parse(body);
    expect(metas.map((m) => m.name)).toEqual(['The Raven', 'A Christmas Carol']);
    expect(body.metas[0]).not.toHaveProperty('description');
  });

  it('serves details and streams by ID', async () => {
    const meta = await get(catalogAddon, '/meta/audiobook/classics%3Araven.json');
    expect(MetaResponse.parse(meta.body).meta.description).toMatch(/raven/);
    const { body } = await get(catalogAddon, '/stream/audiobook/classics%3Achristmas-carol.json');
    expect(StreamResponse.parse(body).streams[0].parts).toHaveLength(5);
    expect((await get(catalogAddon, '/meta/audiobook/classics%3Anope.json')).status).toBe(404);
  });

  it('passes the add-on test kit', async () => {
    const report = await check(catalogAddon);
    expect(report.problems).toEqual([]);
  });
});

describe('step 2: settings', () => {
  it('says it can be configured', async () => {
    const { body } = await get(settingsAddon, '/manifest.json');
    expect(body.behaviorHints).toMatchObject({ configurable: true });
  });

  it('serves the form in the shared style, naming who runs it', async () => {
    const response = await settingsAddon.fetch(new Request('https://addon.test/configure'));
    const html = await response.text();
    expect(html).toContain(PAGE_STYLE);
    expect(html).toContain('This page is run by addon.test, not by Lelap.');
    expect(html).toContain('Only books under an hour');
  });

  it('puts the choice into the URL and filters the catalog by it', async () => {
    const response = await settingsAddon.fetch(
      new Request('https://addon.test/configure', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'order=Year&short=on',
      }),
    );
    const manifestUrl = (await response.text()).match(
      /https:\/\/addon\.test\/([^/]+)\/manifest\.json/,
    );
    expect(manifestUrl).not.toBeNull();
    const token = manifestUrl[1];
    const { body } = await get(settingsAddon, `/${token}/catalog/audiobook/classics.json`);
    expect(body.metas.map((m) => m.name)).toEqual(['The Raven']);
    // Without settings: every book, by title.
    const all = await get(settingsAddon, '/catalog/audiobook/classics.json');
    expect(all.body.metas.map((m) => m.name)).toEqual(['A Christmas Carol', 'The Raven']);
  });

  it('runs on Workers through the same fetch', async () => {
    const response = await worker.fetch(new Request('https://addon.test/manifest.json'));
    expect(response.status).toBe(200);
  });
});

describe('step 2 and the test kit', () => {
  it('passes, with the configure page in the shared style', async () => {
    const report = await check(settingsAddon);
    expect(report.problems).toEqual([]);
  });
});

describe('pages of your own', () => {
  it('use the shared style and name who runs them', () => {
    const html = ownPage({ title: 'Help', body: '<p>Ask us.</p>', host: 'addon.example.org' });
    expect(html).toContain(PAGE_STYLE);
    expect(html).toContain(
      '<p class="sender">This page is run by addon.example.org, not by Lelap.</p>',
    );
    expect(ownPage({ title: '<b>', body: '', host: 'a"b' })).toContain('&#60;b&#62;');
  });
});

describe('step 3: a source for your own files', () => {
  let folder;
  let addon;

  const json = (body) => new Response(JSON.stringify(body), { status: 200 });
  // Open Library as the add-on sees it for A Christmas Carol; nothing else is known.
  const openLibrary = vi.fn(async (url) => {
    if (url.endsWith('/works/OL1W.json')) {
      return json({ title: 'A Christmas Carol', authors: [{ author: { key: '/authors/OL2A' } }] });
    }
    if (url.endsWith('/authors/OL2A.json')) return json({ name: 'Charles Dickens' });
    if (url.includes('/works/OL1W/editions.json')) return json({ entries: [] });
    return new Response('{}', { status: 404 });
  });

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'lelap-guide-'));
    await mkdir(join(folder, 'Charles Dickens'));
    await writeFile(join(folder, 'Charles Dickens', 'A Christmas Carol.m4b'), '');
    await writeFile(join(folder, 'Charles Dickens', 'cover.jpg'), '');
    await mkdir(join(folder, 'Edgar Allan Poe'));
    await writeFile(join(folder, 'Edgar Allan Poe', 'The Raven.mp3'), '');
    addon = await createSourceAddon({
      folder,
      filesUrl: 'https://files.example.org/audiobooks/',
      fetch: openLibrary,
      openLibrary: 'https://ol.test',
    });
  });
  afterAll(() => rm(folder, { recursive: true, force: true }));

  it('finds one book per audio file, by author folder and file name', async () => {
    const files = await scanFolder(folder);
    expect(files.map((f) => `${f.author} / ${f.title}`).sort()).toEqual([
      'Charles Dickens / A Christmas Carol',
      'Edgar Allan Poe / The Raven',
    ]);
  });

  it('declares the work IDs its streams take', async () => {
    const { body } = await get(addon, '/manifest.json');
    Manifest.parse(body);
    expect(body.resources).toContainEqual({
      name: 'stream',
      types: ['audiobook'],
      idPrefixes: ['classics:', 'ol:', 'isbn:'],
    });
  });

  it('answers a work page from another add-on with the matching file', async () => {
    const { body } = await get(addon, '/stream/audiobook/ol%3AOL1W.json');
    const { streams } = StreamResponse.parse(body);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({
      title: 'A Christmas Carol',
      url: 'https://files.example.org/audiobooks/Charles%20Dickens/A%20Christmas%20Carol.m4b',
      mime: 'audio/mp4',
    });
    expect(openLibrary.mock.calls.every(([url]) => url.startsWith('https://ol.test/'))).toBe(true);
  });

  it('has nothing for works it lacks, and keeps its own catalog', async () => {
    expect((await get(addon, '/stream/audiobook/ol%3AOL9W.json')).body.streams).toEqual([]);
    expect((await get(addon, '/stream/audiobook/isbn%3A9780141389509.json')).body.streams).toEqual(
      [],
    );
    const own = await get(addon, '/stream/audiobook/classics%3Araven.json');
    expect(own.body.streams[0].title).toBe('LibriVox recording');
  });

  it('passes the add-on test kit, with a work from another add-on', async () => {
    const report = await check(addon, { ids: [{ type: 'audiobook', id: 'ol:OL1W' }] });
    expect(report.problems).toEqual([]);
  });

  describe('served by node:http', () => {
    let base;
    let server;

    beforeAll(async () => {
      server = serve(addon);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => server.close());

    it('answers with CORS and takes the configure form', async () => {
      const manifest = await fetch(`${base}/manifest.json`);
      expect(manifest.headers.get('access-control-allow-origin')).toBe('*');
      const saved = await fetch(`${base}/configure`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'order=Title',
      });
      expect(saved.status).toBe(200);
      expect(await saved.text()).toContain('/manifest.json');
    });

    it('gives an https address behind a proxy that says so', async () => {
      const saved = await fetch(`${base}/configure`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-proto': 'https',
        },
        body: 'order=Title',
      });
      expect(await saved.text()).toMatch(/https:\/\/127\.0\.0\.1:\d+\/p1\.[^/]+\/manifest\.json/);
    });

    it('answers a request it cannot read with 400 and keeps running', async () => {
      const { request } = await import('node:http');
      const status = await new Promise((resolve, reject) => {
        const req = request(`${base}/manifest.json`, { headers: { host: 'a b' } }, (res) =>
          resolve(res.statusCode),
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(400);
      expect((await fetch(`${base}/manifest.json`)).status).toBe(200);
    });
  });
});
