import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CatalogResponse,
  Manifest,
  MetaPreview,
  MetaResponse,
  StreamResponse,
  catalogPath,
  metaPath,
  streamPath,
} from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

// The docs show the samples in `examples/`; their own tests check behaviour without the SDK, so
// this one checks that what they answer matches the protocol.
type Answer = { status: number; body: unknown };
const examples = new URL('../../../examples/', import.meta.url);

describe('the plain Node sample', async () => {
  const { route, manifest } = (await import(new URL('node-addon/addon.mjs', examples).href)) as {
    route: (path: string) => Answer;
    manifest: unknown;
  };
  const get = (path: string) => route(`/${path}`).body;

  it('answers within the protocol', () => {
    const parsed = Manifest.parse(manifest);
    for (const catalog of parsed.catalogs) {
      const { metas } = CatalogResponse.parse(get(catalogPath(catalog.type, catalog.id)));
      expect(metas.length).toBeGreaterThan(0);
      for (const { type, id } of metas) {
        expect(MetaResponse.parse(get(metaPath(type, id))).meta.id).toBe(id);
        expect(StreamResponse.parse(get(streamPath(type, id))).streams.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the seasonal catalogs', () => {
  it('are MetaPreviews with librivox: IDs', () => {
    const data = JSON.parse(
      readFileSync(new URL('seasonal-catalogs/src/catalogs.json', examples), 'utf8'),
    ) as { catalogs: { metas: unknown[] }[] };
    for (const catalog of data.catalogs)
      for (const meta of catalog.metas) expect(MetaPreview.parse(meta).id).toMatch(/^librivox:/);
  });
});

describe('the Python sample', () => {
  // Runs the sample's pure `route()` for a batch of paths and returns the bodies.
  const route = (paths: string[]) =>
    JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import json, sys; import addon; print(json.dumps([addon.route(p)[1] for p in sys.argv[1:]]))',
          ...paths.map((path) => `/${path}`),
        ],
        { cwd: fileURLToPath(new URL('python-addon/', examples)), encoding: 'utf8' },
      ),
    ) as unknown[];

  it('answers within the protocol', () => {
    const [manifest] = route(['manifest.json']);
    const parsed = Manifest.parse(manifest);
    const catalogs = route(parsed.catalogs.map((c) => catalogPath(c.type, c.id)));
    const items = catalogs.flatMap((body) => CatalogResponse.parse(body).metas);
    expect(items.length).toBeGreaterThan(0);
    const metas = route(items.map((item) => metaPath(item.type, item.id)));
    const streams = route(items.map((item) => streamPath(item.type, item.id)));
    items.forEach((item, index) => {
      expect(MetaResponse.parse(metas[index]).meta.id).toBe(item.id);
      expect(StreamResponse.parse(streams[index]).streams.length).toBeGreaterThan(0);
    });
  });
});
