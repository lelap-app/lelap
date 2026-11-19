import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import type { Db } from './db';
import {
  bookHistory,
  continuesSkips,
  HISTORY_KEEP_MS,
  HISTORY_PER_BOOK,
  type HistoryReport,
  isUndoableJump,
  pruneHistory,
  readReport,
  recordHistory,
  sleepStopOf,
} from './history';
import { deleteProfile, DEFAULT_PROFILE_ID as ME } from './profiles';
import { books, playbackHistory, profiles } from './schema';
import { sleepStopChoices } from './sleep';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe('playback history', () => {
  let db: Db;
  let bookId: string;
  const report = (r: Partial<HistoryReport>): HistoryReport => ({
    bookId,
    action: 'skip',
    source: 'app',
    at: NOW,
    fromMs: 0,
    toMs: 0,
    ...r,
  });

  beforeEach(() => {
    db = createTestDb();
    bookId = seedBook(db, 'Book', [{ location: 'a', durationMs: 10 * 60 * MIN }]);
  });

  it('merges a run of skips from one source into one entry, first place to last', () => {
    recordHistory(db, ME, report({ at: NOW, fromMs: 60 * MIN, toMs: 60 * MIN + 30_000 }), NOW);
    recordHistory(
      db,
      ME,
      report({ at: NOW + 2_000, fromMs: 60 * MIN + 30_000, toMs: 61 * MIN }),
      NOW,
    );
    const merged = recordHistory(
      db,
      ME,
      report({ at: NOW + 4_000, fromMs: 61 * MIN, toMs: 61 * MIN + 30_000 }),
      NOW,
    );
    expect(merged).toMatchObject({ fromMs: 60 * MIN, toMs: 61 * MIN + 30_000, at: NOW + 4_000 });
    expect(bookHistory(db, ME, bookId, NOW)).toHaveLength(1);
  });

  it('starts a new entry after a gap, from another source or after another action', () => {
    recordHistory(db, ME, report({ at: NOW }), NOW);
    recordHistory(db, ME, report({ at: NOW + 6_000 }), NOW);
    recordHistory(db, ME, report({ at: NOW + 7_000, source: 'headphones' }), NOW);
    recordHistory(db, ME, report({ at: NOW + 8_000, action: 'pause' }), NOW);
    recordHistory(db, ME, report({ at: NOW + 9_000 }), NOW);
    expect(bookHistory(db, ME, bookId, NOW).map((e) => [e.action, e.source])).toEqual([
      ['skip', 'app'],
      ['pause', 'app'],
      ['skip', 'headphones'],
      ['skip', 'app'],
      ['skip', 'app'],
    ]);
  });

  it('never merges into a newer entry that arrived first', () => {
    const last = report({ at: NOW + 3_000 });
    expect(continuesSkips(last, report({ at: NOW }))).toBe(false);
  });

  it('keeps the last 50 entries per book, newest first', () => {
    for (let i = 0; i < HISTORY_PER_BOOK + 5; i++) {
      recordHistory(db, ME, report({ action: 'pause', at: NOW + i * 10_000 }), NOW);
    }
    const kept = bookHistory(db, ME, bookId, NOW);
    expect(kept).toHaveLength(HISTORY_PER_BOOK);
    expect(kept[0]?.at).toBe(NOW + (HISTORY_PER_BOOK + 4) * 10_000);
    expect(db.select().from(playbackHistory).all()).toHaveLength(HISTORY_PER_BOOK);
  });

  it('keeps nothing older than 30 days', () => {
    expect(
      recordHistory(db, ME, report({ action: 'pause', at: NOW - HISTORY_KEEP_MS - 1 }), NOW),
    ).toBeNull();
    recordHistory(db, ME, report({ action: 'pause', at: NOW - 20 * 24 * 60 * MIN }), NOW);
    expect(bookHistory(db, ME, bookId, NOW + 11 * 24 * 60 * MIN)).toEqual([]);
    pruneHistory(db, NOW + 11 * 24 * 60 * MIN);
    expect(db.select().from(playbackHistory).all()).toEqual([]);
  });

  it('is per profile, and goes with the profile and the book', () => {
    db.insert(profiles).values({ id: 'kid', name: 'Kid', createdAt: 0, updatedAt: 0 }).run();
    recordHistory(db, ME, report({ action: 'play' }), NOW);
    recordHistory(db, 'kid', report({ action: 'play' }), NOW);
    expect(bookHistory(db, 'kid', bookId, NOW)).toHaveLength(1);
    deleteProfile(db, 'kid', NOW);
    expect(db.select().from(playbackHistory).all()).toHaveLength(1);
    db.delete(books).where(eq(books.id, bookId)).run();
    expect(db.select().from(playbackHistory).all()).toEqual([]);
  });

  it('skips a report for a book that is gone', () => {
    expect(recordHistory(db, ME, report({ bookId: 'gone' }), NOW)).toBeNull();
  });

  it('offers going back after a jump of more than a minute', () => {
    expect(isUndoableJump(report({ fromMs: 0, toMs: MIN }))).toBe(false);
    expect(isUndoableJump(report({ fromMs: 2 * MIN, toMs: 0, action: 'seek' }))).toBe(true);
    expect(isUndoableJump(report({ fromMs: 0, toMs: 5 * MIN, action: 'chapter' }))).toBe(true);
    expect(isUndoableJump(report({ fromMs: 0, toMs: 5 * MIN, action: 'play' }))).toBe(false);
  });

  it('reads what players report, and drops what it does not know', () => {
    expect(
      readReport({ bookId: 'b', action: 'seek', source: 'gear', at: 1, fromMs: -3, toMs: 2.4 }),
    ).toEqual({ bookId: 'b', action: 'seek', source: 'other', at: 1, fromMs: 0, toMs: 2 });
    expect(
      readReport({ bookId: 'b', action: 'eat', source: 'app', at: 1, fromMs: 0, toMs: 0 }),
    ).toBeNull();
    expect(readReport(null)).toBeNull();
  });
});

describe('the sleep timer stop from the log (M86)', () => {
  const entry = (r: Partial<HistoryReport>): HistoryReport => ({
    bookId: 'b',
    action: 'play',
    source: 'app',
    at: NOW,
    fromMs: 0,
    toMs: 0,
    ...r,
  });

  it('pairs the newest stop with the last use before it', () => {
    const log = [
      entry({ action: 'sleep', source: 'timer', at: NOW, fromMs: 90 * MIN, toMs: 90 * MIN }),
      entry({ action: 'timer', source: 'notification', at: NOW - 20 * MIN, toMs: 70 * MIN }),
      entry({ action: 'play', at: NOW - 40 * MIN, toMs: 50 * MIN }),
    ];
    const stop = sleepStopOf(log);
    expect(stop).toEqual({
      bookId: 'b',
      stoppedMs: 90 * MIN,
      stoppedAt: NOW,
      usedMs: 70 * MIN,
      usedAt: NOW - 20 * MIN,
    });
    expect(sleepStopChoices(stop, 'b', 90 * MIN, NOW + MIN)?.lastUsed).toEqual({
      positionMs: 70 * MIN,
      at: NOW - 20 * MIN,
      beforeStopMs: 20 * MIN,
    });
  });

  it('has no last use without one, or one from another day', () => {
    expect(sleepStopOf([entry({ action: 'sleep', toMs: 5 * MIN })])?.usedAt).toBeNull();
    expect(
      sleepStopOf([
        entry({ action: 'sleep', toMs: 5 * MIN }),
        entry({ at: NOW - 25 * 60 * MIN, toMs: MIN }),
      ])?.usedAt,
    ).toBeNull();
    expect(sleepStopOf([entry({ action: 'pause' })])).toBeNull();
  });

  it('reads the stop even when the listener acted after it', () => {
    const stop = sleepStopOf([
      entry({ action: 'play', at: NOW + MIN, toMs: 90 * MIN }),
      entry({ action: 'sleep', at: NOW, toMs: 90 * MIN }),
    ]);
    expect(stop?.stoppedAt).toBe(NOW);
  });
});
