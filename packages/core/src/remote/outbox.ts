import { and, asc, eq, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { DEFAULT_PROFILE_ID, getProfile } from '../profiles';
import { placeOutbox, progress } from '../schema';
import { SCROBBLE_MAX_AGE_MS, scrobbleBackoff, type TrackedEvent } from '../scrobble';

// Places for servers that keep them wait here until the server takes them (M65): the latest one
// per book and server, so a place reported offline goes out later. A newer report replaces an
// older one that is still waiting.

export type PendingPlace = typeof placeOutbox.$inferSelect;

/** Notes a book's place for a server; it replaces whatever was waiting for that book. */
export function queuePlace(db: Db, rootId: string, event: TrackedEvent): void {
  const kind = event.event;
  if (kind !== 'start' && kind !== 'progress' && kind !== 'pause' && kind !== 'finish') return;
  const values = {
    event: kind,
    positionMs: Math.max(0, Math.round(event.positionMs)),
    at: Math.round(event.at),
    attempts: 0,
    nextAttemptAt: Math.round(event.at),
  };
  db.insert(placeOutbox)
    .values({ rootId, bookId: event.bookId, ...values })
    .onConflictDoUpdate({ target: [placeOutbox.rootId, placeOutbox.bookId], set: values })
    .run();
}

/**
 * Places due by `now`, oldest first; with `all`, every waiting place, such as when the app comes
 * to the front. Places a month old are dropped unsent.
 */
export function duePlaces(db: Db, now: number, all = false): PendingPlace[] {
  db.delete(placeOutbox)
    .where(lte(placeOutbox.at, now - SCROBBLE_MAX_AGE_MS))
    .run();
  return db
    .select()
    .from(placeOutbox)
    .where(all ? undefined : lte(placeOutbox.nextAttemptAt, now))
    .orderBy(asc(placeOutbox.at))
    .all();
}

/** When the next place is due, or null when nothing waits. */
export function nextPlaceDue(db: Db): number | null {
  const row = db
    .select({ due: placeOutbox.nextAttemptAt })
    .from(placeOutbox)
    .orderBy(asc(placeOutbox.nextAttemptAt))
    .limit(1)
    .get();
  return row?.due ?? null;
}

const same = (row: PendingPlace) =>
  and(
    eq(placeOutbox.rootId, row.rootId),
    eq(placeOutbox.bookId, row.bookId),
    eq(placeOutbox.at, row.at),
  );

/** The server took the place, or never will: it goes, unless a newer one replaced it meanwhile. */
export function placeDone(db: Db, row: PendingPlace): void {
  db.delete(placeOutbox).where(same(row)).run();
}

/** The server could not be reached: the place waits longer each time, 30 s up to 6 h. */
export function placeFailed(db: Db, row: PendingPlace, now: number): void {
  db.update(placeOutbox)
    .set({ attempts: row.attempts + 1, nextAttemptAt: now + scrobbleBackoff(row.attempts + 1) })
    .where(same(row))
    .run();
}

/** Forgets what waits for a server, such as when it is removed. */
export function forgetPlaces(db: Db, rootId: string): void {
  db.delete(placeOutbox).where(eq(placeOutbox.rootId, rootId)).run();
}

// The app saves its own place at the same moments it reports one, a little later.
const SAME_MOMENT_MS = 5_000;

/**
 * What to tell the server for a waiting place. When the profile's own place is clearly newer, such
 * as one synced from another device while this one waited, that place goes instead.
 */
export function placeToSend(
  db: Db,
  profileId: string,
  row: PendingPlace,
): { event: PendingPlace['event']; positionMs: number } {
  const own = db
    .select({ bookPositionMs: progress.bookPositionMs, updatedAt: progress.updatedAt })
    .from(progress)
    .where(and(eq(progress.profileId, profileId), eq(progress.bookId, row.bookId)))
    .get();
  // A finish is folded in with the time the book ended, often before the place saved after it.
  if (row.event !== 'finish' && own && own.updatedAt > row.at + SAME_MOMENT_MS) {
    return { event: 'pause', positionMs: own.bookPositionMs };
  }
  return { event: row.event, positionMs: row.positionMs };
}

/** The profile whose places a server keeps: the one that added it, else the first profile. */
export function placeOwner(db: Db, profileId: string | undefined): string {
  return profileId && getProfile(db, profileId) ? profileId : DEFAULT_PROFILE_ID;
}

/**
 * Whether a report at the start of playback comes before the player moved to the saved place: the
 * player starts a book at 0 and seeks after, and a server would take that 0 as the place (M58).
 */
export function startsBeforePlace(event: TrackedEvent, savedPositionMs: number): boolean {
  return event.event === 'start' && event.positionMs < 1_000 && savedPositionMs >= 1_000;
}
