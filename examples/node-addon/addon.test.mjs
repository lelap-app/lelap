import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createAddonServer, manifest, route } from './addon.mjs';

let base;
const server = createAddonServer();

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (path) => {
  const response = await fetch(`${base}${path}`);
  return { response, body: await response.json() };
};

test('serves the manifest with CORS', async () => {
  const { response, body } = await get('/manifest.json');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(body, manifest);
});

test('serves the catalog, and pages with skip', async () => {
  const { body } = await get('/catalog/audiobook/classics.json');
  assert.deepEqual(
    body.metas.map((m) => m.id),
    ['example:raven', 'example:christmas-carol'],
  );
  const next = await get('/catalog/audiobook/classics/skip=50.json');
  assert.deepEqual(next.body.metas, []);
  assert.equal((await get('/catalog/audiobook/classics/skip=-1.json')).response.status, 400);
});

test('serves meta for a percent-encoded ID', async () => {
  const { response, body } = await get('/meta/audiobook/example%3Araven.json');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(body.meta.name, 'The Raven');
});

test('serves a single-file stream and a stream with parts', async () => {
  const raven = await get('/stream/audiobook/example%3Araven.json');
  assert.match(raven.body.streams[0].url, /^https:\/\//);
  const carol = await get('/stream/audiobook/example%3Achristmas-carol.json');
  assert.equal(carol.body.streams[0].parts.length, 5);
  for (const part of carol.body.streams[0].parts) assert.ok(Number.isInteger(part.durationMs));
});

test('answers unknown things with JSON errors', async () => {
  for (const path of [
    '/meta/audiobook/example%3Anope.json',
    '/catalog/audiobook/nope.json',
    '/meta/podcast/example%3Araven.json',
    '/nope',
  ]) {
    const { response, body } = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(typeof body.error, 'string');
  }
  assert.deepEqual(route('/stream/audiobook/example%3Anope.json').body.streams, []);
});

test('answers preflights and refuses other methods', async () => {
  const preflight = await fetch(`${base}/manifest.json`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const post = await fetch(`${base}/manifest.json`, { method: 'POST' });
  assert.equal(post.status, 405);
});
