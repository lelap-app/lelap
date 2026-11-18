import { and, count, eq, inArray, ne, type SQL, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { books, hiddenBooks } from '../schema';

// Hidden books (M77) are kept by the book's location, the synced name of a library book, so a
// rescan or another device finds the same book. Podcast episodes are listed under their podcast
// and are never hidden here.

/** For queries over `books`: the book is not hidden by this profile. */
export function notHidden(profileId: string): SQL {
  return sql`not exists (select 1 from ${hiddenBooks} where ${hiddenBooks.profileId} = ${profileId} and ${hiddenBooks.bookKey} = ${books.location} and ${hiddenBooks.hidden} = 1)`;
}

/** For queries over `books`: the book is hidden by this profile. */
export function onlyHidden(profileId: string): SQL {
  return sql`exists (select 1 from ${hiddenBooks} where ${hiddenBooks.profileId} = ${profileId} and ${hiddenBooks.bookKey} = ${books.location} and ${hiddenBooks.hidden} = 1)`;
}

/** For queries over `books`: the profile hid the book, or said it isn't music. */
export function decidedMusic(profileId: string): SQL {
  return sql`exists (select 1 from ${hiddenBooks} where ${hiddenBooks.profileId} = ${profileId} and ${hiddenBooks.bookKey} = ${books.location} and (${hiddenBooks.hidden} = 1 or ${hiddenBooks.notMusic} = 1))`;
}

function keysOf(db: Db, bookIds: string[]): string[] {
  if (bookIds.length === 0) return [];
  return db
    .select({ location: books.location })
    .from(books)
    .where(and(inArray(books.id, bookIds), ne(books.source, 'feed')))
    .all()
    .map((b) => b.location);
}

function write(
  db: Db,
  profileId: string,
  bookIds: string[],
  set: { hidden?: boolean; notMusic?: boolean },
  now: number,
): void {
  const keys = keysOf(db, bookIds);
  if (keys.length === 0) return;
  db.transaction((tx) => {
    for (const bookKey of keys) {
      tx.insert(hiddenBooks)
        .values({ profileId, bookKey, ...set, updatedAt: now })
        .onConflictDoUpdate({
          target: [hiddenBooks.profileId, hiddenBooks.bookKey],
          set: { ...set, updatedAt: now },
        })
        .run();
    }
  });
}

/** Hides books from every list of this profile. What plays now keeps playing. */
export function hideBooks(db: Db, profileId: string, bookIds: string[], now: number): void {
  write(db, profileId, bookIds, { hidden: true }, now);
}

/** Takes back a hide (Undo): the books show again, and may still be suggested. */
export function unhideBooks(db: Db, profileId: string, bookIds: string[], now: number): void {
  write(db, profileId, bookIds, { hidden: false }, now);
}

/** “Show in library”: the books come back and are never suggested for hiding again. */
export function showInLibrary(db: Db, profileId: string, bookIds: string[], now: number): void {
  write(db, profileId, bookIds, { hidden: false, notMusic: true }, now);
}

/** The listener said these aren't music: they are never suggested again, but can still be hidden. */
export function markNotMusic(db: Db, profileId: string, bookIds: string[], now: number): void {
  write(db, profileId, bookIds, { notMusic: true }, now);
}

export function isHidden(db: Db, profileId: string, bookId: string): boolean {
  return (
    db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.id, bookId), onlyHidden(profileId)))
      .get() !== undefined
  );
}

/** Hidden books on this device; hidden books that aren't here (yet) are not counted. */
export function hiddenCount(db: Db, profileId: string): number {
  return (
    db
      .select({ n: count() })
      .from(books)
      .where(and(ne(books.source, 'feed'), onlyHidden(profileId)))
      .get()?.n ?? 0
  );
}
