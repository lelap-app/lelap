import { and, eq } from 'drizzle-orm';

import type { Db } from './db';
import { settings } from './schema';
import { bookKey } from './sync/keys';

// The listener's own rating of a book (M102): 0.5 to 5 stars in halves, per profile. Kept in the
// settings table by the book's synced name, so it outlives a rescan and syncs like a series
// order; taking a rating back keeps a row with `null`, so the removal syncs too.

const PREFIX = 'rating:';
export const RATING_PREFIX = PREFIX;

/** A stored or received rating, checked: 0.5 to 5 in steps of 0.5, else null. */
export function cleanRating(value: unknown): number | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null;
  const halves = parsed * 2;
  if (!Number.isInteger(halves) || halves < 1 || halves > 10) return null;
  return parsed;
}

/** This profile's rating of a book, or null. */
export function getRating(db: Db, profileId: string, bookId: string): number | null {
  const key = bookKey(db, bookId);
  if (!key) return null;
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.profileId, profileId), eq(settings.key, `${PREFIX}${key}`)))
    .get();
  return row ? cleanRating(row.value) : null;
}

/**
 * Keeps this profile's rating of a book; null takes it back. Returns whether it changed, so the
 * caller tells the add-ons only then. A book that is gone changes nothing.
 */
export function setRating(
  db: Db,
  profileId: string,
  bookId: string,
  rating: number | null,
  now: number,
): boolean {
  const key = bookKey(db, bookId);
  if (!key) return false;
  const clean = rating === null ? null : cleanRating(rating);
  if (rating !== null && clean === null) return false;
  if (getRating(db, profileId, bookId) === clean) return false;
  const value = JSON.stringify(clean);
  db.insert(settings)
    .values({ profileId, key: `${PREFIX}${key}`, value, updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: now },
    })
    .run();
  return true;
}
