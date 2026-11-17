import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import type { Fetcher, InstalledAddon } from './client';
import {
  checkHealth,
  HealthTracker,
  healthState,
  parseAddonLink,
  requestAddonBase,
  trackedFetcher,
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
