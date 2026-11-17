import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { setFinished } from './library/queries';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { dayKey, listenedBetween, listeningStats, recordListening } from './stats';

const MIN = 60_000;
const YEAR = [new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime()] as const;

describe('listening stats', () => {
  it('adds up days, streaks, the week and the year', () => {
    const db = createTestDb();
    const log = (day: string, bookId: string, ms: number) =>
      recordListening(db, ME, { day, bookId, title: bookId.toUpperCase(), ms });
    log('2025-12-31', 'a', 30 * MIN);
    log('2026-11-10', 'a', 10 * MIN);
    log('2026-11-11', 'a', 10 * MIN);
    log('2026-11-12', 'a', 10 * MIN);
    log('2026-11-15', 'b', 20 * MIN);
    log('2026-11-16', 'b', 5 * MIN);
    log('2026-11-16', 'a', 5 * MIN);
    log('2026-11-17', 'b', 30_000); // under a minute: no streak day

    const stats = listeningStats(db, ME, '2026-11-17', ...YEAR);
    expect(stats.todayMs).toBe(30_000);
    expect(stats.streak).toBe(2);
    expect(stats.longestStreak).toBe(3);
    expect(stats.week.map((d) => d.day)).toEqual([
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
    ]);
    expect(stats.week[5]?.ms).toBe(10 * MIN);
    expect(stats.yearMs).toBe(60 * MIN + 30_000);
    expect(stats.totalMs).toBe(90 * MIN + 30_000);
    expect(stats.topThisYear.map((b) => [b.title, b.ms])).toEqual([
      ['A', 35 * MIN],
      ['B', 25 * MIN + 30_000],
    ]);
  });

  it('counts books finished this year', () => {
    const db = createTestDb();
    const book = seedBook(db, 'Done', [{ location: 'd', durationMs: 1000 }]);
    setFinished(db, ME, book, true, new Date(2026, 5, 1).getTime());
    expect(listeningStats(db, ME, '2026-11-17', ...YEAR).finishedThisYear).toBe(1);
    expect(listeningStats(db, ME, '2027-01-02', YEAR[1], YEAR[1] + 1).finishedThisYear).toBe(0);
  });

  it('counts real listening, not seeks', () => {
    const at = (positionMs: number, t: number, fileLocation = 'f', speed = 1) => ({
      fileLocation,
      positionMs,
      at: t,
      speed,
    });
    expect(listenedBetween(at(0, 0), at(1_000, 1_000))).toBe(1_000);
    expect(listenedBetween(at(0, 0), at(2_000, 1_000, 'f', 2))).toBe(1_000);
    expect(listenedBetween(at(0, 0), at(600_000, 1_000))).toBe(1_000); // a skip ahead
    expect(listenedBetween(at(5_000, 0), at(1_000, 1_000))).toBe(0); // rewound
    expect(listenedBetween(at(50_000, 0), at(400, 1_000, 'g'))).toBe(400); // next file
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
