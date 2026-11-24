import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import type { Fetcher, InstalledAddon } from './client';
import type { Poster } from '../scrobble';
import {
  type AddonHealth,
  checkHealth,
  HealthTracker,
  healthState,
  MAX_HEALTH_ENTRIES,
  parseAddonLink,
  parseHealth,
  requestAddonBase,
  trackedFetcher,
  trackedPoster,
} from './health';

const manifest: Manifest = {
  id: 'org.example.a',
  version: '1.0.0',
  protocol: 1,
  name: 'A',
  description: '',
  types: ['audiobook'],
  resources: ['catalog'],
  catalogs: [],
};
const addon: InstalledAddon = {
  id: '1',
  url: 'https://a.example/e1.tok/manifest.json',
  manifest,
  builtin: false,
};
const BASE = 'https://a.example/e1.tok/';

const answer =
  (status: number, body: unknown = {}): Fetcher =>
  async () => ({ ok: status < 400, status, json: async () => body });
const init = () => ({ signal: new AbortController().signal, headers: {} });

describe('requestAddonBase', () => {
  it('finds the base of every resource', () => {
    expect(requestAddonBase(`${BASE}manifest.json`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}manifest.json?x=1`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}health`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}catalog/audiobook/top.json`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}catalog/audiobook/top/search=a%2Fb.json`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}meta/podcast/podcast%3Aabc.json`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}stream/audiobook/ol%3AOL1W.json`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}artwork/audiobook/ol%3AOL1W.json`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}series/audiobook/Dune/language=en.json`)).toBe(BASE);
    expect(requestAddonBase(`${BASE}scrobble`)).toBe(BASE);
    expect(requestAddonBase('lelap-local://abc/scrobble')).toBe('lelap-local://abc/');
  });

  it('ignores other URLs', () => {
    expect(requestAddonBase('https://feeds.example/show.rss')).toBeNull();
    expect(requestAddonBase('https://a.example/data/thing.json')).toBeNull();
  });
});

describe('HealthTracker', () => {
  it('records latency and errors from real requests', async () => {
    const tracker = new HealthTracker();
    let clock = 100;
    const now = () => clock;
    const slow: Fetcher = async () => {
      clock += 4_000;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await trackedFetcher(answer(200), tracker, now)(`${BASE}catalog/audiobook/top.json`, init());
    expect(tracker.get(addon.url)).toMatchObject({ lastOkAt: 100, lastLatencyMs: 0 });
    expect(healthState(tracker.get(addon.url))).toBe('ok');

    await trackedFetcher(slow, tracker, now)(`${BASE}meta/audiobook/x%3A1.json`, init());
    expect(healthState(tracker.get(addon.url))).toBe('slow');

    clock = 5_000;
    await trackedFetcher(answer(503), tracker, now)(`${BASE}stream/audiobook/x%3A1.json`, init());
    expect(tracker.get(addon.url).lastError).toEqual({
      message: 'The add-on answered 503',
      status: 503,
      at: 5_000,
    });
    expect(healthState(tracker.get(addon.url))).toBe('failing');
  });

  it('counts a 404 for an unknown ID as an answer', async () => {
    const tracker = new HealthTracker();
    await trackedFetcher(answer(404), tracker, () => 1)(`${BASE}meta/audiobook/x%3A1.json`, init());
    expect(tracker.get(addon.url).lastError).toBeNull();
    expect(healthState(tracker.get(addon.url))).toBe('ok');
  });

  it('records network failures and rethrows them', async () => {
    const tracker = new HealthTracker();
    const failing: Fetcher = async () => {
      throw new TypeError('Network request failed');
    };
    await expect(
      trackedFetcher(failing, tracker, () => 7)(`${BASE}manifest.json`, init()),
    ).rejects.toThrow('Network request failed');
    expect(tracker.get(addon.url).lastError?.message).toBe('The add-on could not be reached');
  });

  it('tells subscribers', async () => {
    const tracker = new HealthTracker();
    let calls = 0;
    const stop = tracker.subscribe(() => (calls += 1));
    await trackedFetcher(answer(200), tracker, () => 1)(`${BASE}health`, init());
    stop();
    await trackedFetcher(answer(200), tracker, () => 2)(`${BASE}health`, init());
    expect(calls).toBe(1);
    expect(tracker.getVersion()).toBe(2);
  });
});

describe('scrobble posts (M159)', () => {
  const post =
    (status: number): Poster =>
    async () => ({ ok: status < 400, status });
  const body = () => ({
    method: 'POST' as const,
    headers: {},
    body: '{}',
    signal: new AbortController().signal,
  });

  it('counts a delivered post as an answer and a refused one as an error', async () => {
    const tracker = new HealthTracker();
    await trackedPoster(post(202), tracker, () => 4)(`${BASE}scrobble`, body());
    expect(tracker.get(addon.url)).toMatchObject({ lastOkAt: 4, lastError: null });
    await trackedPoster(post(500), tracker, () => 9)(`${BASE}scrobble`, body());
    expect(tracker.get(addon.url).lastError).toEqual({
      message: 'The add-on answered 500',
      status: 500,
      at: 9,
    });
  });

  it('counts a post that could not go out', async () => {
    const tracker = new HealthTracker();
    const offline: Poster = async () => {
      throw new TypeError('Network request failed');
    };
    await expect(
      trackedPoster(offline, tracker, () => 2)(`${BASE}scrobble`, body()),
    ).rejects.toThrow();
    expect(tracker.get(addon.url).lastError?.message).toBe('The add-on could not be reached');
  });
});

describe('kept health (M159)', () => {
  const seen: AddonHealth = {
    lastOkAt: 10,
    lastLatencyMs: 300,
    lastError: { message: 'The add-on answered 503', status: 503, at: 5 },
    reported: { status: 'degraded', message: null, at: 8 },
  };

  it('reads what an earlier start kept and writes each change', async () => {
    const written: Record<string, AddonHealth>[] = [];
    const tracker = new HealthTracker();
    tracker.attach({ read: () => ({ [BASE]: seen }), write: (all) => written.push(all) });
    expect(tracker.get(addon.url)).toEqual(seen);
    await trackedFetcher(answer(200), tracker, () => 20)(`${BASE}meta/audiobook/x.json`, init());
    expect(written.at(-1)?.[BASE]).toEqual({ ...seen, lastOkAt: 20, lastLatencyMs: 0 });
  });

  it('keeps what this run saw over what was kept, and reads again after a failed read', async () => {
    const tracker = new HealthTracker();
    let ready = false;
    const written: Record<string, AddonHealth>[] = [];
    tracker.attach({
      read: () => {
        if (!ready) throw new Error('database still opening');
        return { [BASE]: seen, 'https://b.example/': seen };
      },
      write: (all) => written.push(all),
    });
    await trackedFetcher(answer(200), tracker, () => 30)(`${BASE}health`, init());
    // Nothing written over the kept health before it was read.
    expect(written).toEqual([]);
    ready = true;
    expect(tracker.get(addon.url).lastOkAt).toBe(30);
    expect(tracker.get('https://b.example/manifest.json')).toEqual(seen);
    await trackedFetcher(answer(200), tracker, () => 31)(`${BASE}health`, init());
    expect(Object.keys(written.at(-1) ?? {})).toEqual(['https://b.example/', BASE]);
  });

  it('keeps at most MAX_HEALTH_ENTRIES add-ons', async () => {
    const tracker = new HealthTracker();
    let kept: Record<string, AddonHealth> = {};
    tracker.attach({ read: () => ({}), write: (all) => (kept = all) });
    for (let i = 0; i <= MAX_HEALTH_ENTRIES; i++)
      await trackedFetcher(answer(200), tracker, () => i)(`https://x${i}.example/health`, init());
    expect(Object.keys(kept)).toHaveLength(MAX_HEALTH_ENTRIES);
    expect(kept['https://x0.example/']).toBeUndefined();
  });

  it('parses kept JSON and drops what isn’t health', () => {
    expect(parseHealth(JSON.stringify({ [BASE]: seen }))).toEqual({ [BASE]: seen });
    expect(parseHealth(null)).toEqual({});
    expect(parseHealth('not json')).toEqual({});
    expect(parseHealth('[]')).toEqual({});
    expect(
      parseHealth(
        JSON.stringify({
          [BASE]: { lastOkAt: 'x', reported: { status: 'great', at: 1 }, lastError: { at: 1 } },
          other: 3,
        }),
      ),
    ).toEqual({ [BASE]: { lastOkAt: null, lastLatencyMs: null, lastError: null, reported: null } });
  });
});

describe('checkHealth', () => {
  it('keeps what the add-on reports', async () => {
    const tracker = new HealthTracker();
    const result = await checkHealth(
      answer(200, { status: 'degraded', message: 'Search is slow' }),
      addon,
      tracker,
      () => 3,
    );
    expect(result).toEqual({ status: 'degraded', message: 'Search is slow' });
    expect(tracker.get(addon.url).reported).toEqual({
      status: 'degraded',
      message: 'Search is slow',
      at: 3,
    });
    expect(healthState(tracker.get(addon.url))).toBe('degraded');
  });

  it('marks a down add-on as failing and ignores bad answers', async () => {
    const tracker = new HealthTracker();
    await checkHealth(answer(200, { status: 'down' }), addon, tracker, () => 3);
    expect(healthState(tracker.get(addon.url))).toBe('failing');
    expect(await checkHealth(answer(200, { status: 'great' }), addon, tracker)).toBeNull();
    expect(await checkHealth(answer(404), addon, tracker)).toBeNull();
  });
});

describe('parseAddonLink', () => {
  const url = 'https://a.example/e1.tok/manifest.json';
  it('reads the app link and the web app link', () => {
    expect(parseAddonLink(`lelap://addon?manifest=${encodeURIComponent(url)}`)).toBe(url);
    expect(parseAddonLink(`lelap://addon/?manifest=${encodeURIComponent(url)}`)).toBe(url);
    expect(
      parseAddonLink(`https://listen.example.org/addon?x=1&manifest=${encodeURIComponent(url)}`),
    ).toBe(url);
  });

  it('adds manifest.json to a bare base', () => {
    expect(
      parseAddonLink(`lelap://addon?manifest=${encodeURIComponent('https://a.example/e1.tok/')}`),
    ).toBe(url);
  });

  it('refuses links without a web address', () => {
    expect(parseAddonLink('lelap://addon')).toBeNull();
    expect(parseAddonLink('lelap://addon?manifest=')).toBeNull();
    expect(parseAddonLink('lelap://addon?manifest=word')).toBeNull();
    expect(parseAddonLink('lelap://addon?manifest=javascript%3Aalert(1)')).toBeNull();
    expect(parseAddonLink('lelap://addon?manifest=%E0%A4%A')).toBeNull();
    expect(parseAddonLink('lelap://player?manifest=https%3A%2F%2Fa.example')).toBeNull();
    expect(parseAddonLink(url)).toBeNull();
  });
});
