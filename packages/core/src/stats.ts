import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';

import type { Db } from './db';
import { books, libraryEntries, listeningLog } from './schema';

// Listening stats, computed on this device from a per-day log the app keeps while it plays. None
// of it is synced or sent anywhere. The sums, weeks, streaks and the year overview (M87) are pure
// functions over the log's rows; only `listeningStats` and `yearInSoundFor` read the database.

/** A local date as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local midnight of a YYYY-MM-DD day. */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** The day [n] days after (or before, when negative) a YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  const date = dayDate(day);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

/** Adds listening time to a day and book. */
export function recordListening(
  db: Db,
  profileId: string,
  entry: { day: string; bookId: string; title: string; ms: number },
): void {
  const ms = Math.round(entry.ms);
  if (ms <= 0) return;
  db.insert(listeningLog)
    .values({ profileId, ...entry, ms })
    .onConflictDoUpdate({
      target: [listeningLog.profileId, listeningLog.day, listeningLog.bookId],
      set: { ms: sql`${listeningLog.ms} + ${ms}`, title: entry.title },
    })
    .run();
}

// A day counts towards a streak once this much was listened.
const STREAK_MIN_MS = 60_000;

/** One row of the listening log: a profile's time on one book on one day. */
export type ListeningRow = { day: string; bookId: string; title: string; ms: number };
export type DayTotal = { day: string; ms: number };
export type BookTotal = { bookId: string; title: string; ms: number };
/** A finished book and the local day it was finished. */
export type FinishedBook = { bookId: string; title: string; day: string };
/** A week starting on [start], with the time listened and the days that count for a streak. */
export type WeekTotal = { start: string; ms: number; days: number };
export type Streak = { days: number; from: string; to: string };

/** Time listened per day. */
export function msByDay(rows: readonly { day: string; ms: number }[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.ms);
  return byDay;
}

const listenedOn = (byDay: ReadonlyMap<string, number>, day: string) =>
  (byDay.get(day) ?? 0) >= STREAK_MIN_MS;

/** [n] days ending with [today], oldest first. */
export function daysEnding(
  byDay: ReadonlyMap<string, number>,
  today: string,
  n: number,
): DayTotal[] {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - n + 1);
    return { day, ms: byDay.get(day) ?? 0 };
  });
}

/** The first day of [day]'s week, for weeks that start on [firstDay] (0 Sunday … 6 Saturday). */
export function weekStart(day: string, firstDay: number): string {
  const back = (dayDate(day).getDay() - firstDay + 7) % 7;
  return addDays(day, -back);
}

/** [n] weeks ending with the one [today] is in, oldest first. */
export function weeksEnding(
  byDay: ReadonlyMap<string, number>,
  today: string,
  n: number,
  firstDay: number,
): WeekTotal[] {
  const last = weekStart(today, firstDay);
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(last, (i - n + 1) * 7);
    let ms = 0;
    let days = 0;
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, d);
      ms += byDay.get(day) ?? 0;
      if (listenedOn(byDay, day)) days += 1;
    }
    return { start, ms, days };
  });
}

/** The longest run of days in a row with listening, the earliest when two are as long. */
export function longestStreak(byDay: ReadonlyMap<string, number>): Streak | null {
  let best: Streak | null = null;
  let run: Streak | null = null;
  for (const day of [...byDay.keys()].filter((d) => listenedOn(byDay, d)).sort()) {
    run =
      run !== null && addDays(run.to, 1) === day
        ? { days: run.days + 1, from: run.from, to: day }
        : { days: 1, from: day, to: day };
    if (!best || run.days > best.days) best = run;
  }
  return best;
}

/** Days in a row with listening up to [today]; it may end yesterday, as today isn't over yet. */
export function currentStreak(byDay: ReadonlyMap<string, number>, today: string): number {
  let streak = 0;
  let cursor = listenedOn(byDay, today) ? today : addDays(today, -1);
  while (listenedOn(byDay, cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Time per book, most first. */
export function topBooks(rows: readonly ListeningRow[], n: number): BookTotal[] {
  const perBook = new Map<string, BookTotal>();
  for (const r of rows) {
    const found = perBook.get(r.bookId);
    if (found) found.ms += r.ms;
    else perBook.set(r.bookId, { bookId: r.bookId, title: r.title, ms: r.ms });
  }
  return [...perBook.values()].sort((a, b) => b.ms - a.ms).slice(0, n);
}

/** The years with any listening or a finished book, newest first. */
export function yearsWithListening(
  rows: readonly { day: string }[],
  finished: readonly { day: string }[] = [],
): number[] {
  const years = new Set([...rows, ...finished].map((r) => Number(r.day.slice(0, 4))));
  return [...years].sort((a, b) => b - a);
}

export type YearInSound = {
  year: number;
  ms: number;
  /** Days with at least a minute of listening. */
  daysListened: number;
  /** Different books and episodes played. */
  booksPlayed: number;
  /** Time per month, January first. */
  months: number[];
  /** Books finished in the year, in the order they were finished. */
  finished: FinishedBook[];
  /** The year's longest streak, counted within the year. */
  longestStreak: Streak | null;
  busiestDay: DayTotal | null;
  /** The month with the most listening, from 0; the earlier of a tie, null without any. */
  busiestMonth: number | null;
  top: BookTotal[];
};

/** A year's overview from the whole log and every finished book. */
export function yearInSound(
  rows: readonly ListeningRow[],
  finished: readonly FinishedBook[],
  year: number,
): YearInSound {
  const prefix = `${year}-`;
  const yearRows = rows.filter((r) => r.day.startsWith(prefix));
  const byDay = msByDay(yearRows);
  const months = Array.from({ length: 12 }, () => 0);
  for (const r of yearRows) {
    const month = Number(r.day.slice(5, 7)) - 1;
    months[month] = (months[month] ?? 0) + r.ms;
  }
  let busiestDay: DayTotal | null = null;
  for (const [day, ms] of byDay) {
    if (
      ms > 0 &&
      (!busiestDay || ms > busiestDay.ms || (ms === busiestDay.ms && day < busiestDay.day))
    )
      busiestDay = { day, ms };
  }
  return {
    year,
    ms: yearRows.reduce((sum, r) => sum + r.ms, 0),
    daysListened: [...byDay.keys()].filter((d) => listenedOn(byDay, d)).length,
    booksPlayed: new Set(yearRows.map((r) => r.bookId)).size,
    months,
    finished: finished
      .filter((f) => f.day.startsWith(prefix))
      .sort((a, b) => a.day.localeCompare(b.day)),
    longestStreak: longestStreak(byDay),
    busiestDay,
    busiestMonth: Math.max(...months) > 0 ? months.indexOf(Math.max(...months)) : null,
    top: topBooks(yearRows, 5),
  };
}

/** Every row of a profile's listening log. */
export function listeningRows(db: Db, profileId: string): ListeningRow[] {
  return db
    .select({
      day: listeningLog.day,
      bookId: listeningLog.bookId,
      title: listeningLog.title,
      ms: listeningLog.ms,
    })
    .from(listeningLog)
    .where(eq(listeningLog.profileId, profileId))
    .all();
}

/** A profile's finished books, podcast episodes left out, on the local day they were finished. */
export function finishedBooks(db: Db, profileId: string): FinishedBook[] {
  return db
    .select({ bookId: books.id, title: books.title, finishedAt: libraryEntries.finishedAt })
    .from(libraryEntries)
    .innerJoin(books, eq(books.id, libraryEntries.bookId))
    .where(
      and(
        eq(libraryEntries.profileId, profileId),
        isNotNull(libraryEntries.finishedAt),
        ne(books.source, 'feed'),
      ),
    )
    .all()
    .map((r) => ({ bookId: r.bookId, title: r.title, day: dayKey(new Date(r.finishedAt ?? 0)) }));
}

export type ListeningStats = {
  todayMs: number;
  /** Today and the six days before it, oldest first. */
  week: DayTotal[];
  /** The last eight weeks, this one last. */
  weeks: WeekTotal[];
  yearMs: number;
  totalMs: number;
  /** Days in a row with listening, ending today or yesterday. */
  streak: number;
  longestStreak: Streak | null;
  /** Books finished this year, the latest first. */
  finishedThisYear: FinishedBook[];
  /** This year's most listened, most first. */
  topThisYear: BookTotal[];
  /** The years with listening, newest first, for their overviews. */
  years: number[];
};

/**
 * Stats for `today` (a YYYY-MM-DD local day), with weeks that start on [firstDay] (0 Sunday … 6
 * Saturday, from the phone's region).
 */
export function listeningStats(
  db: Db,
  profileId: string,
  today: string,
  firstDay = 1,
): ListeningStats {
  const rows = listeningRows(db, profileId);
  const finished = finishedBooks(db, profileId);
  const byDay = msByDay(rows);
  const year = Number(today.slice(0, 4));
  const overview = yearInSound(rows, finished, year);
  return {
    todayMs: byDay.get(today) ?? 0,
    week: daysEnding(byDay, today, 7),
    weeks: weeksEnding(byDay, today, 8, firstDay),
    yearMs: overview.ms,
    totalMs: rows.reduce((sum, r) => sum + r.ms, 0),
    streak: currentStreak(byDay, today),
    longestStreak: longestStreak(byDay),
    finishedThisYear: [...overview.finished].reverse(),
    topThisYear: overview.top,
    years: yearsWithListening(rows, finished),
  };
}

/** A year's overview for a profile. */
export function yearInSoundFor(db: Db, profileId: string, year: number): YearInSound {
  return yearInSound(listeningRows(db, profileId), finishedBooks(db, profileId), year);
}

/**
 * How much of a player update counts as listening: the position's advance in real time, never
 * more than the time that passed, so seeks and skips don't count.
 */
export function listenedBetween(
  before: { fileLocation: string | null; positionMs: number; at: number },
  after: { fileLocation: string | null; positionMs: number; at: number; speed: number },
): number {
  const wall = after.at - before.at;
  if (wall <= 0) return 0;
  const advance =
    after.fileLocation === before.fileLocation
      ? after.positionMs - before.positionMs
      : after.positionMs;
  if (advance <= 0) return 0;
  return Math.min(wall, advance / Math.max(0.5, after.speed));
}
