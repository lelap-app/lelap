import { describe, expect, it } from 'vitest';

import type { CheckResult } from '../src/check';
import { createStore, KEEP_HOURS, uptime } from '../src/store';
import { memorySql } from './sql';

const HOUR = 60 * 60_000;
const T0 = 1_000 * HOUR;
const result = (name: string, up: boolean): CheckResult => ({
  name,
  url: `https://${name.toLowerCase()}.example.org/health`,
  up,
  status: up ? 200 : 503,
  ms: 10,
  error: up ? null : 'HTTP 503',
});

describe('uptime', () => {
  it('is the share of checks that answered, or null without checks', () => {
    expect(uptime([])).toBeNull();
    expect(uptime([{ start: 0, checks: 0, ups: 0 }])).toBeNull();
    expect(
      uptime([
        { start: 0, checks: 12, ups: 12 },
        { start: HOUR, checks: 12, ups: 6 },
      ]),
    ).toBe(0.75);
  });
});

describe('store', () => {
  it('reports state changes, but not the first result', () => {
    const store = createStore(memorySql());
    expect(store.record([result('Proxy', true)], T0)).toEqual([]);
    expect(store.record([result('Proxy', true)], T0 + 5 * 60_000)).toEqual([]);
    const down = store.record([result('Proxy', false)], T0 + 10 * 60_000);
    expect(down).toEqual([
      expect.objectContaining({
        name: 'Proxy',
        up: false,
        error: 'HTTP 503',
        lastedMs: 10 * 60_000,
      }),
    ]);
    expect(store.record([result('Proxy', false)], T0 + 15 * 60_000)).toEqual([]);
    const up = store.record([result('Proxy', true)], T0 + 25 * 60_000);
    expect(up).toEqual([expect.objectContaining({ up: true, lastedMs: 15 * 60_000 })]);
  });

  it('keeps uptime per hour, the last failure and when the state began', () => {
    const store = createStore(memorySql());
    store.record([result('Sync', true)], T0);
    store.record([result('Sync', false)], T0 + 60_000);
    store.record([result('Sync', true)], T0 + HOUR);
    store.record([result('Sync', true)], T0 + HOUR + 60_000);
    const [sync] = store.snapshot()?.targets ?? [];
    expect(sync).toMatchObject({ up: true, since: T0 + HOUR, uptime24h: 0.75, uptime7d: 0.75 });
    expect(sync?.lastFailure).toEqual({ at: T0 + 60_000, status: 503, error: 'HTTP 503' });
    expect(sync?.hours).toHaveLength(24);
    expect(sync?.hours.slice(-2)).toEqual([
      { start: T0, checks: 2, ups: 1 },
      { start: T0 + HOUR, checks: 2, ups: 2 },
    ]);
    expect(sync?.hours[0]?.checks).toBe(0);
  });

  it('prunes results older than 7 days and targets no longer configured', () => {
    const sql = memorySql();
    const store = createStore(sql);
    store.record([result('Proxy', false), result('Old', true)], T0);
    store.record([result('Proxy', true)], T0 + KEEP_HOURS * HOUR);
    const hours = sql('SELECT target, hour FROM hours ORDER BY hour');
    expect(hours).toEqual([{ target: 'Proxy', hour: T0 / HOUR + KEEP_HOURS }]);
    expect(sql('SELECT name FROM targets')).toEqual([{ name: 'Proxy' }]);
    const [proxy] = store.snapshot()?.targets ?? [];
    expect(proxy?.uptime7d).toBe(1);
    expect(store.snapshot()?.targets.map((t) => t.name)).toEqual(['Proxy']);
  });

  it('has no snapshot before the first run', () => {
    expect(createStore(memorySql()).snapshot()).toBeNull();
  });
});
