import { describe, expect, it } from 'vitest';

import { createAddon } from './addon';
import { checkAddon } from './check';
import {
  LATEST_PROTOCOL_VERSION,
  type Manifest,
  RELEASE_ID,
  Stream,
  StreamResponse,
} from './protocol';

const manifest: Manifest = {
  id: 'org.example.prepare',
  version: '1.0.0',
  protocol: 1,
  name: 'Prepare',
  description: 'Tests',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['ia:'],
  catalogs: [{ type: 'audiobook', id: 'new', name: 'New' }],
};

describe('revision 14', () => {
  it('is known', () => {
    expect(LATEST_PROTOCOL_VERSION).toBeGreaterThanOrEqual(14);
  });

  it('reads a preparing stream with format, language and releaseId', () => {
    const stream = Stream.parse({
      sourceKey: 'ia:raven',
      name: 'Internet Archive',
      url: 'https://archive.org/download/raven/raven.m4b',
      availability: 'preparing',
      format: 'm4b',
      language: 'en',
      releaseId: 'urn:ia:raven',
    });
    expect(stream).toMatchObject({ availability: 'preparing', format: 'm4b', language: 'en' });
  });

  it('reads a live stream', () => {
    const stream = Stream.parse({
      sourceKey: 'radio',
      name: 'Radio',
      url: 'https://radio.example/live.mp3',
      live: true,
    });
    expect(stream.live).toBe(true);
  });

  it('counts an unknown availability as ready', () => {
    const stream = Stream.parse({
      sourceKey: 'a',
      name: 'A',
      url: 'https://example.org/a.mp3',
      availability: 'soon',
    });
    expect(stream.availability).toBeUndefined();
  });

  it('takes parts without durationMs and a refreshAfter', () => {
    const response = StreamResponse.parse({
      streams: [
        {
          sourceKey: 'lv:carol',
          name: 'LibriVox',
          parts: [{ url: 'https://example.org/1.mp3' }, { url: 'https://example.org/2.mp3' }],
        },
      ],
      refreshAfter: 10,
    });
    expect(response.refreshAfter).toBe(10);
    expect(response.streams[0]).toHaveProperty('parts');
  });

  it('knows a lowercase URN', () => {
    expect(RELEASE_ID.test('urn:ia:a_christmas_carol')).toBe(true);
    expect(RELEASE_ID.test('urn:isbn:9780141389509')).toBe(true);
    expect(RELEASE_ID.test('urn:IA:Raven')).toBe(false);
    expect(RELEASE_ID.test('ia:raven')).toBe(false);
    expect(RELEASE_ID.test('urn:ia:has space')).toBe(false);
  });

  it('lelap-sdk check warns of a long refreshAfter, an unknown format and a bad releaseId', async () => {
    const addon = createAddon(
      {
        manifest,
        catalog: () => ({
          metas: [{ id: 'ia:raven', type: 'audiobook', name: 'The Raven' }],
          cacheMaxAge: 60,
        }),
        meta: ({ id }) => ({ meta: { id, type: 'audiobook', name: 'The Raven' }, cacheMaxAge: 60 }),
        stream: () => ({
          streams: [
            {
              sourceKey: 'ia:raven',
              name: 'Internet Archive',
              url: 'https://archive.org/download/raven/raven.xyz',
              format: 'xyz',
              releaseId: 'IA:Raven',
            },
          ],
          refreshAfter: 120,
          cacheMaxAge: 60,
        }),
      },
      { validate: false },
    );
    const report = await checkAddon('https://addon.test/manifest.json', {
      fetch: (url, init) => addon.fetch(new Request(url, init)),
    });
    const lines = report.problems.map((p) => `${p.level} ${p.field ?? ''} ${p.message}`);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^warning refreshAfter refreshAfter is 120 seconds/),
        expect.stringMatching(/^warning streams\[0\]\.format The app doesn't know the format/),
        expect.stringMatching(
          /^warning streams\[0\]\.releaseId releaseId .* is not a lowercase URN/,
        ),
      ]),
    );
  });
});
