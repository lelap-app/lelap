import { hasParts, type Meta, type MetaPreview, type Stream } from '@lelap/sdk';
import { and, eq, like, notInArray } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { type AddonItemRef, bookFiles, books, chapters } from '../schema';

export type StreamedBookArgs = {
  addonUrl: string;
  meta: Meta | MetaPreview;
  stream: Stream;
  now: number;
  newId: IdGenerator;
};

type Part = { url: string; title: string; durationMs: number; size: number };

/** The location of a streamed book: one per add-on item, whatever source plays it. */
export const streamedBookLocation = (type: string, id: string) => `addon:${type}:${id}`;

const partLocation = (sourceKey: string, index: number) => `stream:${sourceKey}:${index}`;

function partsOf(meta: Meta | MetaPreview, stream: Stream): Part[] {
  if (hasParts(stream)) {
    return stream.parts.map((part, index) => ({
      url: part.url,
      title: part.title ?? `Part ${index + 1}`,
      durationMs: part.durationMs,
      size: part.size ?? 0,
    }));
  }
  return [
    {
      url: stream.url,
      title: meta.name,
      durationMs: stream.durationMs ?? meta.durationMs ?? 0,
      size: stream.size ?? 0,
    },
  ];
}

function chaptersOf(meta: Meta | MetaPreview, stream: Stream, parts: Part[]) {
  if (!hasParts(stream)) return stream.chapters ?? ('chapters' in meta ? meta.chapters : []) ?? [];
  if (parts.length === 1) return [];
  let startMs = 0;
  return parts.map((part) => {
    const chapter = { title: part.title, startMs };
    startMs += part.durationMs;
    return chapter;
  });
}

/** The library book that plays this recording, if any. */
export function findBookBySource(db: Db, sourceKey: string): string | null {
  return (
    db
      .select({ bookId: bookFiles.bookId })
      .from(bookFiles)
      .where(eq(bookFiles.location, partLocation(sourceKey, 0)))
      .get()?.bookId ?? null
  );
}

/** The streamed book that plays this source, or the one made for this add-on item. */
function existingBook(db: Db, location: string, sourceKey: string) {
  const id =
    findBookBySource(db, sourceKey) ??
    db.select({ id: books.id }).from(books).where(eq(books.location, location)).get()?.id;
  if (!id) return null;
  return db
    .select({ id: books.id, location: books.location })
    .from(books)
    .where(eq(books.id, id))
    .get();
}

/**
 * Adds a book streamed from an add-on to the library, or refreshes it, and returns its ID.
 * Parts are keyed by the stream's `sourceKey`, so a saved place follows its part when the add-on
 * changes the list, and playing the same recording from another item finds the same book.
 */
export function addStreamedBook(db: Db, args: StreamedBookArgs): string {
  const { addonUrl, meta, stream, now, newId } = args;
  const parts = partsOf(meta, stream);
  const location = streamedBookLocation(meta.type, meta.id);
  const addonItem: AddonItemRef = {
    addonUrl,
    type: meta.type,
    id: meta.id,
    sourceKey: stream.sourceKey,
  };
  const values = {
    kind: hasParts(stream) && parts.length > 1 ? ('folder' as const) : ('file' as const),
    source: 'addon' as const,
    rootId: null,
    title: meta.name,
    author: meta.author ?? null,
    coverPath: null,
    coverUrl: meta.cover ?? null,
    addonItem,
    durationMs: parts.reduce((sum, p) => sum + p.durationMs, 0),
    missingSince: null,
    updatedAt: now,
  };

  return db.transaction((tx) => {
    const found = existingBook(tx, location, stream.sourceKey);
    const bookId = found?.id ?? newId();
    if (found?.location === location) {
      tx.update(books).set(values).where(eq(books.id, bookId)).run();
    } else if (found) {
      // The same recording reached from another item (an Open Library work, say): keep the
      // title and cover the book was added with.
      tx.update(books)
        .set({ durationMs: values.durationMs, missingSince: null, updatedAt: now })
        .where(eq(books.id, bookId))
        .run();
    } else {
      tx.insert(books)
        .values({ id: bookId, location, addedAt: now, ...values })
        .run();
    }

    const locations = parts.map((_, index) => partLocation(stream.sourceKey, index));
    for (const [idx, part] of parts.entries()) {
      const row = {
        bookId,
        rootId: null,
        idx,
        uri: part.url,
        relPath: part.url,
        name: part.title,
        title: part.title,
        size: part.size,
        modifiedAt: now,
        durationMs: part.durationMs,
        chaptersJson: [],
        missingSince: null,
        updatedAt: now,
      };
      tx.insert(bookFiles)
        .values({ id: newId(), location: partLocation(stream.sourceKey, idx), ...row })
        .onConflictDoUpdate({ target: bookFiles.location, set: row })
        .run();
    }
    // Parts from an older list or another source. Saved places in them fall back to the
    // whole-book offset, as for a local file that went missing.
    tx.delete(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), notInArray(bookFiles.location, locations)))
      .run();

    tx.delete(chapters).where(eq(chapters.bookId, bookId)).run();
    const built = chaptersOf(meta, stream, parts);
    if (built.length > 0) {
      tx.insert(chapters)
        .values(
          built.map((c, idx) => ({
            id: newId(),
            bookId,
            idx,
            title: c.title,
            startMs: c.startMs,
            updatedAt: now,
          })),
        )
        .run();
    }
    return bookId;
  });
}

/** The library book for an add-on item, if it was played before. */
export function findStreamedBook(db: Db, type: string, id: string): string | null {
  const direct = db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.location, streamedBookLocation(type, id)))
    .get();
  if (direct) return direct.id;
  // A book first added from another item that plays the same recording.
  const candidates = db
    .select({ id: books.id, addonItem: books.addonItem })
    .from(books)
    .where(eq(books.source, 'addon'))
    .all();
  return candidates.find((b) => b.addonItem?.type === type && b.addonItem.id === id)?.id ?? null;
}

/** Removes a streamed book with its place and bookmarks. Local books are left alone. */
export function removeStreamedBook(db: Db, bookId: string): boolean {
  return db.transaction((tx) => {
    const book = tx.select({ source: books.source }).from(books).where(eq(books.id, bookId)).get();
    if (book?.source !== 'addon') return false;
    tx.delete(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), like(bookFiles.location, 'stream:%')))
      .run();
    tx.delete(books).where(eq(books.id, bookId)).run();
    return true;
  });
}
