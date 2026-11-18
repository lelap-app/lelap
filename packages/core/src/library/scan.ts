import { normalizeIds } from '@lelap/sdk';
import { and, eq, isNull } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import {
  bookFiles,
  type RemoteSource,
  bookmarks,
  books,
  chapters,
  libraryEntries,
  libraryRoots,
  progress,
  type StoredChapter,
} from '../schema';
import { addonRootLocation } from '../remote/addon';
import { audiobookshelfRootLocation } from '../remote/audiobookshelf';
import { jellyfinRootLocation } from '../remote/jellyfin';
import { netName, netRootLocation } from '../remote/netfs';
import { isSealed, secretBox } from '../secrets';
import { presentFiles } from './bookFiles';
import { buildChapters } from './chapters';
import { isAudioFile, type ScannedFile } from './files';
import { groupIntoBooks, withoutDownloads } from './group';
import { toBookPosition } from './timeline';

type TagKey =
  | 'durationMs'
  | 'title'
  | 'album'
  | 'artist'
  | 'albumArtist'
  | 'coverPath'
  | 'chapters'
  | 'ids'
  | 'kindTags';

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
    ids,
    kindTags,
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
      ...(ids !== undefined ? { ids } : {}),
      ...(kindTags !== undefined ? { kindTags } : {}),
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
  // The phone's own folder; servers are roots of their own (`addRemoteRoot`).
  const existing = db
    .select({ id: libraryRoots.id })
    .from(libraryRoots)
    .where(isNull(libraryRoots.remote))
    .get();
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

/**
 * Audio files that are new or changed since they were last read, so their tags need reading.
 * `readsIds`: the reader gives ISBN and ASIN tags, so files read before it did (M56) are read once
 * more. `readsKinds`: the reader gives genre and ISRC (M77), so single-file books read before it
 * did are read once more; only they can look like music.
 */
export function filesNeedingTags(
  db: Db,
  listed: ListedFile[],
  { readsIds = false, readsKinds = false }: { readsIds?: boolean; readsKinds?: boolean } = {},
): ListedFile[] {
  const audio = withoutDownloads(listed).filter((f) => isAudioFile(f.name));
  if (audio.length === 0) return [];
  const stored = new Map(
    db
      .select({
        location: bookFiles.location,
        size: bookFiles.size,
        modifiedAt: bookFiles.modifiedAt,
        durationMs: bookFiles.durationMs,
        ids: bookFiles.ids,
        kindTags: bookFiles.kindTags,
        bookId: bookFiles.bookId,
      })
      .from(bookFiles)
      .all()
      .map((f) => [f.location, f]),
  );
  const partsOf = new Map<string, number>();
  if (readsKinds) {
    for (const f of stored.values()) {
      if (f.bookId !== null) partsOf.set(f.bookId, (partsOf.get(f.bookId) ?? 0) + 1);
    }
  }
  return audio.filter((f) => {
    const s = stored.get(f.location);
    // Duration 0 means the last read failed or found nothing; try again.
    return (
      !s ||
      s.size !== f.size ||
      s.modifiedAt !== f.modifiedAt ||
      s.durationMs === 0 ||
      (readsIds && s.ids === null) ||
      (readsKinds && s.kindTags === null && s.bookId !== null && partsOf.get(s.bookId) === 1)
    );
  });
}

export type ApplyScanArgs = {
  rootId: string;
  rootLocation: string;
  /** A complete, successful listing of the folder. Never call this after a failed listing. */
  listed: ListedFile[];
  /** Tags for files that were read in this scan; others keep their stored tags. */
  tags: Map<string, FileTags>;
  /** Covers from image files, by folder location (`folderCoverFiles`'s `byFolder`). */
  folderCovers: Map<string, string>;
  /** Covers from images named after an audio file, by the audio file's location (`byFile`). */
  fileCovers?: Map<string, string>;
  now: number;
  newId: IdGenerator;
};

/** Brings the library in line with a listing of its folder. */
export function applyScan(db: Db, args: ApplyScanArgs): { added: number; missing: number } {
  const { rootId, rootLocation, listed, tags, folderCovers, fileCovers, now, newId } = args;

  return db.transaction((tx) => {
    const storedFiles = new Map(
      tx
        .select()
        .from(bookFiles)
        .all()
        .map((f) => [f.location, f]),
    );

    // A rescan of a big library changes almost nothing, so rows are only written when they
    // differ: 10,000 books are 30,000 file rows and as many chapters.
    const filesOfBook = new Map<string, StoredFile[]>();
    for (const f of storedFiles.values()) {
      if (f.bookId === null) continue;
      const list = filesOfBook.get(f.bookId);
      if (list) list.push(f);
      else filesOfBook.set(f.bookId, [f]);
    }
    for (const list of filesOfBook.values()) list.sort((a, b) => a.idx - b.idx);
    const changedFiles = new Set<string>();

    // A big folder's first scan adds thousands of rows; they go in together after step 2, which
    // takes about half the time of one insert each.
    const newFiles = new Map<string, typeof bookFiles.$inferInsert>();
    const newBooks: (typeof books.$inferInsert)[] = [];
    const newChapters: (typeof chapters.$inferInsert)[] = [];
    const moves: { location: string; bookId: string; idx: number }[] = [];

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
              ids: stored.ids,
              kindTags: stored.kindTags,
            }
          : NO_TAGS);
      scanned.push({ ...file, ...fileTags });
      const row = {
        rootId,
        uri: file.uri,
        downloadUri: file.downloadUri ?? null,
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
        ids: fileTags.ids == null ? null : normalizeIds(fileTags.ids),
        kindTags: fileTags.kindTags ?? null,
        missingSince: null,
        updatedAt: now,
      };
      if (stored && sameFile(stored, row)) continue;
      changedFiles.add(file.location);
      if (stored) {
        tx.update(bookFiles).set(row).where(eq(bookFiles.id, stored.id)).run();
      } else {
        newFiles.set(file.location, {
          id: newId(),
          location: file.location,
          bookId: null,
          idx: 0,
          ...row,
        });
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
    // Books whose files, their order or their tags changed: their chapters and places are redone.
    const changedBooks = new Set<string>();
    let added = 0;
    for (const draft of groupIntoBooks(rootLocation, scanned, folderCovers, fileCovers)) {
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
      const stored = bookByLocation.get(draft.location);
      let bookId = stored?.id;
      if (stored && bookId) {
        if (!sameBook(stored, values)) {
          tx.update(books).set(values).where(eq(books.id, bookId)).run();
        }
      } else {
        bookId = newId();
        newBooks.push({ id: bookId, location: draft.location, addedAt: now, ...values });
        added++;
      }
      keptBookIds.add(bookId);
      // Files missing since an earlier scan are no longer part of it; one that went missing in
      // this scan still counts, so the book is rebuilt once and then left alone.
      const before = (filesOfBook.get(bookId) ?? []).filter((f) => f.missingSince === null);
      const unchanged =
        before.length === draft.files.length &&
        draft.files.every(
          (f, idx) => before[idx]?.location === f.location && !changedFiles.has(f.location),
        );
      // A change to buildChapters therefore reaches existing books only with a migration that
      // clears their chapters, or when their files change.
      if (unchanged) continue;
      changedBooks.add(bookId);
      for (const [idx, file] of draft.files.entries()) {
        const pending = newFiles.get(file.location);
        if (pending) Object.assign(pending, { bookId, idx });
        else moves.push({ location: file.location, bookId, idx });
      }
      if (stored) tx.delete(chapters).where(eq(chapters.bookId, bookId)).run();
      for (const [idx, c] of buildChapters(draft.files).entries()) {
        newChapters.push({ id: newId(), bookId, idx, ...c, updatedAt: now });
      }
    }
    // Books first: files and chapters point at them.
    for (const chunk of chunks(newBooks)) tx.insert(books).values(chunk).run();
    for (const chunk of chunks([...newFiles.values()])) tx.insert(bookFiles).values(chunk).run();
    for (const { location, bookId, idx } of moves) {
      tx.update(bookFiles).set({ bookId, idx }).where(eq(bookFiles.location, location)).run();
    }
    for (const chunk of chunks(newChapters)) tx.insert(chapters).values(chunk).run();

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

    // A place in a book this scan kept as it was stays as it is.
    const settled = (bookId: string, target: string) =>
      target === bookId && keptBookIds.has(bookId) && !changedBooks.has(bookId);

    for (const snapshot of tx.select().from(progress).all()) {
      if (settled(snapshot.bookId, fileBook.get(snapshot.fileLocation) ?? '')) continue;
      // Re-read: an earlier move in this loop may have replaced the row.
      const row = tx
        .select()
        .from(progress)
        .where(eqProgress(snapshot.profileId, snapshot.bookId))
        .get();
      if (!row || row.fileLocation !== snapshot.fileLocation) continue;
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
      }
    }

    for (const row of tx.select().from(bookmarks).all()) {
      const target = fileBook.get(row.fileLocation);
      if (!target || settled(row.bookId, target)) continue;
      const bookPositionMs = toBookPosition(timeline(target), row.fileLocation, row.filePositionMs);
      tx.update(bookmarks)
        .set({ bookId: target, bookPositionMs })
        .where(eq(bookmarks.id, row.id))
        .run();
    }

    // 4. Books not produced by this scan: regrouped away if their present files moved on, else
    // missing (kept, with their places, until the files come back). A regrouped book hands
    // everything still on it to the books its files went to before it is deleted, so nothing is
    // lost to ON DELETE CASCADE (for example a place in a file that is missing right now).
    let missing = 0;
    for (const book of storedBooks) {
      if (keptBookIds.has(book.id)) continue;
      const targets = [
        ...new Set((filesOfBook.get(book.id) ?? []).flatMap((f) => fileBook.get(f.location) ?? [])),
      ];
      const [first] = targets;
      if (first === undefined) {
        if (book.missingSince === null) {
          tx.update(books)
            .set({ missingSince: now, updatedAt: now })
            .where(eq(books.id, book.id))
            .run();
          missing++;
        }
        continue;
      }
      handOver(tx, book.id, first, targets, now);
      tx.delete(books).where(eq(books.id, book.id)).run();
    }

    tx.update(libraryRoots)
      .set({ lastScanAt: now, updatedAt: now })
      .where(eq(libraryRoots.id, rootId))
      .run();
    return { added, missing };
  });
}

// 200 file rows are about 5,000 bound values, well below SQLite's limit of 32,766.
function* chunks<T>(rows: T[], size = 200): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

type StoredFile = typeof bookFiles.$inferSelect;
type StoredBook = typeof books.$inferSelect;

const sameChapters = (a: StoredChapter[], b: StoredChapter[]) =>
  a.length === b.length &&
  a.every((c, i) => c.title === b[i]?.title && c.startMs === b[i]?.startMs);

function sameFile(
  stored: StoredFile,
  row: Omit<StoredFile, 'id' | 'location' | 'bookId' | 'idx' | 'downloadPath'>,
): boolean {
  return (
    stored.missingSince === null &&
    stored.rootId === row.rootId &&
    stored.uri === row.uri &&
    stored.downloadUri === row.downloadUri &&
    stored.relPath === row.relPath &&
    stored.name === row.name &&
    stored.size === row.size &&
    stored.modifiedAt === row.modifiedAt &&
    stored.durationMs === row.durationMs &&
    stored.title === row.title &&
    stored.album === row.album &&
    stored.artist === row.artist &&
    stored.albumArtist === row.albumArtist &&
    stored.coverPath === row.coverPath &&
    JSON.stringify(stored.ids) === JSON.stringify(row.ids) &&
    JSON.stringify(stored.kindTags) === JSON.stringify(row.kindTags) &&
    sameChapters(stored.chaptersJson, row.chaptersJson)
  );
}

function sameBook(
  stored: StoredBook,
  values: Pick<
    StoredBook,
    'rootId' | 'kind' | 'title' | 'author' | 'coverPath' | 'durationMs' | 'missingSince'
  >,
): boolean {
  return (
    stored.missingSince === null &&
    stored.rootId === values.rootId &&
    stored.kind === values.kind &&
    stored.title === values.title &&
    stored.author === values.author &&
    stored.coverPath === values.coverPath &&
    stored.durationMs === values.durationMs
  );
}

const eqProgress = (profileId: string, bookId: string) =>
  and(eq(progress.profileId, profileId), eq(progress.bookId, bookId));

/** Moves what is left on a regrouped book: places and bookmarks to `first`, entries to all. */
function handOver(tx: Db, from: string, first: string, targets: string[], now: number): void {
  for (const row of tx.select().from(progress).where(eq(progress.bookId, from)).all()) {
    const existing = tx.select().from(progress).where(eqProgress(row.profileId, first)).get();
    if (existing && existing.updatedAt >= row.updatedAt) continue;
    tx.delete(progress).where(eqProgress(row.profileId, first)).run();
    tx.update(progress).set({ bookId: first }).where(eqProgress(row.profileId, from)).run();
  }
  tx.update(bookmarks).set({ bookId: first }).where(eq(bookmarks.bookId, from)).run();
  for (const entry of tx
    .select()
    .from(libraryEntries)
    .where(eq(libraryEntries.bookId, from))
    .all()) {
    for (const bookId of targets) {
      tx.insert(libraryEntries)
        .values({ ...entry, bookId, updatedAt: now })
        .onConflictDoNothing()
        .run();
    }
  }
}

/** The library folder on this phone, if one was chosen. */
export function localRoot(db: Db) {
  return db.select().from(libraryRoots).where(isNull(libraryRoots.remote)).get() ?? null;
}

const secretOf = (remote: RemoteSource) =>
  remote.type === 'webdav' || remote.type === 'smb'
    ? remote.password
    : remote.type === 'jellyfin' || remote.type === 'audiobookshelf'
      ? remote.token
      : remote.type === 'addon' || remote.type === 'sftp'
        ? remote.secret
        : remote.secretAccessKey;

const withSecret = (remote: RemoteSource, secret: string): RemoteSource =>
  remote.type === 'webdav' || remote.type === 'smb'
    ? { ...remote, password: secret }
    : remote.type === 'jellyfin' || remote.type === 'audiobookshelf'
      ? { ...remote, token: secret }
      : remote.type === 'addon' || remote.type === 'sftp'
        ? { ...remote, secret }
        : { ...remote, secretAccessKey: secret };

/**
 * Every library root: the phone's folder and each server, with its password or secret key opened.
 * `needsLogin` marks a server whose secret this device can't open (a backup restored on a new
 * phone); its secret is empty until it is entered again.
 */
export function listRoots(db: Db) {
  const box = secretBox();
  return db
    .select()
    .from(libraryRoots)
    .all()
    .map((row) => {
      if (!row.remote) return { ...row, needsLogin: false };
      const secret = box.open(secretOf(row.remote));
      return {
        ...row,
        remote: withSecret(row.remote, secret ?? ''),
        needsLogin: secret === null,
      };
    });
}

/** At start: seals server secrets stored before sealing existed. */
export function sealRemoteRoots(db: Db, now: number): void {
  const box = secretBox();
  if (!box.sealing) return;
  for (const row of db.select().from(libraryRoots).all()) {
    if (!row.remote || isSealed(secretOf(row.remote))) continue;
    db.update(libraryRoots)
      .set({ remote: withSecret(row.remote, box.seal(secretOf(row.remote))), updatedAt: now })
      .where(eq(libraryRoots.id, row.id))
      .run();
  }
}

/**
 * Marks an Audiobookshelf server whose API key was refused, or clears the mark once a request
 * with the key worked. The sealed key is left as it is. Returns whether anything changed.
 */
export function setAudiobookshelfKeyRefused(
  db: Db,
  rootId: string,
  refused: boolean,
  now: number,
): boolean {
  const row = db.select().from(libraryRoots).where(eq(libraryRoots.id, rootId)).get();
  const remote = row?.remote;
  if (remote?.type !== 'audiobookshelf' || (remote.keyRefused ?? false) === refused) return false;
  const rest = { ...remote };
  delete rest.keyRefused;
  db.update(libraryRoots)
    .set({ remote: refused ? { ...rest, keyRefused: true } : rest, updatedAt: now })
    .where(eq(libraryRoots.id, rootId))
    .run();
  return true;
}

/**
 * Marks an SMB or SFTP server whose login or host key the last scan was refused for, or clears the
 * mark once a scan worked; Settings shows it. The sealed login is left as it is. Returns whether
 * anything changed.
 */
export function setNetServerRefused(
  db: Db,
  rootId: string,
  refused: 'login' | 'host-key' | null,
  now: number,
): boolean {
  const row = db.select().from(libraryRoots).where(eq(libraryRoots.id, rootId)).get();
  const remote = row?.remote;
  if (remote?.type !== 'smb' && remote?.type !== 'sftp') return false;
  if ((remote.refused ?? null) === refused) return false;
  if (remote.type === 'smb' && refused === 'host-key') return false;
  const rest = { ...remote };
  delete rest.refused;
  db.update(libraryRoots)
    .set({ remote: refused ? ({ ...rest, refused } as RemoteSource) : rest, updatedAt: now })
    .where(eq(libraryRoots.id, rootId))
    .run();
  return true;
}

/** Changes a server's settings, such as a password entered again; its books stay. */
export function updateRemoteRoot(db: Db, rootId: string, remote: RemoteSource, now: number): void {
  db.update(libraryRoots)
    .set({
      remote: withSecret(remote, secretBox().seal(secretOf(remote))),
      name: remoteName(remote),
      updatedAt: now,
    })
    .where(eq(libraryRoots.id, rootId))
    .run();
}

/** A server's display name: its host and folder, or bucket and prefix. */
export function remoteName(remote: RemoteSource): string {
  if (remote.type === 'addon') return remote.name;
  if (remote.type === 'smb' || remote.type === 'sftp') return netName(remote);
  if (remote.type === 's3') return `${remote.bucket}${remote.prefix ? `/${remote.prefix}` : ''}`;
  if (remote.type === 'jellyfin') {
    return `${remote.username}@${jellyfinRootLocation(remote.url).slice('jellyfin:'.length)}`;
  }
  if (remote.type === 'audiobookshelf') {
    const place = audiobookshelfRootLocation(remote.url).slice('audiobookshelf:'.length);
    return `${remote.username}@${place}`;
  }
  try {
    const url = new URL(remote.url);
    return `${url.host}${decodeURIComponent(url.pathname)}`.replace(/\/$/, '');
  } catch {
    return remote.url;
  }
}

/** Where a server's books live: `webdav:…`, `smb:…`, `sftp:…`, `s3:…`, `jellyfin:…` and so on. */
export function remoteLocation(remote: RemoteSource): string {
  if (remote.type === 'addon') return addonRootLocation(remote.key);
  if (remote.type === 'smb' || remote.type === 'sftp') return netRootLocation(remote);
  if (remote.type === 's3') return `s3:${remote.bucket}/${remote.prefix}`;
  if (remote.type === 'jellyfin') return jellyfinRootLocation(remote.url);
  if (remote.type === 'audiobookshelf') return audiobookshelfRootLocation(remote.url);
  return `webdav:${remoteName(remote)}`;
}

/** Adds a server, a bucket or an add-on's library as a library root; returns its ID. */
export function addRemoteRoot(
  db: Db,
  remote: RemoteSource,
  now: number,
  newId: IdGenerator,
): string {
  const id = newId();
  const location = remoteLocation(remote);
  db.insert(libraryRoots)
    .values({
      id,
      uri: location,
      name: remoteName(remote),
      location,
      remote: withSecret(remote, secretBox().seal(secretOf(remote))),
      addedAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/**
 * Removes a server and the books found on it, with their places. Played and downloaded books go
 * too: they live on that server.
 */
export function removeRemoteRoot(db: Db, rootId: string): void {
  db.transaction((tx) => {
    const ids = tx
      .select({ id: books.id })
      .from(books)
      .where(eq(books.rootId, rootId))
      .all()
      .map((b) => b.id);
    for (const id of ids) tx.delete(books).where(eq(books.id, id)).run();
    tx.delete(bookFiles).where(eq(bookFiles.rootId, rootId)).run();
    tx.delete(libraryRoots)
      .where(and(eq(libraryRoots.id, rootId)))
      .run();
  });
}
