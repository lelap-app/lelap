import type { Meta } from '@lelap/sdk';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';

import type { Db } from './db';
import { bookFiles, books, downloads, libraryRoots } from './schema';

/** What the native worker downloads for one book. Files land in `<directory>/<bookId>/`. */
export type DownloadPlan = {
  bookId: string;
  title: string;
  /** `rootId` is set for files on a server, so the app can sign them or add the login. */
  files: { url: string; name: string; size: number; rootId: string | null }[];
  cover: { url: string; name: string } | null;
  /** 0 when the add-on gave no sizes. */
  bytesTotal: number;
};

/** A download as the native worker sees it. Same shape as `DownloadStatus` in `@lelap/download`. */
export type NativeDownloadStatus = {
  bookId: string;
  state: 'waiting' | 'running' | 'done' | 'failed' | 'stopped';
  bytesDone: number;
  bytesTotal: number;
  /** Names of the files that are complete on disk. */
  files: string[];
  cover: string | null;
  /** Where each finished file is read from, when not `<directory>/<bookId>/<name>`. */
  paths?: Record<string, string>;
  /** The folder holding the book can't be reached, such as an SD card that was taken out. */
  unavailable?: boolean;
  /** A move left copies in the old folder, deleted once the player no longer reads them. */
  oldCopies?: boolean;
  error: string | null;
};

/** A URI the player and image views read: content URIs as they are, paths as `file://`. */
export const localFileUri = (path: string): string =>
  path.startsWith('content://') ? path : `file://${path}`;

export class DownloadError extends Error {}

const EXTENSION = /\.([a-z0-9]{1,5})$/i;

function extensionOf(url: string, fallback: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not a URL we can parse; look at the string as it is.
  }
  const match = EXTENSION.exec(path);
  return match?.[1] ? `.${match[1].toLowerCase()}` : fallback;
}

/** `001.mp3`: numbered, so the folder lists in play order and names never collide. */
export const partFileName = (idx: number, url: string) =>
  `${String(idx + 1).padStart(3, '0')}${extensionOf(url, '.audio')}`;

export const coverFileName = (url: string) => `cover${extensionOf(url, '.jpg')}`;

/** The parts and cover to download for a streamed book. */
export function planDownload(db: Db, bookId: string): DownloadPlan {
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) throw new DownloadError('This book is not in the library.');
  const onServer =
    book.rootId !== null &&
    db
      .select({ remote: libraryRoots.remote })
      .from(libraryRoots)
      .where(eq(libraryRoots.id, book.rootId))
      .get()?.remote != null;
  if (book.source === 'local' && !onServer) {
    throw new DownloadError('This book is already on the phone.');
  }
  if (book.addonItem?.downloadable === false)
    throw new DownloadError('This source does not allow downloads.');
  const parts = db
    .select({
      idx: bookFiles.idx,
      uri: bookFiles.uri,
      size: bookFiles.size,
      rootId: bookFiles.rootId,
    })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .orderBy(asc(bookFiles.idx))
    .all();
  if (parts.length === 0) throw new DownloadError('This book has no files to download.');
  const files = parts.map((p) => ({
    url: p.uri,
    // A server file's name comes from its path, not from a signed link.
    name: partFileName(p.idx, p.uri.split('?')[0] ?? p.uri),
    size: p.size,
    rootId: p.rootId,
  }));
  return {
    bookId,
    title: book.title,
    files,
    cover: book.coverUrl ? { url: book.coverUrl, name: coverFileName(book.coverUrl) } : null,
    bytesTotal: files.reduce((sum, f) => sum + f.size, 0),
  };
}

/** Records that a download was asked for (or retried). Keeps an earlier snapshot without `meta`. */
export function requestDownload(db: Db, plan: DownloadPlan, meta: Meta | null, now: number): void {
  const set = {
    state: 'queued' as const,
    bytesTotal: plan.bytesTotal,
    error: null,
    completedAt: null,
    updatedAt: now,
    ...(meta ? { meta } : {}),
  };
  db.insert(downloads)
    .values({ bookId: plan.bookId, requestedAt: now, meta, ...set })
    .onConflictDoUpdate({ target: downloads.bookId, set })
    .run();
}

export type DownloadFold = {
  /** Books whose stored download changed. */
  changed: string[];
  /** Folders on disk with no download in the database, to delete. */
  orphans: string[];
};

/**
 * Folds the native worker's statuses into the database: finished parts get their paths, the cover
 * its path, failures their message. Like the position journal, the worker never writes SQLite.
 */
export function applyDownloadStatuses(
  db: Db,
  directory: string,
  statuses: NativeDownloadStatus[],
  now: number,
): DownloadFold {
  const changed: string[] = [];
  const orphans: string[] = [];
  db.transaction((tx) => {
    for (const status of statuses) {
      const row = tx.select().from(downloads).where(eq(downloads.bookId, status.bookId)).get();
      if (!row) {
        // Files on a missing SD card are left alone; they are deleted once it is back.
        if (!status.unavailable) orphans.push(status.bookId);
        continue;
      }
      if (status.unavailable && row.state === 'done') {
        // Until the folder is back the book streams, where it can, and keeps its download.
        const onDisk = and(eq(bookFiles.bookId, status.bookId), isNotNull(bookFiles.downloadPath));
        if (!tx.select({ id: bookFiles.id }).from(bookFiles).where(onDisk).get()) continue;
        tx.update(bookFiles).set({ downloadPath: null, updatedAt: now }).where(onDisk).run();
        tx.update(books)
          .set({ coverPath: null, updatedAt: now })
          .where(and(eq(books.id, status.bookId), ne(books.source, 'local')))
          .run();
        changed.push(status.bookId);
        continue;
      }
      if (status.state === 'done') {
        const folder = `${directory}/${status.bookId}`;
        const pathOf = (name: string) => status.paths?.[name] ?? `${folder}/${name}`;
        const done = new Set(status.files);
        let moved = false;
        const parts = tx
          .select({
            id: bookFiles.id,
            idx: bookFiles.idx,
            uri: bookFiles.uri,
            downloadPath: bookFiles.downloadPath,
          })
          .from(bookFiles)
          .where(eq(bookFiles.bookId, status.bookId))
          .all();
        // A finished book is folded again when its files moved to another folder or came back.
        for (const part of parts) {
          const name = partFileName(part.idx, part.uri);
          if (!done.has(name) || part.downloadPath === pathOf(name)) continue;
          tx.update(bookFiles)
            .set({ downloadPath: pathOf(name), updatedAt: now })
            .where(eq(bookFiles.id, part.id))
            .run();
          moved = true;
        }
        if (status.cover) {
          const cover = pathOf(status.cover);
          const book = tx
            .select({ coverPath: books.coverPath })
            .from(books)
            .where(eq(books.id, status.bookId))
            .get();
          if (book && book.coverPath !== cover) {
            tx.update(books)
              .set({ coverPath: cover, updatedAt: now })
              .where(eq(books.id, status.bookId))
              .run();
            moved = true;
          }
        }
        if (row.state === 'done') {
          if (moved) changed.push(status.bookId);
          continue;
        }
        tx.update(downloads)
          .set({
            state: 'done',
            bytesTotal: status.bytesTotal || row.bytesTotal,
            error: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(downloads.bookId, status.bookId))
          .run();
        changed.push(status.bookId);
      } else if (status.state === 'failed' || status.state === 'stopped') {
        const error = status.error ?? 'The download stopped.';
        if (row.state === 'failed' && row.error === error) continue;
        tx.update(downloads)
          .set({ state: 'failed', error, updatedAt: now })
          .where(eq(downloads.bookId, status.bookId))
          .run();
        changed.push(status.bookId);
      } else if (row.state === 'failed') {
        // Running again, after the rules changed or WorkManager retried.
        tx.update(downloads)
          .set({ state: 'queued', error: null, updatedAt: now })
          .where(eq(downloads.bookId, status.bookId))
          .run();
        changed.push(status.bookId);
      }
    }
  });
  return { changed, orphans };
}

/** Forgets a download: parts stream again and the add-on's cover comes back. */
export function removeDownload(db: Db, bookId: string, now: number): void {
  db.transaction((tx) => {
    tx.update(bookFiles)
      .set({ downloadPath: null, updatedAt: now })
      .where(eq(bookFiles.bookId, bookId))
      .run();
    tx.update(books)
      .set({ coverPath: null, updatedAt: now })
      .where(and(eq(books.id, bookId), ne(books.source, 'local')))
      .run();
    tx.delete(downloads).where(eq(downloads.bookId, bookId)).run();
  });
}

export type DownloadEntry = {
  bookId: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  coverUrl: string | null;
  state: 'queued' | 'done' | 'failed';
  bytesTotal: number;
  error: string | null;
  requestedAt: number;
  completedAt: number | null;
};

/** Every download, newest first. */
export function listDownloads(db: Db, bookIds?: string[]): DownloadEntry[] {
  return db
    .select({
      bookId: downloads.bookId,
      title: books.title,
      author: books.author,
      coverPath: books.coverPath,
      coverUrl: books.coverUrl,
      state: downloads.state,
      bytesTotal: downloads.bytesTotal,
      error: downloads.error,
      requestedAt: downloads.requestedAt,
      completedAt: downloads.completedAt,
    })
    .from(downloads)
    .innerJoin(books, eq(books.id, downloads.bookId))
    .where(bookIds ? inArray(downloads.bookId, bookIds) : undefined)
    .all()
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

export function getDownload(db: Db, bookId: string): DownloadEntry | null {
  return listDownloads(db, [bookId])[0] ?? null;
}

/** The add-on's metadata saved with a download, for showing the book offline. */
export function downloadSnapshot(db: Db, bookId: string): Meta | null {
  return (
    db.select({ meta: downloads.meta }).from(downloads).where(eq(downloads.bookId, bookId)).get()
      ?.meta ?? null
  );
}
