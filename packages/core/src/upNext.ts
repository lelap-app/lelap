import { and, asc, eq } from 'drizzle-orm';

import type { Db } from './db';
import { isLiveBook } from './live';
import { presentFiles } from './library/bookFiles';
import { endOfPodcastBook } from './library/folderPodcast';
import { setFinished } from './library/queries';
import { books, upNext } from './schema';
import { bookKey, recordDeletion } from './sync/keys';

export type UpNextItem = {
  bookId: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  coverUrl: string | null;
  source: 'local' | 'addon' | 'feed';
  /** The episode's own length for one episode of a book shown as a podcast. */
  durationMs: number;
  /** One episode of a book shown as a podcast (M158): it plays alone. Null for the whole item. */
  episode: { location: string; title: string } | null;
};

const mine = (profileId: string) => eq(upNext.profileId, profileId);

const stripExtension = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, '');

export function listUpNext(db: Db, profileId: string): UpNextItem[] {
  const rows = db
    .select({
      bookId: books.id,
      title: books.title,
      author: books.author,
      coverPath: books.coverPath,
      coverUrl: books.coverUrl,
      source: books.source,
      durationMs: books.durationMs,
      fileLocation: upNext.fileLocation,
    })
    .from(upNext)
    .innerJoin(books, eq(books.id, upNext.bookId))
    .where(mine(profileId))
    .orderBy(asc(upNext.position))
    .all();
  return rows.map(({ fileLocation, ...item }) => {
    const file = fileLocation
      ? presentFiles(db, item.bookId).find((f) => f.location === fileLocation)
      : undefined;
    // An episode whose file went is the whole book again.
    if (!file) return { ...item, episode: null };
    return {
      ...item,
      durationMs: file.durationMs,
      episode: { location: file.location, title: file.title?.trim() || stripExtension(file.name) },
    };
  });
}

/**
 * Adds to the front (`next`) or the end (`last`); an item already queued moves there. With
 * `fileLocation`, one episode of a book shown as a podcast (M158): a book is queued once, so it
 * takes the place of another episode of that book already queued.
 */
export function addToUpNext(
  db: Db,
  profileId: string,
  bookId: string,
  where: 'next' | 'last',
  now: number,
  fileLocation: string | null = null,
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
    .values({ profileId, bookId, position, fileLocation, addedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [upNext.profileId, upNext.bookId],
      set: { position, fileLocation, updatedAt: now },
    })
    .run();
}

/** The episode of a book queued in Up Next on its own (M158); null when none or not queued. */
export function queuedEpisode(db: Db, profileId: string, bookId: string): string | null {
  return (
    db
      .select({ fileLocation: upNext.fileLocation })
      .from(upNext)
      .where(and(mine(profileId), eq(upNext.bookId, bookId)))
      .get()?.fileLocation ?? null
  );
}

export function removeFromUpNext(
  db: Db,
  profileId: string,
  bookId: string,
  now = Date.now(),
): void {
  const removed = db
    .delete(upNext)
    .where(and(mine(profileId), eq(upNext.bookId, bookId)))
    .returning({ bookId: upNext.bookId })
    .all();
  const key = removed.length > 0 ? bookKey(db, bookId) : null;
  if (key) recordDeletion(db, 'upNext', key, profileId, now);
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
  if (isLiveBook(db, bookId)) return null;
  if (!endOfPodcastBook(db, profileId, bookId, now)) setFinished(db, profileId, bookId, true, now);
  removeFromUpNext(db, profileId, bookId, now);
  const book = db.select({ source: books.source }).from(books).where(eq(books.id, bookId)).get();
  if (book?.source !== 'feed') return null;
  return listUpNext(db, profileId)[0]?.bookId ?? null;
}

/**
 * The playback service played a book to its end (perhaps with the app closed, handing over to
 * the next itself): it is finished and leaves Up Next. `endedLocation` is the file it ended in,
 * which for one episode Up Next played alone is not the book's last (M158).
 */
export function finishFromPlayer(
  db: Db,
  profileId: string,
  bookId: string,
  at: number,
  endedLocation?: string | null,
): void {
  // A live stream that stopped (the station went off air) is not finished (M154).
  if (isLiveBook(db, bookId)) return;
  if (!endOfPodcastBook(db, profileId, bookId, at, endedLocation)) {
    setFinished(db, profileId, bookId, true, at);
  }
  removeFromUpNext(db, profileId, bookId, at);
}
