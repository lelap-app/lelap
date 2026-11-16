import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import {
  bookFiles,
  bookmarks,
  books,
  chapters,
  libraryEntries,
  libraryRoots,
  progress,
} from '../schema';
import { presentFiles } from './bookFiles';
import { buildChapters } from './chapters';
import { isAudioFile, type ScannedFile } from './files';
import { groupIntoBooks } from './group';
import { toBookPosition } from './timeline';

type TagKey =
  'durationMs' | 'title' | 'album' | 'artist' | 'albumArtist' | 'coverPath' | 'chapters';

/** A file as listed from the folder, before its tags are read. */
export type ListedFile = Omit<ScannedFile, TagKey>;
export type FileTags = Pick<ScannedFile, TagKey>;

const NO_TAGS: FileTags = {
  durationMs: 0,
  title: null,
  album: null,
  artist: null,
  albumArtist: null,
  coverPath: null,
  chapters: [],
};

/** Splits scanned files into a listing and their tags; the shape `applyScan` takes. */
export function splitScanned(files: ScannedFile[]): {
  listed: ListedFile[];
  tags: Map<string, FileTags>;
} {
  const listed: ListedFile[] = [];
  const tags = new Map<string, FileTags>();
  for (const {
    durationMs,
    title,
    album,
    artist,
    albumArtist,
    coverPath,
    chapters: c,
    ...rest
  } of files) {
    listed.push(rest);
    tags.set(rest.location, {
      durationMs,
      title,
      album,
      artist,
      albumArtist,
      coverPath,
      chapters: c,
    });
  }
  return { listed, tags };
}

/**
 * Makes `folder` the library folder. M2 has one: choosing another replaces it, keeping its ID so
 * books found again under the new folder keep theirs.
 */
export function upsertRoot(
  db: Db,
  folder: { uri: string; name: string; location: string },
  now: number,
  newId: IdGenerator,
): string {
  const existing = db.select({ id: libraryRoots.id }).from(libraryRoots).get();
  if (existing) {
    db.update(libraryRoots)
      .set({ ...folder, updatedAt: now })
      .where(eq(libraryRoots.id, existing.id))
      .run();
    return existing.id;
  }
  const id = newId();
  db.insert(libraryRoots)
    .values({ id, ...folder, addedAt: now, updatedAt: now })
    .run();
  return id;
}

/** Audio files that are new or changed since they were last read, so their tags need reading. */
export function filesNeedingTags(db: Db, listed: ListedFile[]): ListedFile[] {
  const audio = listed.filter((f) => isAudioFile(f.name));
  if (audio.length === 0) return [];
  const stored = new Map(
    db
      .select({
        location: bookFiles.location,
        size: bookFiles.size,
        modifiedAt: bookFiles.modifiedAt,
      })
      .from(bookFiles)
      .all()
      .map((f) => [f.location, f]),
  );
  return audio.filter((f) => {
    const s = stored.get(f.location);
    return !s || s.size !== f.size || s.modifiedAt !== f.modifiedAt;
  });
}

export type ApplyScanArgs = {
  rootId: string;
  rootLocation: string;
  /** A complete, successful listing of the folder. Never call this after a failed listing. */
  listed: ListedFile[];
  /** Tags for files that were read in this scan; others keep their stored tags. */
  tags: Map<string, FileTags>;
  folderCovers: Map<string, string>;
  now: number;
  newId: IdGenerator;
};

/** Brings the library in line with a listing of its folder. */
export function applyScan(db: Db, args: ApplyScanArgs): { added: number; missing: number } {
  const { rootId, rootLocation, listed, tags, folderCovers, now, newId } = args;

  return db.transaction((tx) => {
    const storedFiles = new Map(
      tx
        .select()
        .from(bookFiles)
        .all()
        .map((f) => [f.location, f]),
    );

    // 1. Files: upsert what is listed, mark the rest of this root missing.
    const scanned: ScannedFile[] = [];
    const listedLocations = new Set<string>();
    for (const file of listed) {
      if (!isAudioFile(file.name)) continue;
      listedLocations.add(file.location);
      const stored = storedFiles.get(file.location);
      const fileTags =
        tags.get(file.location) ??
        (stored
          ? {
              durationMs: stored.durationMs,
              title: stored.title,
              album: stored.album,
              artist: stored.artist,
              albumArtist: stored.albumArtist,
              coverPath: stored.coverPath,
              chapters: stored.chaptersJson,
            }
          : NO_TAGS);
      scanned.push({ ...file, ...fileTags });
      const row = {
        rootId,
        uri: file.uri,
        relPath: file.relPath,
        name: file.name,
        size: file.size,
        modifiedAt: file.modifiedAt,
        durationMs: fileTags.durationMs,
        title: fileTags.title,
        album: fileTags.album,
        artist: fileTags.artist,
        albumArtist: fileTags.albumArtist,
        coverPath: fileTags.coverPath,
        chaptersJson: fileTags.chapters,
        missingSince: null,
        updatedAt: now,
      };
      if (stored) {
        tx.update(bookFiles).set(row).where(eq(bookFiles.id, stored.id)).run();
      } else {
        tx.insert(bookFiles)
          .values({ id: newId(), location: file.location, bookId: null, idx: 0, ...row })
          .run();
      }
    }
    for (const stored of storedFiles.values()) {
      if (
        stored.rootId === rootId &&
        !listedLocations.has(stored.location) &&
        stored.missingSince === null
      ) {
        tx.update(bookFiles)
          .set({ missingSince: now, updatedAt: now })
          .where(eq(bookFiles.id, stored.id))
          .run();
      }
    }

    // 2. Books: one per draft, matched by location so IDs survive rescans.
    const storedBooks = tx.select().from(books).where(eq(books.rootId, rootId)).all();
    const bookByLocation = new Map(storedBooks.map((b) => [b.location, b]));
    const keptBookIds = new Set<string>();
    let added = 0;
    for (const draft of groupIntoBooks(rootLocation, scanned, folderCovers)) {
      const values = {
        rootId,
        kind: draft.kind,
        title: draft.title,
        author: draft.author,
        coverPath: draft.coverPath,
        durationMs: draft.files.reduce((sum, f) => sum + Math.max(0, f.durationMs), 0),
        missingSince: null,
        updatedAt: now,
      };
      let bookId = bookByLocation.get(draft.location)?.id;
      if (bookId) {
        tx.update(books).set(values).where(eq(books.id, bookId)).run();
      } else {
        bookId = newId();
        tx.insert(books)
          .values({ id: bookId, location: draft.location, addedAt: now, ...values })
          .run();
        added++;
      }
      keptBookIds.add(bookId);
      for (const [idx, file] of draft.files.entries()) {
        tx.update(bookFiles)
          .set({ bookId, idx })
          .where(eq(bookFiles.location, file.location))
          .run();
      }
      tx.delete(chapters).where(eq(chapters.bookId, bookId)).run();
      const built = buildChapters(draft.files);
      if (built.length > 0) {
        tx.insert(chapters)
          .values(built.map((c, idx) => ({ id: newId(), bookId, idx, ...c, updatedAt: now })))
          .run();
      }
    }

    // 3. Places follow their file into whichever book now holds it.
    const fileBook = new Map(
      tx
        .select({
          location: bookFiles.location,
          bookId: bookFiles.bookId,
          missingSince: bookFiles.missingSince,
        })
        .from(bookFiles)
        .all()
        .filter((f) => f.missingSince === null && f.bookId !== null)
        .map((f) => [f.location, f.bookId as string]),
    );
    const timelines = new Map<string, ReturnType<typeof presentFiles>>();
    const timeline = (bookId: string) => {
      let files = timelines.get(bookId);
      if (!files) {
        files = presentFiles(tx, bookId);
        timelines.set(bookId, files);
      }
      return files;
    };

    for (const row of tx.select().from(progress).all()) {
      const target = fileBook.get(row.fileLocation);
      if (!target) continue;
      const bookPositionMs = toBookPosition(timeline(target), row.fileLocation, row.filePositionMs);
      if (target === row.bookId) {
        tx.update(progress)
          .set({ bookPositionMs })
          .where(eqProgress(row.profileId, row.bookId))
          .run();
        continue;
      }
      const existing = tx.select().from(progress).where(eqProgress(row.profileId, target)).get();
      if (!existing || existing.updatedAt < row.updatedAt) {
        tx.delete(progress).where(eqProgress(row.profileId, target)).run();
        tx.update(progress)
          .set({ bookId: target, bookPositionMs })
          .where(eqProgress(row.profileId, row.bookId))
          .run();
        const entry = tx
          .select()
          .from(libraryEntries)
          .where(eqEntry(row.profileId, row.bookId))
          .get();
        if (entry) {
          tx.insert(libraryEntries)
            .values({ ...entry, bookId: target, updatedAt: now })
            .onConflictDoNothing()
            .run();
        }
      }
    }

    for (const row of tx.select().from(bookmarks).all()) {
      const target = fileBook.get(row.fileLocation);
      if (!target) continue;
      const bookPositionMs = toBookPosition(timeline(target), row.fileLocation, row.filePositionMs);
      tx.update(bookmarks)
        .set({ bookId: target, bookPositionMs })
        .where(eq(bookmarks.id, row.id))
        .run();
    }

    // 4. Books not produced by this scan: regrouped away if their present files moved on, else
    // missing (kept, with their places, until the files come back).
    const regrouped: string[] = [];
    let missing = 0;
    for (const book of storedBooks) {
      if (keptBookIds.has(book.id)) continue;
      const own = [...storedFiles.values()].filter((f) => f.bookId === book.id);
      if (own.some((f) => fileBook.has(f.location))) {
        regrouped.push(book.id);
      } else if (book.missingSince === null) {
        tx.update(books)
          .set({ missingSince: now, updatedAt: now })
          .where(eq(books.id, book.id))
          .run();
        missing++;
      }
    }
    if (regrouped.length > 0) tx.delete(books).where(inArray(books.id, regrouped)).run();

    tx.update(libraryRoots)
      .set({ lastScanAt: now, updatedAt: now })
      .where(eq(libraryRoots.id, rootId))
      .run();
    return { added, missing };
  });
}

const eqProgress = (profileId: string, bookId: string) =>
  and(eq(progress.profileId, profileId), eq(progress.bookId, bookId));
const eqEntry = (profileId: string, bookId: string) =>
  and(eq(libraryEntries.profileId, profileId), eq(libraryEntries.bookId, bookId));
