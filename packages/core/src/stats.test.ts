import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { setFinished } from './library/queries';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { books } from './schema';
import {
  addDays,
  currentStreak,
  dayKey,
  daysEnding,
  listenedBetween,
  listeningStats,
  longestStreak,
  msByDay,
  recordListening,
  weekStart,
  weeksEnding,
  yearInSound,
  yearInSoundFor,
  yearsWithListening,
  type ListeningRow,
} from './stats';

const MIN = 60_000;
const row = (day: string, bookId: string, ms: number): ListeningRow => ({
  day,
  bookId,
  title: bookId.toUpperCase(),
  ms,
});

describe('listening stats', () => {
  it('adds up days, streaks, the week and the year', () => {
    const db = createTestDb();
    const log = (day: string, bookId: string, ms: number) =>
      recordListening(db, ME, row(day, bookId, ms));
    log('2025-12-31', 'a', 30 * MIN);
    log('2026-11-10', 'a', 10 * MIN);
    log('2026-11-11', 'a', 10 * MIN);
    log('2026-11-12', 'a', 10 * MIN);
    log('2026-11-15', 'b', 20 * MIN);
    log('2026-11-16', 'b', 5 * MIN);
    log('2026-11-16', 'a', 5 * MIN);
    log('2026-11-17', 'b', 30_000); // under a minute: no streak day

    const stats = listeningStats(db, ME, '2026-11-17');
    expect(stats.todayMs).toBe(30_000);
    expect(stats.streak).toBe(2);
    expect(stats.longestStreak).toEqual({ days: 3, from: '2026-11-10', to: '2026-11-12' });
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
    // Weeks from Monday: 9–15 November and 16–22 November are the last two.
    expect(stats.weeks).toHaveLength(8);
    expect(stats.weeks.slice(-2)).toEqual([
      { start: '2026-11-09', ms: 50 * MIN, days: 4 },
      { start: '2026-11-16', ms: 10 * MIN + 30_000, days: 1 },
    ]);
    expect(stats.yearMs).toBe(60 * MIN + 30_000);
    expect(stats.totalMs).toBe(90 * MIN + 30_000);
    expect(stats.topThisYear.map((b) => [b.title, b.ms])).toEqual([
      ['A', 35 * MIN],
      ['B', 25 * MIN + 30_000],
    ]);
    expect(stats.years).toEqual([2026, 2025]);
  });

  it('keeps each profile’s listening to itself', () => {
    const db = createTestDb();
    recordListening(db, ME, row('2026-11-17', 'a', 10 * MIN));
    const kid = listeningStats(db, 'kid', '2026-11-17');
    expect(kid.todayMs).toBe(0);
    expect(kid.years).toEqual([]);
  });

  it('lists books finished this year, latest first, without podcast episodes', () => {
    const db = createTestDb();
    const june = seedBook(db, 'June', [{ location: 'j', durationMs: 1000 }]);
    const march = seedBook(db, 'March', [{ location: 'm', durationMs: 1000 }]);
    const old = seedBook(db, 'Old', [{ location: 'o', durationMs: 1000 }]);
    const episode = seedBook(db, 'Episode', [{ location: 'e', durationMs: 1000 }]);
    db.update(books).set({ source: 'feed' }).where(eq(books.id, episode)).run();
    setFinished(db, ME, june, true, new Date(2026, 5, 1, 12).getTime());
    setFinished(db, ME, march, true, new Date(2026, 2, 3, 12).getTime());
    setFinished(db, ME, old, true, new Date(2025, 2, 3, 12).getTime());
    setFinished(db, ME, episode, true, new Date(2026, 4, 1, 12).getTime());

    const stats = listeningStats(db, ME, '2026-11-17');
    expect(stats.finishedThisYear.map((b) => [b.title, b.day])).toEqual([
      ['June', '2026-06-01'],
      ['March', '2026-03-03'],
    ]);
    expect(stats.years).toEqual([2026, 2025]);
    expect(listeningStats(db, ME, '2027-01-02').finishedThisYear).toEqual([]);
    expect(yearInSoundFor(db, ME, 2025).finished.map((b) => b.title)).toEqual(['Old']);
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

describe('days and weeks', () => {
  it('steps over months, years and leap days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // The day Europe moves its clocks on keeps whole days.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('starts weeks on the region’s first day', () => {
    // 18 November 2026 is a Wednesday.
    expect(weekStart('2026-11-18', 1)).toBe('2026-11-16');
    expect(weekStart('2026-11-18', 0)).toBe('2026-11-15');
    expect(weekStart('2026-11-18', 6)).toBe('2026-11-14');
    expect(weekStart('2026-11-16', 1)).toBe('2026-11-16');
    // A week can start in the year before.
    expect(weekStart('2027-01-01', 1)).toBe('2026-12-28');
  });

  it('adds up days and weeks, oldest first', () => {
    const byDay = msByDay([
      row('2026-11-14', 'a', 5 * MIN),
      row('2026-11-15', 'a', 10 * MIN),
      row('2026-11-15', 'b', 10 * MIN),
      row('2026-11-18', 'a', 30_000),
    ]);
    expect(daysEnding(byDay, '2026-11-18', 3)).toEqual([
      { day: '2026-11-16', ms: 0 },
      { day: '2026-11-17', ms: 0 },
      { day: '2026-11-18', ms: 30_000 },
    ]);
    // Weeks from Sunday: the 15th opens the week the 18th is in.
    expect(weeksEnding(byDay, '2026-11-18', 2, 0)).toEqual([
      { start: '2026-11-08', ms: 5 * MIN, days: 1 },
      { start: '2026-11-15', ms: 20 * MIN + 30_000, days: 1 },
    ]);
    expect(weeksEnding(new Map(), '2026-11-18', 3, 1).map((w) => w.ms)).toEqual([0, 0, 0]);
  });
});

describe('streaks', () => {
  const days = (...list: string[]) => msByDay(list.map((d) => row(d, 'a', MIN)));

  it('runs over the turn of a month and year', () => {
    const byDay = days('2026-12-30', '2026-12-31', '2027-01-01', '2027-01-03');
    expect(longestStreak(byDay)).toEqual({ days: 3, from: '2026-12-30', to: '2027-01-01' });
    expect(currentStreak(byDay, '2027-01-03')).toBe(1);
    expect(currentStreak(byDay, '2027-01-04')).toBe(1); // today isn't over yet
    expect(currentStreak(byDay, '2027-01-05')).toBe(0);
  });

  it('keeps the earlier of two equal runs, and none without listening', () => {
    expect(longestStreak(days('2026-01-01', '2026-01-02', '2026-02-01', '2026-02-02'))).toEqual({
      days: 2,
      from: '2026-01-01',
      to: '2026-01-02',
    });
    expect(longestStreak(new Map())).toBeNull();
    expect(longestStreak(msByDay([row('2026-01-01', 'a', 59_000)]))).toBeNull();
  });
});

describe('year in sound', () => {
  const rows = [
    row('2025-12-31', 'a', 60 * MIN),
    row('2026-01-01', 'a', 20 * MIN),
    row('2026-01-02', 'b', 30 * MIN),
    row('2026-01-02', 'a', 15 * MIN),
    row('2026-01-03', 'b', 10 * MIN),
    row('2026-03-10', 'c', 90 * MIN),
    row('2026-12-31', 'c', 30_000),
  ];
  const finished = [
    { bookId: 'b', title: 'B', day: '2026-03-01' },
    { bookId: 'a', title: 'A', day: '2026-01-02' },
    { bookId: 'z', title: 'Z', day: '2025-06-01' },
  ];

  it('adds up the year by month and book', () => {
    const year = yearInSound(rows, finished, 2026);
    expect(year.ms).toBe(165 * MIN + 30_000);
    expect(year.months).toEqual([75 * MIN, 0, 90 * MIN, 0, 0, 0, 0, 0, 0, 0, 0, 30_000]);
    expect(year.daysListened).toBe(4); // the 31st has under a minute
    expect(year.booksPlayed).toBe(3);
    expect(year.finished.map((b) => b.title)).toEqual(['A', 'B']);
    expect(year.busiestDay).toEqual({ day: '2026-03-10', ms: 90 * MIN });
    expect(year.top.map((b) => [b.title, b.ms])).toEqual([
      ['C', 90 * MIN + 30_000],
      ['B', 40 * MIN],
      ['A', 35 * MIN],
    ]);
  });

  it('counts the longest streak within the year only', () => {
    // 31 December 2025 joins 1–3 January into four days, but the year holds three.
    expect(yearInSound(rows, finished, 2026).longestStreak).toEqual({
      days: 3,
      from: '2026-01-01',
      to: '2026-01-03',
    });
  });

  it('is empty for a year without listening', () => {
    const year = yearInSound(rows, finished, 2024);
    expect(year.ms).toBe(0);
    expect(year.months.every((ms) => ms === 0)).toBe(true);
    expect(year.busiestDay).toBeNull();
    expect(year.longestStreak).toBeNull();
    expect(year.top).toEqual([]);
  });

  it('lists the years with listening or a finished book, newest first', () => {
    expect(yearsWithListening(rows, finished)).toEqual([2026, 2025]);
    expect(yearsWithListening([], [])).toEqual([]);
  });
});
