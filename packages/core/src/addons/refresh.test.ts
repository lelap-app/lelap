import type { Manifest, Stream } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import type { Fetcher, InstalledAddon } from './client';
import { findSources, mergeSources, refreshSources } from './sources';
import { knownTotal } from './streamed';

const manifest: Manifest = {
  id: 'org.example.archive',
  version: '1.0.0',
  protocol: 1,
  name: 'Archive',
  description: '',
  types: ['audiobook'],
  resources: ['stream'],
  idPrefixes: ['ol:'],
  catalogs: [],
};
const archive: InstalledAddon = {
  id: 'archive',
  url: 'https://archive.example/manifest.json',
  builtin: false,
  manifest,
};

const stream = (sourceKey: string): Stream => ({
  sourceKey,
  name: 'Archive',
  url: `https://audio.example/${sourceKey}.mp3`,
});

describe('refreshAfter (M152)', () => {
  it('asks once more past every cache and adds new streams below the ones shown', async () => {
    const calls: { url: string; cache?: string }[] = [];
    let second = false;
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, ...(init.cache ? { cache: init.cache } : {}) });
      const body = second
        ? { streams: [stream('b'), stream('a'), stream('c')] }
        : { streams: [stream('a'), stream('b')], refreshAfter: 5 };
      second = true;
      return { ok: true, status: 200, json: async () => body };
    };
    const first = await findSources(fetcher, [archive], 'audiobook', 'ol:OL1W');
    expect(first.refresh).toEqual([{ addon: archive, id: 'ol:OL1W', after: 5 }]);
    const more = await refreshSources(fetcher, 'audiobook', first);
    expect(more.found.map((f) => f.stream.sourceKey)).toEqual(['a', 'b', 'c']);
    expect(more.refresh).toEqual([]);
    expect(calls[1]?.cache).toBe('no-store');
    expect(calls[0]?.cache).toBeUndefined();
  });

  it('keeps what it had when the second look fails', async () => {
    let n = 0;
    const fetcher: Fetcher = async () => {
      n += 1;
      if (n > 1) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ streams: [stream('a')], refreshAfter: 3 }),
      };
    };
    const first = await findSources(fetcher, [archive], 'audiobook', 'ol:OL1W');
    const more = await refreshSources(fetcher, 'audiobook', first);
    expect(more.found.map((f) => f.stream.sourceKey)).toEqual(['a']);
  });
});

describe('mergeSources', () => {
  it('lets a stream shown already take the newer answer, in its place', async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        streams: [{ ...stream('a'), availability: 'preparing' }],
        refreshAfter: 5,
      }),
    });
    const first = await findSources(fetcher, [archive], 'audiobook', 'ol:OL1W');
    const ready = mergeSources(first, [{ addon: archive, stream: stream('a') }]);
    expect(ready.found).toHaveLength(1);
    expect(ready.found[0]?.stream.availability).toBeUndefined();
  });
});

describe('knownTotal', () => {
  it('gives a total only once every part has a length', () => {
    expect(knownTotal([1000, 2000])).toBe(3000);
    expect(knownTotal([1000, 0, 2000])).toBe(0);
  });
});
