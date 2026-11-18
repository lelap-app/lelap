import { and, eq } from 'drizzle-orm';

import type { Db } from './db';
import { isKidsProfile } from './kids';
import { books, libraryRoots, settings, subscriptions } from './schema';

// Kept beside the settings, like other one-time questions; not a synced setting.
const DONE_KEY = 'first-start-done';

/**
 * Whether this profile sees the first start (M82): only on a device with nothing in it yet. Any
 * book, folder, server or podcast means an install in use, which must never see it; nor does a
 * kids profile, which can't add sources.
 */
export function needsFirstStart(db: Db, profileId: string): boolean {
  if (firstStartDone(db, profileId)) return false;
  if (isKidsProfile(db, profileId)) return false;
  if (!libraryIsEmpty(db)) return false;
  return (
    db
      .select({ id: subscriptions.podcastId })
      .from(subscriptions)
      .where(eq(subscriptions.profileId, profileId))
      .limit(1)
      .get() === undefined
  );
}

export function firstStartDone(db: Db, profileId: string): boolean {
  return (
    db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.profileId, profileId), eq(settings.key, DONE_KEY)))
      .get() !== undefined
  );
}

/** Finished or skipped: the first start is not shown to this profile again. */
export function setFirstStartDone(db: Db, profileId: string, now: number): void {
  db.insert(settings)
    .values({ profileId, key: DONE_KEY, value: 'true', updatedAt: now })
    .onConflictDoNothing()
    .run();
}

/** No books and no folder or server on this device yet, for the empty states on Home. */
export function libraryIsEmpty(db: Db): boolean {
  return (
    db.select({ id: books.id }).from(books).limit(1).get() === undefined &&
    db.select({ id: libraryRoots.id }).from(libraryRoots).limit(1).get() === undefined
  );
}
