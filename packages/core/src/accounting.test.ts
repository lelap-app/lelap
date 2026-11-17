import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { mergeServiceAccounting, type ServiceAccounting } from './accounting';
import type { InstalledAddon } from './addons/client';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { scrobbleOutbox } from './schema';
import { listeningStats } from './stats';

const manifest: Manifest = {
  id: 'org.example.scrobbler',
  version: '1.0.0',
  protocol: 1,
  name: 'Scrobbler',
  description: '',
  types: ['audiobook', 'episode'],
  resources: ['scrobble'],
  catalogs: [],
};
const scrobbler: InstalledAddon = {
  id: 'a',
  url: 'https://scrobbler.example/sealed/manifest.json',
  manifest,
  builtin: false,
};

const MIN = 60_000;
const YEAR = [new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime()] as const;

function setup() {
  const db = createTestDb();
  const bookId = seedBook(db, 'Dune', [
    { location: 'dune/1.mp3', durationMs: 60 * MIN },
    { location: 'dune/2.mp3', durationMs: 60 * MIN },
  ]);
  const merge = (batch: ServiceAccounting, addons = [scrobbler]) =>
    mergeServiceAccounting(db, { profileId: ME, batch, addons, now: 1 });
  const todayMs = (day = '2026-11-17') => listeningStats(db, ME, day, ...YEAR).todayMs;
  const outbox = () => db.select().from(scrobbleOutbox).all();
  return { db, bookId, merge, todayMs, outbox };
}

const listen = (seq: number, bookId: string, ms: number, day = '2026-11-17') => ({
  seq,
  kind: 'listen' as const,
  bookId,
  title: 'Dune',
  day,
  ms,
});

describe('mergeServiceAccounting', () => {
  it('adds listening time and scrobble events at whole-book places', () => {
    const { bookId, merge, todayMs, outbox } = setup();
    const result = merge({
      epoch: 'e1',
      records: [
        {
          seq: 1,
          kind: 'start',
          bookId,
          at: 1_000,
          fileLocation: 'dune/2.mp3',
          filePositionMs: 0,
          startLocation: null,
          startPositionMs: null,
        },
        listen(2, bookId, 30 * MIN),
        {
          seq: 3,
          kind: 'pause',
          bookId,
          at: 1_800_000,
          fileLocation: 'dune/2.mp3',
          filePositionMs: 30 * MIN,
          startLocation: 'dune/2.mp3',
          startPositionMs: 0,
        },
      ],
    });
    expect(result).toEqual({ through: 3, listenedMs: 30 * MIN, scrobbles: 2 });
    expect(todayMs()).toBe(30 * MIN);
    const events = outbox()
      .map((r) => r.event)
      .sort((a, b) => a.at - b.at);
    expect(events.map((e) => [e.event, e.positionMs, e.sessionStartMs])).toEqual([
      ['start', 60 * MIN, undefined],
      ['pause', 90 * MIN, 60 * MIN],
    ]);
    expect(events[1]?.eventId).toBe('lelap-service-e1-3');
  });

  it('merges a batch only once, also when the service was never told', () => {
    const { bookId, merge, todayMs } = setup();
    const batch = { epoch: 'e1', records: [listen(1, bookId, 10 * MIN)] };
    expect(merge(batch).through).toBe(1);
    // The app stopped before acknowledging: the service hands out the same records again, and more.
    const again = merge({ epoch: 'e1', records: [...batch.records, listen(2, bookId, 5 * MIN)] });
    expect(again).toEqual({ through: 2, listenedMs: 5 * MIN, scrobbles: 0 });
    expect(todayMs()).toBe(15 * MIN);
    expect(merge({ epoch: 'e1', records: [listen(2, bookId, 5 * MIN)] }).listenedMs).toBe(0);
    expect(todayMs()).toBe(15 * MIN);
  });

  it('takes everything of a new epoch, whose numbers start again', () => {
    const { bookId, merge, todayMs } = setup();
    merge({ epoch: 'e1', records: [listen(5, bookId, 10 * MIN)] });
    merge({ epoch: 'e2', records: [listen(1, bookId, 4 * MIN)] });
    expect(todayMs()).toBe(14 * MIN);
  });

  it('files time under the day the service heard it', () => {
    const { bookId, merge, todayMs } = setup();
    merge({
      epoch: 'e1',
      records: [listen(1, bookId, 20 * MIN, '2026-11-16'), listen(2, bookId, 7 * MIN)],
    });
    expect(todayMs('2026-11-16')).toBe(20 * MIN);
    expect(todayMs()).toBe(7 * MIN);
  });

  it('skips records it cannot read but still lets the service drop them', () => {
    const { bookId, merge, todayMs } = setup();
    const broken = { ...listen(2, bookId, 5 * MIN), day: 'yesterday' };
    expect(merge({ epoch: 'e1', records: [listen(1, bookId, MIN), broken] })).toEqual({
      through: 2,
      listenedMs: MIN,
      scrobbles: 0,
    });
    expect(todayMs()).toBe(MIN);
  });

  it('counts time without scrobblers, and sends nothing for a book that is gone', () => {
    const { bookId, merge, todayMs, outbox } = setup();
    const start = (seq: number, id: string) => ({
      seq,
      kind: 'start' as const,
      bookId: id,
      at: 1,
      fileLocation: 'x',
      filePositionMs: 0,
      startLocation: null,
      startPositionMs: null,
    });
    expect(
      merge({ epoch: 'e1', records: [start(1, bookId), listen(2, bookId, MIN)] }, []),
    ).toMatchObject({ listenedMs: MIN, scrobbles: 0 });
    expect(merge({ epoch: 'e1', records: [start(3, 'gone')] }).scrobbles).toBe(0);
    expect(outbox()).toEqual([]);
    expect(todayMs()).toBe(MIN);
  });

  it('does nothing for an empty batch', () => {
    const { merge } = setup();
    expect(merge({ epoch: 'e1', records: [] })).toEqual({
      through: null,
      listenedMs: 0,
      scrobbles: 0,
    });
  });
});
