import { type Chapter, hasParts, type Meta, type MetaPreview, type Stream } from '@lelap/sdk';
import { and, asc, eq, like, notInArray } from 'drizzle-orm';

import type { Db } from '../db';
import type { FeedTranscript } from '../podcasts/podcasting';
import type { IdGenerator } from '../ids';
import {
  type AddonItemRef,
  bookFiles,
  books,
  chapters,
  type KindTags,
  streamHeaders,
} from '../schema';
import { formatSeries } from '../library/seriesNames';
import { recordDeletion } from '../sync/keys';
import { saveStreamHeaders } from './streamHeaders';

export type StreamedBookArgs = {
  addonUrl: string;
  /** The item's full meta: what it leaves out, such as a series, the book loses (M115). */
  meta: Meta;
  stream: Stream;
  now: number;
  newId: IdGenerator;
};

const isLive = (stream: Stream) => stream.live === true;

type Part = { url: string; title: string; durationMs: number; size: number };

/** The location of a streamed book: one per add-on item, whatever source plays it. */
export const streamedBookLocation = (type: string, id: string) => `addon:${type}:${id}`;

const partLocation = (sourceKey: string, index: number) => `stream:${sourceKey}:${index}`;

const NO_KIND_TAGS: KindTags = {
  genre: null,
  isrc: null,
  track: null,
  year: null,
  narrator: null,
  mediaKind: null,
};

function partsOf(meta: Meta | MetaPreview, stream: Stream): Part[] {
  if (hasParts(stream)) {
    return stream.parts.map((part, index) => ({
      url: part.url,
      title: part.title ?? `Part ${index + 1}`,
      // Since revision 14 a part may come without a length; the player measures it (M140).
      durationMs: part.durationMs ?? 0,
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

/**
 * A book's length once every part has one, else 0: a total from some parts would make the bar
 * and the percentage wrong. Until then the book's progress counts parts (M152).
 */
export function knownTotal(lengths: number[]): number {
  return lengths.every((ms) => ms > 0) ? lengths.reduce((sum, ms) => sum + ms, 0) : 0;
}

/** How far a stream's length may be from the meta's for the meta's chapters to apply. */
export const CHAPTER_FIT_MS = 15_000;

/** The meta's chapters and length, as a book of unmeasured parts keeps them (M155). */
export type MetaChapters = { chapters: Chapter[]; durationMs?: number };

/**
 * The meta's chapters, for a stream without its own. Chapters from metadata (Audnexus, say)
 * belong to one recording, so they only apply when the stream is as long as the meta says.
 * A meta without a length keeps the older rule: its chapters apply to any single file.
 */
function fittingChapters(meta: MetaChapters, parted: boolean, totalMs: number): Chapter[] {
  const list = meta.chapters;
  if (list.length === 0) return [];
  if (meta.durationMs === undefined) return parted ? [] : list;
  const fits =
    totalMs > 0 &&
    Math.abs(totalMs - meta.durationMs) <= CHAPTER_FIT_MS &&
    list.every((c) => c.startMs < totalMs);
  return fits ? list : [];
}

const metaChaptersOf = (meta: Meta | MetaPreview): MetaChapters => ({
  chapters: 'chapters' in meta ? (meta.chapters ?? []) : [],
  ...(meta.durationMs !== undefined ? { durationMs: meta.durationMs } : {}),
});

/**
 * A parted book's chapters: the meta's when they fit, else one per part. None while a part has
 * no length, which would put every later chapter in the wrong place.
 */
function partChapters(meta: MetaChapters, parts: Pick<Part, 'title' | 'durationMs'>[]): Chapter[] {
  if (parts.some((p) => !(p.durationMs > 0))) return [];
  const fromMeta = fittingChapters(
    meta,
    true,
    parts.reduce((sum, p) => sum + p.durationMs, 0),
  );
  if (fromMeta.length > 0 || parts.length === 1) return fromMeta;
  let startMs = 0;
  return parts.map((part) => {
    const chapter = { title: part.title, startMs };
    startMs += part.durationMs;
    return chapter;
  });
}

function chaptersOf(meta: Meta | MetaPreview, stream: Stream, parts: Part[]): Chapter[] {
  if (!hasParts(stream))
    return stream.chapters ?? fittingChapters(metaChaptersOf(meta), false, stream.durationMs ?? 0);
  return partChapters(metaChaptersOf(meta), parts);
}

/**
 * What a book of parts still being measured keeps for its chapters (M155): the meta's chapters
 * and length, applied by [chaptersOnceMeasured] once the player measured the last part. Nothing
 * when every part has a length already or there is nothing to wait for.
 */
function waitingChapters(
  meta: Meta | MetaPreview,
  stream: Stream,
  parts: Part[],
): Pick<AddonItemRef, 'waitingChapters'> {
  if (!hasParts(stream) || parts.every((p) => p.durationMs > 0)) return {};
  const kept = metaChaptersOf(meta);
  // One part per chapter needs nothing kept: the parts' titles are in the library.
  if (kept.chapters.length === 0 && parts.length < 2) return {};
  return { waitingChapters: kept };
}

/**
 * A streamed book's chapters once its last part has a length (M155), from what it kept when it
 * was added: the meta's chapters when they fit, else one per part. Replaces chapters found from
 * silences, as adding the book again would; leaves the book alone when it waits for nothing or a
 * part is still unmeasured. Returns whether it wrote chapters, which the loaded book then needs.
 */
export function chaptersOnceMeasured(
  db: Db,
  bookId: string,
  now: number,
  newId: IdGenerator,
): boolean {
  return db.transaction((tx) => applyWaitingChapters(tx, bookId, now, newId));
}

function applyWaitingChapters(db: Db, bookId: string, now: number, newId: IdGenerator): boolean {
  const book = db
    .select({ addonItem: books.addonItem })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  const kept = book?.addonItem?.waitingChapters;
  if (!book?.addonItem || !kept) return false;
  const parts = db
    .select({ title: bookFiles.title, name: bookFiles.name, durationMs: bookFiles.durationMs })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .orderBy(asc(bookFiles.idx))
    .all();
  if (parts.some((p) => !(p.durationMs > 0))) return false;
  const built = partChapters(
    kept,
    parts.map((p) => ({ title: p.title ?? p.name, durationMs: p.durationMs })),
  );
  const rest = { ...book.addonItem };
  delete rest.waitingChapters;
  db.update(books).set({ addonItem: rest }).where(eq(books.id, bookId)).run();
  if (built.length === 0) return false;
  db.delete(chapters).where(eq(chapters.bookId, bookId)).run();
  db.insert(chapters)
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
  return true;
}

/** Whether the stream is live, and its MIME type, for the player (M154). */
function streamKind(stream: Stream): Pick<AddonItemRef, 'live' | 'mime'> {
  return {
    ...(isLive(stream) ? { live: true } : {}),
    ...(stream.mime ? { mime: stream.mime } : {}),
  };
}

/** Each part's transcripts by index, left out when no part has one. */
function transcriptsOf(stream: Stream): Pick<AddonItemRef, 'transcripts'> {
  if (!hasParts(stream)) return {};
  const lists = stream.parts.map((part) => part.transcripts ?? []);
  return lists.some((list) => list.length > 0) ? { transcripts: lists } : {};
}

/**
 * The transcripts of a streamed book's part (M136), shaped like a feed's, so the transcript screen
 * reads them as an episode's. Empty for any other file.
 */
export function partTranscripts(db: Db, bookId: string, fileLocation: string): FeedTranscript[] {
  const book = db
    .select({ addonItem: books.addonItem })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  const lists = book?.addonItem?.transcripts;
  if (!lists) return [];
  const file = db
    .select({ idx: bookFiles.idx, location: bookFiles.location })
    .from(bookFiles)
    .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.location, fileLocation)))
    .get();
  // Only the parts of the stream the list came with: another source's parts have other indexes.
  if (!file || file.location !== partLocation(book.addonItem?.sourceKey ?? '', file.idx)) return [];
  return (lists[file.idx] ?? []).map((t) => ({
    url: t.url,
    type: t.type,
    language: t.language ?? null,
    rel: null,
  }));
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
    .select({ id: books.id, location: books.location, addonItem: books.addonItem })
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
    // A live stream is never downloaded, whatever it says (M154).
    downloadable: stream.downloadable !== false && !isLive(stream),
    ...transcriptsOf(stream),
    ...streamKind(stream),
  };
  // `cover_path` is left out: a downloaded book keeps its downloaded cover when added again.
  const values = {
    kind: hasParts(stream) && parts.length > 1 ? ('folder' as const) : ('file' as const),
    source: 'addon' as const,
    rootId: null,
    title: meta.name,
    author: meta.author ?? null,
    coverUrl: meta.cover ?? null,
    addonItem,
    missingSince: null,
    updatedAt: now,
  };

  return db.transaction((tx) => {
    const found = existingBook(tx, location, stream.sourceKey);
    const bookId = found?.id ?? newId();
    const locations = parts.map((_, index) => partLocation(stream.sourceKey, index));
    const before = tx
      .select({
        location: bookFiles.location,
        uri: bookFiles.uri,
        durationMs: bookFiles.durationMs,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.idx))
      .all();
    // A part the add-on gives no length for keeps the one the player measured (M140).
    const filled = parts.map((part, i) => {
      const was = before[i];
      const keep =
        part.durationMs === 0 &&
        was !== undefined &&
        was.location === locations[i] &&
        was.uri === part.url &&
        was.durationMs > 0;
      return keep ? { ...part, durationMs: was.durationMs } : part;
    });
    const waiting = waitingChapters(meta, stream, filled);
    const bookRow = {
      ...values,
      addonItem: { ...addonItem, ...waiting },
      durationMs: knownTotal(filled.map((p) => p.durationMs)),
    };
    if (found?.location === location) {
      tx.update(books).set(bookRow).where(eq(books.id, bookId)).run();
    } else if (found) {
      // The same recording reached from another item (an Open Library work, say): keep the
      // title and cover the book was added with. Its parts' transcripts follow the stream.
      const kept = { ...(found.addonItem ?? addonItem) };
      delete kept.transcripts;
      delete kept.live;
      delete kept.mime;
      delete kept.waitingChapters;
      tx.update(books)
        .set({
          durationMs: bookRow.durationMs,
          missingSince: null,
          updatedAt: now,
          addonItem: { ...kept, ...transcriptsOf(stream), ...streamKind(stream), ...waiting },
        })
        .where(eq(books.id, bookId))
        .run();
    } else {
      tx.insert(books)
        .values({ id: bookId, location, addedAt: now, coverPath: null, ...bookRow })
        .run();
    }

    const sameParts =
      before.length === filled.length &&
      filled.every(
        (part, i) =>
          before[i]?.location === locations[i] &&
          before[i]?.uri === part.url &&
          before[i]?.durationMs === part.durationMs,
      );
    // The work's series rides on the first part's tags, where a server's series is kept too. The
    // item's own meta decides, also when it no longer names one (M115); a meta from another item
    // that plays the same recording only adds one.
    const series = 'series' in meta ? formatSeries(meta.series) : null;
    const ownItem = !found || found.location === location;
    for (const [idx, part] of filled.entries()) {
      const row = {
        ...(idx === 0 && (series || ownItem) ? { kindTags: { ...NO_KIND_TAGS, series } } : {}),
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

    // A login the stream asked for, kept apart and sealed; a stream without one clears it.
    saveStreamHeaders(tx, bookId, addonUrl, stream.headers, now);

    const built = chaptersOf(meta, stream, filled);
    // Chapters found from silences stay until the add-on brings chapters of its own, or the parts
    // change under them.
    tx.delete(chapters)
      .where(
        built.length > 0 || !sameParts
          ? eq(chapters.bookId, bookId)
          : and(eq(chapters.bookId, bookId), eq(chapters.found, false)),
      )
      .run();
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
export function removeStreamedBook(db: Db, bookId: string, now = Date.now()): boolean {
  return db.transaction((tx) => {
    const book = tx
      .select({ source: books.source, location: books.location })
      .from(books)
      .where(eq(books.id, bookId))
      .get();
    if (book?.source !== 'addon') return false;
    recordDeletion(tx, 'book', book.location, null, now);
    tx.delete(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), like(bookFiles.location, 'stream:%')))
      .run();
    tx.delete(streamHeaders).where(eq(streamHeaders.bookId, bookId)).run();
    tx.delete(books).where(eq(books.id, bookId)).run();
    return true;
  });
}
