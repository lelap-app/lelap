import { and, desc, eq, lt, lte, notInArray, sql } from 'drizzle-orm';

import type { Db } from './db';
import { books, playbackHistory } from './schema';
import type { SleepStop } from './sleep';

// Playback history (M138): a short log per book of what moved its place, so one tap can undo an
// accidental jump. It stays on this device. The Android service and the web player only report
// actions; what counts, how skips merge and how long entries stay is decided here.

/**
 * What the listener did. `timer` is setting, changing or extending the sleep timer, which counts
 * as use for “Back to when you last used it” (M86); `sleep` is the timer's own stop.
 */
export type HistoryAction = 'play' | 'pause' | 'skip' | 'seek' | 'chapter' | 'timer' | 'sleep';

/** Where it came from. `keys` are the browser's media keys; `timer` is the sleep timer itself. */
export type HistorySource =
  | 'app'
  | 'notification'
  | 'headphones'
  | 'widget'
  | 'car'
  | 'watch'
  | 'keys'
  | 'shake'
  | 'timer'
  | 'other';

const ACTIONS: readonly HistoryAction[] = [
  'play',
  'pause',
  'skip',
  'seek',
  'chapter',
  'timer',
  'sleep',
];
const SOURCES: readonly HistorySource[] = [
  'app',
  'notification',
  'headphones',
  'widget',
  'car',
  'watch',
  'keys',
  'shake',
  'timer',
  'other',
];

/** One action as a player reports it: whole-book places before and after, wall-clock time. */
export type HistoryReport = {
  bookId: string;
  action: HistoryAction;
  source: HistorySource;
  at: number;
  fromMs: number;
  toMs: number;
};

export type HistoryEntry = HistoryReport & { id: number };

/** Entries kept per book; older ones go. */
export const HISTORY_PER_BOOK = 50;
/** No entry is kept longer than this. */
export const HISTORY_KEEP_MS = 30 * 24 * 60 * 60_000;
/** Skips this close together from the same place are one entry, from the first place to the last. */
export const SKIP_RUN_MS = 5_000;
/** A Play this soon after another, near the same place, changed nothing and isn't kept. */
export const REPEAT_PLAY_MS = 10_000;
/** A jump longer than this offers to go back. */
export const UNDO_JUMP_MS = 60_000;
/** How long the player's bar offers to go back after a jump. */
export const UNDO_SHOWN_MS = 10_000;

/** A report from a player, checked: unknown actions are dropped, unknown sources become `other`. */
export function readReport(raw: unknown): HistoryReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  const at = num(r.at);
  const fromMs = num(r.fromMs);
  const toMs = num(r.toMs);
  if (typeof r.bookId !== 'string' || !r.bookId || at === null || fromMs === null || toMs === null)
    return null;
  if (!ACTIONS.includes(r.action as HistoryAction)) return null;
  const source = SOURCES.includes(r.source as HistorySource)
    ? (r.source as HistorySource)
    : 'other';
  return {
    bookId: r.bookId,
    action: r.action as HistoryAction,
    source,
    at,
    fromMs: Math.max(0, fromMs),
    toMs: Math.max(0, toMs),
  };
}

/** Whether [next] continues the run of skips that [last] is the newest of. */
export function continuesSkips(last: HistoryReport | undefined, next: HistoryReport): boolean {
  return (
    last !== undefined &&
    last.action === 'skip' &&
    next.action === 'skip' &&
    last.bookId === next.bookId &&
    last.source === next.source &&
    next.at >= last.at &&
    next.at - last.at <= SKIP_RUN_MS
  );
}

/**
 * Whether [next] is a Play pressed again while [last], the newest entry, already started playing:
 * a second tap while a stream starts, or Continue listening on a book that plays.
 */
export function repeatsPlay(last: HistoryReport | undefined, next: HistoryReport): boolean {
  return (
    last !== undefined &&
    last.action === 'play' &&
    next.action === 'play' &&
    last.bookId === next.bookId &&
    next.at >= last.at &&
    next.at - last.at <= REPEAT_PLAY_MS &&
    Math.abs(next.fromMs - last.toMs) <= REPEAT_PLAY_MS
  );
}

/** A skip, seek or chapter jump far enough to offer going back. */
export function isUndoableJump(entry: HistoryReport): boolean {
  return (
    (entry.action === 'skip' || entry.action === 'seek' || entry.action === 'chapter') &&
    Math.abs(entry.toMs - entry.fromMs) > UNDO_JUMP_MS
  );
}

/** How long the notification's and car's Back stays after a jump (`BackOffer` on Android). */
export const BACK_OFFER_MS = 30_000;
/** A jump that lands this close to where the one before it started goes back there. */
const BACK_MATCH_MS = 1_000;

/**
 * Whether the player's bar offers going back after [entry], with [log] the book's log newest
 * first. Not for a jump that itself goes back to where the one before it started, as the
 * notification's Back does: offering to undo that would only repeat the jump.
 */
export function offersGoBack(
  log: readonly HistoryEntry[],
  entry: HistoryEntry,
  now: number,
): boolean {
  if (!isUndoableJump(entry) || now - entry.at > UNDO_SHOWN_MS) return false;
  const index = log.findIndex((e) => e.id === entry.id);
  const before = index < 0 ? undefined : log[index + 1];
  return !(
    before !== undefined &&
    isUndoableJump(before) &&
    entry.at - before.at <= BACK_OFFER_MS &&
    Math.abs(entry.toMs - before.fromMs) <= BACK_MATCH_MS
  );
}

/**
 * Adds a report to the profile's log, merging a run of skips, and keeps the book's log short.
 * Returns the entry as stored, or null when nothing was kept: its book is no longer in the
 * library, or it repeats a Play just logged.
 */
export function recordHistory(
  db: Db,
  profileId: string,
  report: HistoryReport,
  now: number,
): HistoryEntry | null {
  if (now - report.at > HISTORY_KEEP_MS) return null;
  return db.transaction((tx) => {
    const known = tx.select({ id: books.id }).from(books).where(eq(books.id, report.bookId)).get();
    if (!known) return null;
    // The entry just before this report: a buffered skip may arrive after a newer tap was logged.
    const last = tx
      .select()
      .from(playbackHistory)
      .where(
        and(
          eq(playbackHistory.profileId, profileId),
          eq(playbackHistory.bookId, report.bookId),
          lte(playbackHistory.at, report.at),
        ),
      )
      .orderBy(desc(playbackHistory.at), desc(playbackHistory.id))
      .limit(1)
      .get();
    if (last && repeatsPlay(asReport(last), report)) return null;
    let entry: HistoryEntry;
    if (last && continuesSkips(asReport(last), report)) {
      tx.update(playbackHistory)
        .set({ at: report.at, toMs: report.toMs })
        .where(eq(playbackHistory.id, last.id))
        .run();
      entry = { ...asReport(last), id: last.id, at: report.at, toMs: report.toMs };
    } else {
      const row = tx
        .insert(playbackHistory)
        .values({ profileId, ...report })
        .returning({ id: playbackHistory.id })
        .get();
      entry = { ...report, id: row.id };
    }
    // Only the book's newest entries stay.
    const keep = tx
      .select({ id: playbackHistory.id })
      .from(playbackHistory)
      .where(
        and(eq(playbackHistory.profileId, profileId), eq(playbackHistory.bookId, report.bookId)),
      )
      .orderBy(desc(playbackHistory.at), desc(playbackHistory.id))
      .limit(HISTORY_PER_BOOK)
      .all()
      .map((r) => r.id);
    tx.delete(playbackHistory)
      .where(
        and(
          eq(playbackHistory.profileId, profileId),
          eq(playbackHistory.bookId, report.bookId),
          notInArray(playbackHistory.id, keep),
        ),
      )
      .run();
    return entry;
  });
}

function asReport(row: typeof playbackHistory.$inferSelect): HistoryEntry {
  return {
    id: row.id,
    bookId: row.bookId,
    action: row.action as HistoryAction,
    source: row.source as HistorySource,
    at: row.at,
    fromMs: row.fromMs,
    toMs: row.toMs,
  };
}

/** The book's log for the profile, newest first, without entries past the 30 days. */
export function bookHistory(
  db: Db,
  profileId: string,
  bookId: string,
  now: number,
): HistoryEntry[] {
  return db
    .select()
    .from(playbackHistory)
    .where(
      and(
        eq(playbackHistory.profileId, profileId),
        eq(playbackHistory.bookId, bookId),
        sql`${playbackHistory.at} >= ${now - HISTORY_KEEP_MS}`,
      ),
    )
    .orderBy(desc(playbackHistory.at), desc(playbackHistory.id))
    .limit(HISTORY_PER_BOOK)
    .all()
    .map(asReport);
}

/** Removes every entry older than 30 days, of every profile. */
export function pruneHistory(db: Db, now: number): void {
  db.delete(playbackHistory)
    .where(lt(playbackHistory.at, now - HISTORY_KEEP_MS))
    .run();
}

/** Uses older than this before a stop are not offered: they belong to another evening. */
const SLEEP_USE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The sleep timer's last stop in a book, with the listener's last use before it, read from the
 * book's log (newest first) for “Back to when you last used it” (M86). Every entry but the stop
 * itself is a use; auto-advance and smart rewind are never logged.
 */
export function sleepStopOf(entries: readonly HistoryReport[]): SleepStop | null {
  const index = entries.findIndex((e) => e.action === 'sleep');
  const stop = entries[index];
  if (!stop) return null;
  const used = entries
    .slice(index + 1)
    .find((e) => e.action !== 'sleep' && e.at <= stop.at && stop.at - e.at <= SLEEP_USE_WINDOW_MS);
  return {
    bookId: stop.bookId,
    stoppedMs: stop.toMs,
    stoppedAt: stop.at,
    usedMs: used ? used.toMs : null,
    usedAt: used ? used.at : null,
  };
}
