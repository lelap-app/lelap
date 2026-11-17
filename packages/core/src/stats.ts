import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';

import type { Db } from './db';
import { libraryEntries, listeningLog } from './schema';

// Listening stats, computed on this device from a per-day log the app keeps while it plays. None
// of it is synced or sent anywhere.

/** A local date as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day before a YYYY-MM-DD day. */
function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1));
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

export type ListeningStats = {
  todayMs: number;
  /** Today and the six days before it, oldest first. */
  week: { day: string; ms: number }[];
  yearMs: number;
  totalMs: number;
  /** Days in a row with listening, ending today or yesterday. */
  streak: number;
  longestStreak: number;
  /** Books finished this year, and the goal (0 when none is set). */
  finishedThisYear: number;
  /** This year's most listened, most first. */
  topThisYear: { bookId: string; title: string; ms: number }[];
};

/**
 * Stats for `today` (a YYYY-MM-DD local day). `yearStart` and `yearEnd` are the local year's
 * bounds in ms, for counting finished books.
 */
export function listeningStats(
  db: Db,
  profileId: string,
  today: string,
  yearStart: number,
  yearEnd: number,
): ListeningStats {
  const rows = db.select().from(listeningLog).where(eq(listeningLog.profileId, profileId)).all();
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.ms);

  const week: { day: string; ms: number }[] = [];
  let day = today;
  for (let i = 0; i < 7; i++) {
    week.unshift({ day, ms: byDay.get(day) ?? 0 });
    day = previousDay(day);
  }

  // The current streak may end yesterday: today isn't over yet.
  const listened = (d: string) => (byDay.get(d) ?? 0) >= STREAK_MIN_MS;
  let streak = 0;
  let cursor = listened(today) ? today : previousDay(today);
  while (listened(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  let longestStreak = 0;
  let run = 0;
  let last: string | null = null;
  for (const d of [...byDay.keys()].filter(listened).sort()) {
    run = last !== null && previousDay(d) === last ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    last = d;
  }

  const year = today.slice(0, 4);
  const yearRows = rows.filter((r) => r.day.startsWith(year));
  const perBook = new Map<string, { bookId: string; title: string; ms: number }>();
  for (const r of yearRows) {
    const found = perBook.get(r.bookId);
    if (found) found.ms += r.ms;
    else perBook.set(r.bookId, { bookId: r.bookId, title: r.title, ms: r.ms });
  }

  const finishedThisYear =
    db
      .select({ n: sql<number>`count(*)` })
      .from(libraryEntries)
      .where(
        and(
          eq(libraryEntries.profileId, profileId),
          isNotNull(libraryEntries.finishedAt),
          gte(libraryEntries.finishedAt, yearStart),
          lt(libraryEntries.finishedAt, yearEnd),
        ),
      )
      .get()?.n ?? 0;

  return {
    todayMs: byDay.get(today) ?? 0,
    week,
    yearMs: yearRows.reduce((sum, r) => sum + r.ms, 0),
    totalMs: rows.reduce((sum, r) => sum + r.ms, 0),
    streak,
    longestStreak: Math.max(longestStreak, streak),
    finishedThisYear,
    topThisYear: [...perBook.values()].sort((a, b) => b.ms - a.ms).slice(0, 5),
  };
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
