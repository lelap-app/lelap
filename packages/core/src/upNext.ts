import { and, asc, eq } from 'drizzle-orm';

import type { Db } from './db';
import { setFinished } from './library/queries';
import { books, upNext } from './schema';

export type UpNextItem = {
  bookId: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  coverUrl: string | null;
  source: 'local' | 'addon' | 'feed';
  durationMs: number;
};

const mine = (profileId: string) => eq(upNext.profileId, profileId);

export function listUpNext(db: Db, profileId: string): UpNextItem[] {
  return db
    .select({
      bookId: books.id,
      title: books.title,
      author: books.author,
      coverPath: books.coverPath,
      coverUrl: books.coverUrl,
      source: books.source,
      durationMs: books.durationMs,
    })
    .from(upNext)
    .innerJoin(books, eq(books.id, upNext.bookId))
    .where(mine(profileId))
    .orderBy(asc(upNext.position))
    .all();
}

/** Adds to the front (`next`) or the end (`last`); an item already queued moves there. */
export function addToUpNext(
  db: Db,
  profileId: string,
  bookId: string,
  where: 'next' | 'last',
  now: number,
): void {
  const positions = db
    .select({ position: upNext.position })
    .from(upNext)
    .where(mine(profileId))
    .all()
    .map((r) => r.position);
  const position =
    positions.length === 0
      ? 0
      : where === 'next'
        ? Math.min(...positions) - 1
        : Math.max(...positions) + 1;
  db.insert(upNext)
    .values({ profileId, bookId, position, addedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [upNext.profileId, upNext.bookId],
      set: { position, updatedAt: now },
    })
    .run();
}

export function removeFromUpNext(db: Db, profileId: string, bookId: string): void {
  db.delete(upNext)
    .where(and(mine(profileId), eq(upNext.bookId, bookId)))
    .run();
}

/** Moves an item to `index` in the queue. */
export function moveInUpNext(
  db: Db,
  profileId: string,
  bookId: string,
  index: number,
  now: number,
): void {
  const order = listUpNext(db, profileId).map((i) => i.bookId);
  const from = order.indexOf(bookId);
  if (from < 0) return;
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, bookId);
  db.transaction((tx) => {
    for (const [position, id] of order.entries()) {
      tx.update(upNext)
        .set({ position, updatedAt: now })
        .where(and(mine(profileId), eq(upNext.bookId, id)))
        .run();
    }
  });
}

/**
 * A book or episode played to its end: it is marked finished and leaves Up Next. A podcast
 * episode hands over to the next item in the queue; a book stops there (the maintainer's pick).
 */
export function finishAndNext(
  db: Db,
  profileId: string,
  bookId: string,
  now: number,
): string | null {
  setFinished(db, profileId, bookId, true, now);
  removeFromUpNext(db, profileId, bookId);
  const book = db.select({ source: books.source }).from(books).where(eq(books.id, bookId)).get();
  if (book?.source !== 'feed') return null;
  return listUpNext(db, profileId)[0]?.bookId ?? null;
}
