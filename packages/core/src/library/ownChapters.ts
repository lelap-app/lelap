import { and, asc, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { chapters, ownChapters, type StoredChapter } from '../schema';
import { bookKey } from '../sync/keys';

// The listener's own chapters (M85): a book's chapters fixed by hand, renamed, moved, added or
// removed. They take the place of the book's chapters for that profile only, and are kept by the
// book's synced name, never by its row, so a rescan that rebuilds the book keeps them.

/** At most this many chapters, and this long a title: anything more is not a chapter list. */
export const OWN_CHAPTERS_MAX = 2_000;
export const CHAPTER_TITLE_MAX = 500;

/**
 * A list fit to store: titles trimmed (an empty one gets `untitled(n)`), whole milliseconds
 * inside the book, in order, and never two at the same start (the first one stays).
 */
export function cleanChapters(
  list: readonly { title: unknown; startMs: unknown }[],
  durationMs: number,
  untitled: (n: number) => string,
): StoredChapter[] {
  const last = durationMs > 0 ? durationMs - 1 : Number.MAX_SAFE_INTEGER;
  const kept = list
    .filter((c) => typeof c.startMs === 'number' && Number.isFinite(c.startMs))
    .map((c, order) => ({
      title: typeof c.title === 'string' ? c.title.trim().slice(0, CHAPTER_TITLE_MAX) : '',
      startMs: Math.min(last, Math.max(0, Math.round(c.startMs as number))),
      order,
    }))
    .sort((a, b) => a.startMs - b.startMs || a.order - b.order)
    .filter((c, i, all) => i === 0 || all[i - 1]?.startMs !== c.startMs)
    .slice(0, OWN_CHAPTERS_MAX);
  return kept.map((c, i) => ({ title: c.title || untitled(i + 1), startMs: c.startMs }));
}

/** The listener's own chapters for a book, or null when the book's own apply. */
export function getOwnChapters(db: Db, profileId: string, bookId: string): StoredChapter[] | null {
  const key = bookKey(db, bookId);
  if (!key) return null;
  return (
    db
      .select({ chapters: ownChapters.chapters })
      .from(ownChapters)
      .where(and(eq(ownChapters.profileId, profileId), eq(ownChapters.bookKey, key)))
      .get()?.chapters ?? null
  );
}

/** The chapters as the book itself has them: from tags, a feed, a server or found from silences. */
export function bookChapters(db: Db, bookId: string): (StoredChapter & { found: boolean })[] {
  return db
    .select({ title: chapters.title, startMs: chapters.startMs, found: chapters.found })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.idx))
    .all();
}

/** The chapters this profile sees: its own when it has them, else the book's. */
export function chaptersOf(db: Db, profileId: string, bookId: string): StoredChapter[] {
  return (
    getOwnChapters(db, profileId, bookId) ??
    bookChapters(db, bookId).map(({ title, startMs }) => ({ title, startMs }))
  );
}

function write(
  db: Db,
  profileId: string,
  bookId: string,
  list: StoredChapter[] | null,
  now: number,
): boolean {
  const key = bookKey(db, bookId);
  if (!key) return false;
  db.insert(ownChapters)
    .values({ profileId, bookKey: key, chapters: list, updatedAt: now })
    .onConflictDoUpdate({
      target: [ownChapters.profileId, ownChapters.bookKey],
      set: { chapters: list, updatedAt: now },
    })
    .run();
  return true;
}

/** Stores the listener's chapters for a book, cleaned. Returns false when the book is gone. */
export function setOwnChapters(
  db: Db,
  profileId: string,
  bookId: string,
  list: readonly { title: string; startMs: number }[],
  durationMs: number,
  untitled: (n: number) => string,
  now: number,
): boolean {
  return write(db, profileId, bookId, cleanChapters(list, durationMs, untitled), now);
}

/** Goes back to the book's own chapters, on every device of this profile. */
export function resetOwnChapters(db: Db, profileId: string, bookId: string, now: number): void {
  if (getOwnChapters(db, profileId, bookId) !== null) write(db, profileId, bookId, null, now);
}
