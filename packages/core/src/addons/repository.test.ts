import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import type { Fetcher } from './client';
import { installAddon, listAddons, removeAddon, syncAddons } from './repository';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

const manifest = (id: string, version = '1.0.0'): Manifest => ({
  id: `org.example.${id}`,
  version,
  protocol: 1,
  name: id,
  description: '',
  types: ['audiobook'],
  resources: ['catalog'],
  catalogs: [],
});

const A = 'https://a.example/manifest.json';
const B = 'https://b.example/librivox/manifest.json';
const MINE = 'https://mine.example/manifest.json';

function serve(manifests: Record<string, Manifest>): Fetcher {
  return async (url) => {
    const body = manifests[url];
    return body
      ? { ok: true, status: 200, json: async () => body }
      : { ok: false, status: 404, json: async () => ({}) };
  };
}

describe('add-ons', () => {
  it('installs the defaults in order, then keeps the user order', async () => {
    const db = createTestDb();
    const failed = await syncAddons(
      db,
      serve({ [A]: manifest('a'), [B]: manifest('b') }),
      [A, B],
      1,
      newId,
    );
    expect(failed).toEqual([]);
    installAddon(db, { url: MINE, manifest: manifest('mine'), now: 2, newId });
    expect(listAddons(db).map((a) => [a.manifest.name, a.builtin])).toEqual([
      ['a', true],
      ['b', true],
      ['mine', false],
    ]);
  });

  it('does not reinstall a default the user removed, until they add it again', async () => {
    const db = createTestDb();
    const fetcher = serve({ [A]: manifest('a'), [B]: manifest('b') });
    await syncAddons(db, fetcher, [A, B], 1, newId);
    removeAddon(db, A, 2);
    await syncAddons(db, fetcher, [A, B], 3, newId);
    expect(listAddons(db).map((a) => a.manifest.name)).toEqual(['b']);

    installAddon(db, { url: A, manifest: manifest('a'), now: 4, newId });
    removeAddon(db, MINE, 5);
    await syncAddons(db, fetcher, [A, B], 6, newId);
    expect(listAddons(db).map((a) => a.manifest.name)).toEqual(['b', 'a']);
  });

  it('refreshes manifests and keeps the stored one when an add-on is unreachable', async () => {
    const db = createTestDb();
    await syncAddons(db, serve({ [A]: manifest('a'), [B]: manifest('b') }), [A, B], 1, newId);
    const failed = await syncAddons(db, serve({ [A]: manifest('a', '2.0.0') }), [A, B], 2, newId);
    expect(failed).toEqual([B]);
    expect(listAddons(db).map((a) => [a.manifest.name, a.manifest.version])).toEqual([
      ['a', '2.0.0'],
      ['b', '1.0.0'],
    ]);
  });

  it('skips a default that cannot be reached on first start and tries again later', async () => {
    const db = createTestDb();
    expect(await syncAddons(db, serve({}), [A], 1, newId)).toEqual([A]);
    expect(listAddons(db)).toEqual([]);
    await syncAddons(db, serve({ [A]: manifest('a') }), [A], 2, newId);
    expect(listAddons(db).map((a) => a.manifest.name)).toEqual(['a']);
  });
});
