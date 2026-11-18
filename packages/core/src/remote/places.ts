import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { presentFiles } from '../library/bookFiles';
import { setFinished } from '../library/queries';
import { saveProgress } from '../progress';
import {
  bookFiles,
  books,
  chapters,
  libraryEntries,
  progress,
  type StoredChapter,
} from '../schema';
import type { RemotePlace } from './jellyfin';

/** Sets the cover address of a server's books, by book location; books with a saved cover keep it. */
export function setRemoteCovers(
  db: Db,
  rootId: string,
  covers: Map<string, string>,
  now: number,
): void {
  if (covers.size === 0) return;
  const rows = db
    .select({ id: books.id, location: books.location, coverUrl: books.coverUrl })
    .from(books)
    .where(and(eq(books.rootId, rootId), inArray(books.location, [...covers.keys()])))
    .all();
  for (const row of rows) {
    const url = covers.get(row.location);
    if (!url || url === row.coverUrl) continue;
    db.update(books).set({ coverUrl: url, updatedAt: now }).where(eq(books.id, row.id)).run();
  }
}

/**
 * Gives a server's books the chapters the server keeps for the whole book, by book location, such
 * as Audiobookshelf's for a book of several files (M65): the files carry none of their own, so a
 * scan makes one chapter of each. Chapters found from silences give way too. Returns how many
 * books changed.
 */
export function setServerChapters(
  db: Db,
  rootId: string,
  list: Map<string, StoredChapter[]>,
  now: number,
  newId: IdGenerator,
): number {
  if (list.size === 0) return 0;
  const rows = db
    .select({ id: books.id, location: books.location })
    .from(books)
    .where(and(eq(books.rootId, rootId), inArray(books.location, [...list.keys()])))
    .all();
  let changed = 0;
  for (const row of rows) {
    const wanted = list.get(row.location) ?? [];
    if (wanted.length === 0) continue;
    const stored = db
      .select({ title: chapters.title, startMs: chapters.startMs, found: chapters.found })
      .from(chapters)
      .where(eq(chapters.bookId, row.id))
      .orderBy(asc(chapters.idx))
      .all();
    const same =
      stored.length === wanted.length &&
      stored.every(
        (c, i) => !c.found && c.title === wanted[i]?.title && c.startMs === wanted[i]?.startMs,
      );
    if (same) continue;
    db.transaction((tx) => {
      tx.delete(chapters).where(eq(chapters.bookId, row.id)).run();
      tx.insert(chapters)
        .values(
          wanted.map((c, idx) => ({
            id: newId(),
            bookId: row.id,
            idx,
            title: c.title,
            startMs: c.startMs,
            updatedAt: now,
          })),
        )
        .run();
    });
    changed++;
  }
  return changed;
}

/**
 * Takes places from a server into the library; the newest change wins against Lelap's own place.
 * Per book, the most recently played part decides: a part played to its end puts the place at
 * the start of the next one, and a book whose parts are all played is finished. Returns how many
 * books changed.
 */
export function applyRemotePlaces(
  db: Db,
  profileId: string,
  places: RemotePlace[],
  now: number,
): number {
  if (places.length === 0) return 0;
  const located = db
    .select({
      location: bookFiles.location,
      bookId: bookFiles.bookId,
      missingSince: bookFiles.missingSince,
    })
    .from(bookFiles)
    .where(
      inArray(
        bookFiles.location,
        places.map((p) => p.fileLocation),
      ),
    )
    .all();
  const bookOf = new Map(
    located.flatMap((f) => (f.bookId && f.missingSince === null ? [[f.location, f.bookId]] : [])),
  );
  const byBook = new Map<string, RemotePlace[]>();
  for (const place of places) {
    const bookId = bookOf.get(place.fileLocation);
    if (bookId) byBook.set(bookId, [...(byBook.get(bookId) ?? []), place]);
  }

  let changed = 0;
  for (const [bookId, bookPlaces] of byBook) {
    const files = presentFiles(db, bookId);
    const index = new Map(files.map((f, i) => [f.location, i]));
    const latest = [...bookPlaces].sort(
      (a, b) => b.at - a.at || (index.get(b.fileLocation) ?? 0) - (index.get(a.fileLocation) ?? 0),
    )[0];
    if (!latest) continue;
    const stored = db
      .select({ updatedAt: progress.updatedAt })
      .from(progress)
      .where(and(eq(progress.profileId, profileId), eq(progress.bookId, bookId)))
      .get();
    const entry = db
      .select({ finishedAt: libraryEntries.finishedAt, updatedAt: libraryEntries.updatedAt })
      .from(libraryEntries)
      .where(and(eq(libraryEntries.profileId, profileId), eq(libraryEntries.bookId, bookId)))
      .get();

    const played = new Set(bookPlaces.filter((p) => p.played).map((p) => p.fileLocation));
    if (files.length > 0 && files.every((f) => played.has(f.location))) {
      if (entry?.finishedAt == null && latest.at > (stored?.updatedAt ?? -1)) {
        setFinished(db, profileId, bookId, true, now, latest.at || now);
        changed++;
      }
      continue;
    }

    let target: { fileLocation: string; filePositionMs: number } | null = {
      fileLocation: latest.fileLocation,
      filePositionMs: latest.positionMs,
    };
    if (latest.played) {
      const next = files[(index.get(latest.fileLocation) ?? -1) + 1];
      target = next ? { fileLocation: next.location, filePositionMs: 0 } : null;
    }
    if (!target) continue;
    if (saveProgress(db, profileId, { bookId, ...target, savedAt: latest.at }, 'journal')) {
      changed++;
    }
  }
  return changed;
}
