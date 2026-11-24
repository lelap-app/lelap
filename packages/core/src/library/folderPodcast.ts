import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import {
  bookFiles,
  books,
  libraryEntries,
  type PartState,
  type PartStates,
  progress,
} from '../schema';
import { presentFiles } from './bookFiles';
import { episodeCode } from './episodeCode';
import { type FilePosition, toBookPosition } from './timeline';

/**
 * A book of episode files shown as a podcast (M157). The book stays one book with one place, so
 * the player, bookmarks and sync work as before; each file also keeps its own played mark and
 * the place it was left at, in the profile's library entry.
 */

/** A file left this close to its end counts as played when the next one starts. */
export const NEAR_END_MS = 30_000;

export type EpisodeStatus = 'played' | 'started' | 'none';

export type FolderEpisode = {
  index: number;
  location: string;
  title: string;
  durationMs: number;
  season: number | null;
  number: number | null;
  status: EpisodeStatus;
  /** Where it was left; for the file the book's place is in, that place. */
  positionMs: number;
  /** Whether the book's place is in this file. */
  current: boolean;
};

type Place = { fileLocation: string; filePositionMs: number };

const entryKey = (profileId: string, bookId: string) =>
  and(eq(libraryEntries.profileId, profileId), eq(libraryEntries.bookId, bookId));

function readEntry(db: Db, profileId: string, bookId: string) {
  const row = db
    .select({
      asPodcast: libraryEntries.asPodcast,
      parts: libraryEntries.parts,
      finishedAt: libraryEntries.finishedAt,
    })
    .from(libraryEntries)
    .where(entryKey(profileId, bookId))
    .get();
  return {
    asPodcast: row?.asPodcast ?? false,
    parts: { ...(row?.parts ?? {}) },
    finishedAt: row?.finishedAt ?? null,
  };
}

function writeEntry(
  db: Db,
  profileId: string,
  bookId: string,
  set: { asPodcast?: boolean; parts?: PartStates; finishedAt?: number | null },
  now: number,
): void {
  db.insert(libraryEntries)
    .values({ profileId, bookId, ...set, updatedAt: now })
    .onConflictDoUpdate({
      target: [libraryEntries.profileId, libraryEntries.bookId],
      set: { ...set, updatedAt: now },
    })
    .run();
}

function readPlace(db: Db, profileId: string, bookId: string): Place | null {
  return (
    db
      .select({ fileLocation: progress.fileLocation, filePositionMs: progress.filePositionMs })
      .from(progress)
      .where(and(eq(progress.profileId, profileId), eq(progress.bookId, bookId)))
      .get() ?? null
  );
}

function writePlace(
  db: Db,
  profileId: string,
  bookId: string,
  files: { location: string; durationMs: number }[],
  target: { location: string; positionMs: number },
  now: number,
): void {
  const values = {
    fileLocation: target.location,
    filePositionMs: Math.max(0, target.positionMs),
    bookPositionMs: toBookPosition(files, target.location, target.positionMs),
    updatedAt: now,
  };
  db.insert(progress)
    .values({ profileId, bookId, ...values })
    .onConflictDoUpdate({ target: [progress.profileId, progress.bookId], set: values })
    .run();
}

const isPlayed = (parts: PartStates, location: string) =>
  (parts[location]?.played ?? null) !== null;

/** Finished once every present file is played; an earlier finish keeps its time. */
function finishedOf(
  files: { location: string }[],
  parts: PartStates,
  before: number | null,
  now: number,
): number | null {
  const all = files.length > 0 && files.every((f) => isPlayed(parts, f.location));
  return all ? (before ?? now) : null;
}

const stripExtension = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, '');

/** Whether a book can show as a podcast: one of several files that isn't a feed episode. */
export function canShowAsPodcast(db: Db, bookId: string): boolean {
  const book = db.select({ source: books.source }).from(books).where(eq(books.id, bookId)).get();
  if (!book || book.source === 'feed') return false;
  return presentFiles(db, bookId).length >= 2;
}

/** Whether a book keeps per-file marks: shown as a podcast now or at some time before. */
export function tracksEpisodes(db: Db, profileId: string, bookId: string): boolean {
  const row = db
    .select({ parts: libraryEntries.parts })
    .from(libraryEntries)
    .where(entryKey(profileId, bookId))
    .get();
  return !!row?.parts;
}

/**
 * Sets a podcast book's finished time from its marks, after sync merged marks in: finished once
 * every episode is played. Leaves `updatedAt` alone, so it starts no push.
 */
export function reconcileFinished(db: Db, profileId: string, bookId: string, now: number): void {
  const entry = readEntry(db, profileId, bookId);
  if (!entry.asPodcast) return;
  const finishedAt = finishedOf(presentFiles(db, bookId), entry.parts, entry.finishedAt, now);
  if (finishedAt === entry.finishedAt) return;
  db.update(libraryEntries).set({ finishedAt }).where(entryKey(profileId, bookId)).run();
}

/** Whether a book is finished for a profile; a podcast book only once every episode is played. */
export function isFinished(db: Db, profileId: string, bookId: string): boolean {
  return readEntry(db, profileId, bookId).finishedAt !== null;
}

export function showsAsPodcast(db: Db, profileId: string, bookId: string): boolean {
  return readEntry(db, profileId, bookId).asPodcast;
}

/** The book's files as episodes, in play order, with their marks and places. */
export function listFolderEpisodes(db: Db, profileId: string, bookId: string): FolderEpisode[] {
  const files = presentFiles(db, bookId);
  const { parts } = readEntry(db, profileId, bookId);
  const place = readPlace(db, profileId, bookId);
  return files.map((file, index) => {
    const part = parts[file.location];
    const current = place?.fileLocation === file.location;
    const positionMs = current ? place.filePositionMs : (part?.positionMs ?? 0);
    const played = isPlayed(parts, file.location);
    const code = episodeCode(file.name) ?? (file.title ? episodeCode(file.title) : null);
    return {
      index,
      location: file.location,
      title: file.title?.trim() || stripExtension(file.name),
      durationMs: file.durationMs,
      season: code?.season ?? null,
      number: code?.number ?? null,
      status: played ? 'played' : positionMs > 0 ? 'started' : 'none',
      positionMs,
      current,
    };
  });
}

/**
 * Shows a book as a podcast. The first time, files before the book's place become played and the
 * file being heard keeps its place; marks from an earlier switch stay, since book view keeps them
 * up to date. A finished book has every episode played.
 */
export function showAsPodcast(db: Db, profileId: string, bookId: string, now: number): void {
  db.transaction((tx) => {
    const files = presentFiles(tx, bookId);
    const entry = readEntry(tx, profileId, bookId);
    const place = readPlace(tx, profileId, bookId);
    const first = !tx
      .select({ parts: libraryEntries.parts })
      .from(libraryEntries)
      .where(entryKey(profileId, bookId))
      .get()?.parts;
    const current = entry.finishedAt
      ? files.length
      : first
        ? Math.max(
            0,
            files.findIndex((f) => f.location === place?.fileLocation),
          )
        : 0;
    for (const file of files.slice(0, current)) {
      if (!isPlayed(entry.parts, file.location)) {
        entry.parts[file.location] = { played: now, positionMs: 0, at: now };
      }
    }
    writeEntry(
      tx,
      profileId,
      bookId,
      {
        asPodcast: true,
        parts: entry.parts,
        finishedAt: finishedOf(files, entry.parts, entry.finishedAt, now),
      },
      now,
    );
  });
}

/**
 * Where the book continues when shown as a book again: in the episode being heard, else the first
 * one not played. `laterPlayed` counts played episodes after that place, which a book's one place
 * can't show; the switch should say so first.
 */
export function bookSwitch(
  db: Db,
  profileId: string,
  bookId: string,
): (FilePosition & { laterPlayed: number }) | null {
  const episodes = listFolderEpisodes(db, profileId, bookId);
  const start = episodes[0];
  if (!start) return null;
  const target =
    episodes.find((e) => e.current && e.status !== 'played') ??
    episodes.find((e) => e.status !== 'played');
  if (!target) return { index: 0, location: start.location, positionMs: 0, laterPlayed: 0 };
  return {
    index: target.index,
    location: target.location,
    positionMs: target.positionMs,
    laterPlayed: episodes.filter((e) => e.index > target.index && e.status === 'played').length,
  };
}

/** Shows a podcast book as a book again, at `bookSwitch`'s place; the marks are kept. */
export function showAsBook(db: Db, profileId: string, bookId: string, now: number): void {
  db.transaction((tx) => {
    const files = presentFiles(tx, bookId);
    const entry = readEntry(tx, profileId, bookId);
    const target = bookSwitch(tx, profileId, bookId);
    const place = readPlace(tx, profileId, bookId);
    if (target && (place?.fileLocation !== target.location || !entry.finishedAt)) {
      // The file the place leaves keeps where it was, for a later switch back.
      if (
        place &&
        place.fileLocation !== target.location &&
        !isPlayed(entry.parts, place.fileLocation)
      ) {
        entry.parts[place.fileLocation] = {
          played: null,
          positionMs: place.filePositionMs,
          at: now,
        };
      }
      writePlace(tx, profileId, bookId, files, target, now);
    }
    writeEntry(
      tx,
      profileId,
      bookId,
      {
        asPodcast: false,
        parts: entry.parts,
        finishedAt: finishedOf(files, entry.parts, entry.finishedAt, now),
      },
      now,
    );
  });
}

/**
 * Marks episodes played or not. Marking the one the book's place is in moves the place on to the
 * next episode not played, so Continue offers that.
 */
export function setEpisodesPlayed(
  db: Db,
  profileId: string,
  bookId: string,
  locations: string[],
  played: boolean,
  now: number,
): void {
  db.transaction((tx) => {
    const files = presentFiles(tx, bookId);
    const entry = readEntry(tx, profileId, bookId);
    const place = readPlace(tx, profileId, bookId);
    for (const location of locations) {
      if (!files.some((f) => f.location === location)) continue;
      const before = entry.parts[location];
      entry.parts[location] = {
        played: played ? now : null,
        positionMs: played ? 0 : (before?.positionMs ?? 0),
        at: now,
      };
    }
    if (played && place && locations.includes(place.fileLocation)) {
      const from = files.findIndex((f) => f.location === place.fileLocation);
      const next =
        files.slice(from + 1).find((f) => !isPlayed(entry.parts, f.location)) ??
        files.find((f) => !isPlayed(entry.parts, f.location));
      if (next) {
        writePlace(
          tx,
          profileId,
          bookId,
          files,
          { location: next.location, positionMs: entry.parts[next.location]?.positionMs ?? 0 },
          now,
        );
      }
    }
    writeEntry(
      tx,
      profileId,
      bookId,
      { parts: entry.parts, finishedAt: finishedOf(files, entry.parts, entry.finishedAt, now) },
      now,
    );
  });
}

/** Every episode played, or none: Mark as played and unplayed on a podcast book. */
export function setAllEpisodesPlayed(
  db: Db,
  profileId: string,
  bookId: string,
  played: boolean,
  now: number,
): void {
  const locations = presentFiles(db, bookId).map((f) => f.location);
  setEpisodesPlayed(db, profileId, bookId, locations, played, now);
}

/**
 * Where an episode starts when chosen: where it was left, from the start once played or when it
 * was left near its end. Null when the file isn't part of the book.
 */
export function episodeStart(
  db: Db,
  profileId: string,
  bookId: string,
  location: string,
): FilePosition | null {
  const files = presentFiles(db, bookId);
  const index = files.findIndex((f) => f.location === location);
  const file = files[index];
  if (!file) return null;
  const { parts } = readEntry(db, profileId, bookId);
  const place = readPlace(db, profileId, bookId);
  const saved =
    place?.fileLocation === location ? place.filePositionMs : (parts[location]?.positionMs ?? 0);
  const nearEnd = file.durationMs > 0 && saved >= file.durationMs - NEAR_END_MS;
  return { index, location, positionMs: isPlayed(parts, location) || nearEnd ? 0 : saved };
}

/**
 * Moves the book's place to an episode, to play it: where the episode being heard was left is
 * kept, and the chosen one starts where it was left (from the start once played, which unmarks
 * it). Null when the file isn't part of the book.
 */
export function startEpisode(
  db: Db,
  profileId: string,
  bookId: string,
  location: string,
  now: number,
): FilePosition | null {
  return db.transaction((tx) => {
    const start = episodeStart(tx, profileId, bookId, location);
    if (!start) return null;
    const files = presentFiles(tx, bookId);
    const entry = readEntry(tx, profileId, bookId);
    const place = readPlace(tx, profileId, bookId);
    if (place && place.fileLocation !== location && !isPlayed(entry.parts, place.fileLocation)) {
      entry.parts[place.fileLocation] = {
        played: null,
        positionMs: place.filePositionMs,
        at: now,
      };
    }
    if (isPlayed(entry.parts, location)) {
      entry.parts[location] = { played: null, positionMs: 0, at: now };
    }
    writePlace(tx, profileId, bookId, files, start, now);
    writeEntry(
      tx,
      profileId,
      bookId,
      { parts: entry.parts, finishedAt: finishedOf(files, entry.parts, entry.finishedAt, now) },
      now,
    );
    return start;
  });
}

/** Where a new place came from: this device's player, the service's journal or a server, sync. */
export type PlaceOrigin = 'app' | 'journal' | 'sync';

/**
 * A book's place moved to another file. Shown as a podcast, the file left counts as played when
 * it was left near its end on the way to a later file, and otherwise keeps where it was left; the
 * files the service played through with the app closed come from its own log
 * (`markFilesPlayed`). A place from sync changes no mark there: the other device's marks come
 * with its entry. Shown as a book after being a podcast, every file the place moves past counts
 * as played, also from sync, so the marks stay true for a switch back.
 */
export function noteFileChange(
  db: Db,
  profileId: string,
  bookId: string,
  from: Place,
  toLocation: string,
  origin: PlaceOrigin,
  now: number,
): void {
  const row = db
    .select({ parts: libraryEntries.parts })
    .from(libraryEntries)
    .where(entryKey(profileId, bookId))
    .get();
  if (!row?.parts) return;
  const entry = readEntry(db, profileId, bookId);
  if (entry.asPodcast && origin === 'sync') return;
  const files = presentFiles(db, bookId);
  const fromIndex = files.findIndex((f) => f.location === from.fileLocation);
  const toIndex = files.findIndex((f) => f.location === toLocation);
  const left = files[fromIndex];
  if (!left || toIndex < 0) return;
  // Saves come every 10 s of real time, which is more of the file at a higher speed.
  const speed = db
    .select({ speed: libraryEntries.speed })
    .from(libraryEntries)
    .where(entryKey(profileId, bookId))
    .get()?.speed;
  const margin = NEAR_END_MS * Math.max(1, speed ?? 1);
  const nearEnd = left.durationMs > 0 && from.filePositionMs >= left.durationMs - margin;
  if (!entry.asPodcast) {
    if (toIndex <= fromIndex) return;
    for (const file of files.slice(fromIndex, toIndex)) {
      if (!isPlayed(entry.parts, file.location)) {
        entry.parts[file.location] = { played: now, positionMs: 0, at: now };
      }
    }
  } else if (isPlayed(entry.parts, left.location)) {
    return;
  } else if (toIndex > fromIndex && nearEnd) {
    entry.parts[left.location] = { played: now, positionMs: 0, at: now };
  } else {
    entry.parts[left.location] = { played: null, positionMs: from.filePositionMs, at: now };
  }
  if (origin === 'sync') {
    // Like the place itself, nothing to push back; a newer time would also hide the entry the
    // same sync brings.
    db.update(libraryEntries).set({ parts: entry.parts }).where(entryKey(profileId, bookId)).run();
    return;
  }
  writeEntry(
    db,
    profileId,
    bookId,
    entry.asPodcast
      ? { parts: entry.parts, finishedAt: finishedOf(files, entry.parts, entry.finishedAt, now) }
      : { parts: entry.parts },
    now,
  );
}

/** A file the playback service played to its end, from its log (M158). */
export type PlayedFile = { bookId: string; fileLocation: string; at: number };

/**
 * Marks the files the playback service played to their end, perhaps with the app closed, in the
 * books that keep per-file marks; the place itself comes from the journal. Each file belongs to
 * whichever book holds it now, like a saved place. Returns the books whose marks changed.
 */
export function markFilesPlayed(
  db: Db,
  profileId: string,
  items: PlayedFile[],
  now: number,
): string[] {
  const changed = new Set<string>();
  db.transaction((tx) => {
    for (const item of items) {
      const holder = tx
        .select({ bookId: bookFiles.bookId })
        .from(bookFiles)
        .where(eq(bookFiles.location, item.fileLocation))
        .get();
      const bookId = holder?.bookId ?? item.bookId;
      if (!tracksEpisodes(tx, profileId, bookId)) continue;
      const files = presentFiles(tx, bookId);
      if (!files.some((f) => f.location === item.fileLocation)) continue;
      const entry = readEntry(tx, profileId, bookId);
      const part = entry.parts[item.fileLocation];
      // A newer change by the listener, such as Mark as unplayed after it ended, stays.
      if (isPlayed(entry.parts, item.fileLocation) || (part && part.at > item.at)) continue;
      entry.parts[item.fileLocation] = { played: item.at, positionMs: 0, at: item.at };
      writeEntry(
        tx,
        profileId,
        bookId,
        entry.asPodcast
          ? {
              parts: entry.parts,
              finishedAt: finishedOf(files, entry.parts, entry.finishedAt, item.at),
            }
          : { parts: entry.parts },
        // Folded now, so the next sync sends it even when it played before the last one.
        now,
      );
      changed.add(bookId);
    }
  });
  return [...changed];
}

/**
 * The episode to jump to when the player went on by itself from `fromLocation` into
 * `toLocation`, the next file, and that one is already played: the next one not played after it.
 * Null when nothing needs skipping.
 */
export function skipPlayedEpisode(
  db: Db,
  profileId: string,
  bookId: string,
  fromLocation: string,
  toLocation: string,
): FilePosition | null {
  const entry = readEntry(db, profileId, bookId);
  if (!entry.asPodcast || !isPlayed(entry.parts, toLocation)) return null;
  const files = presentFiles(db, bookId);
  const toIndex = files.findIndex((f) => f.location === toLocation);
  if (toIndex < 1 || files[toIndex - 1]?.location !== fromLocation) return null;
  for (const [index, file] of files.entries()) {
    if (index > toIndex && !isPlayed(entry.parts, file.location)) {
      return {
        index,
        location: file.location,
        positionMs: entry.parts[file.location]?.positionMs ?? 0,
      };
    }
  }
  return null;
}

/**
 * A podcast book played to its end: the file that ended is played, and the place moves on to the
 * next episode not played after it, else the first one, so the book only counts as finished once
 * all are. `endedLocation` is the file the player ended in: the book's last, or the one episode
 * Up Next played alone (M158). False for a book shown as a book that played to its real end,
 * which the caller finishes as usual.
 */
export function endOfPodcastBook(
  db: Db,
  profileId: string,
  bookId: string,
  at: number,
  endedLocation?: string | null,
): boolean {
  const files = presentFiles(db, bookId);
  const endedIndex = endedLocation ? files.findIndex((f) => f.location === endedLocation) : -1;
  // One episode of the book played alone: never the whole book's end.
  const alone = endedIndex >= 0 && endedIndex < files.length - 1;
  if (!alone && !showsAsPodcast(db, profileId, bookId)) return false;
  // Only a book with marks plays one alone; a plain book whose folder changed ends as before.
  if (alone && !tracksEpisodes(db, profileId, bookId)) return false;
  db.transaction((tx) => {
    const entry = readEntry(tx, profileId, bookId);
    const index = alone ? endedIndex : files.length - 1;
    const ended = files[index];
    if (ended && !isPlayed(entry.parts, ended.location)) {
      entry.parts[ended.location] = { played: at, positionMs: 0, at };
    }
    const next =
      files.slice(index + 1).find((f) => !isPlayed(entry.parts, f.location)) ??
      files.find((f) => !isPlayed(entry.parts, f.location));
    if (next) {
      writePlace(
        tx,
        profileId,
        bookId,
        files,
        { location: next.location, positionMs: entry.parts[next.location]?.positionMs ?? 0 },
        at,
      );
    }
    writeEntry(
      tx,
      profileId,
      bookId,
      entry.asPodcast
        ? { parts: entry.parts, finishedAt: finishedOf(files, entry.parts, entry.finishedAt, at) }
        : { parts: entry.parts },
      at,
    );
  });
  return true;
}

/**
 * What the playback service needs to know of a book's episodes (M158): whether it skips played
 * ones when it plays on into them (shown as a podcast), and per file whether it is played and
 * where it was left. Null for a book without per-file marks, whose files the service doesn't log.
 */
export function episodeMarks(
  db: Db,
  profileId: string,
  bookId: string,
): {
  skipsPlayed: boolean;
  files: Map<string, { played: boolean; leftAtMs: number }>;
} | null {
  if (!tracksEpisodes(db, profileId, bookId)) return null;
  const { asPodcast, parts } = readEntry(db, profileId, bookId);
  const files = new Map<string, { played: boolean; leftAtMs: number }>();
  for (const file of presentFiles(db, bookId)) {
    const part = parts[file.location];
    files.set(file.location, {
      played: isPlayed(parts, file.location),
      leftAtMs: part && part.played === null ? part.positionMs : 0,
    });
  }
  return { skipsPlayed: asPodcast, files };
}

/** Marks and the place as they were before a change, for Undo (M158). */
export type EpisodesBefore = {
  bookId: string;
  parts: Record<string, PartState | null>;
  place: Place | null;
};

/** Keeps the marks of `locations` and the book's place, to put back with `undoEpisodes`. */
export function episodesBefore(
  db: Db,
  profileId: string,
  bookId: string,
  locations: string[],
): EpisodesBefore {
  const { parts } = readEntry(db, profileId, bookId);
  return {
    bookId,
    parts: Object.fromEntries(locations.map((l) => [l, parts[l] ?? null])),
    place: readPlace(db, profileId, bookId),
  };
}

/**
 * Puts marks and the place back as `before` kept them. Each change is dated now, so the undo wins
 * over the change it takes back on every synced device too.
 */
export function undoEpisodes(db: Db, profileId: string, before: EpisodesBefore, now: number): void {
  db.transaction((tx) => {
    const { bookId } = before;
    const files = presentFiles(tx, bookId);
    const entry = readEntry(tx, profileId, bookId);
    for (const [location, part] of Object.entries(before.parts)) {
      entry.parts[location] = part
        ? { ...part, at: now }
        : { played: null, positionMs: 0, at: now };
    }
    const place = readPlace(tx, profileId, bookId);
    const back = before.place;
    if (
      back &&
      (place?.fileLocation !== back.fileLocation || place.filePositionMs !== back.filePositionMs) &&
      files.some((f) => f.location === back.fileLocation)
    ) {
      writePlace(
        tx,
        profileId,
        bookId,
        files,
        { location: back.fileLocation, positionMs: back.filePositionMs },
        now,
      );
    }
    writeEntry(
      tx,
      profileId,
      bookId,
      { parts: entry.parts, finishedAt: finishedOf(files, entry.parts, entry.finishedAt, now) },
      now,
    );
  });
}

/** How many of a podcast book's episodes there are and how many are not played (M158). */
export function episodeCounts(
  db: Db,
  bookId: string,
  parts: PartStates | null,
): { total: number; left: number } {
  const files = presentFiles(db, bookId);
  const played = files.filter((f) => isPlayed(parts ?? {}, f.location)).length;
  return { total: files.length, left: files.length - played };
}

/**
 * Per-file state for sync: by location, then by the file's own name and, only when both devices
 * hold as many files, by index (M158), since another device may name files apart and its folder
 * may hold other files.
 */
export type SyncedPart = {
  fileLocation: string;
  fileIndex: number;
  /** Since M158; absent from M157 devices. */
  fileName?: string;
  /** How many files the book has on the sending device; since M158. */
  fileCount?: number;
  played: number | null;
  positionMs: number;
  at: number;
};

export function partsForSync(db: Db, bookId: string, parts: PartStates | null): SyncedPart[] {
  if (!parts) return [];
  const files = db
    .select({ location: bookFiles.location, idx: bookFiles.idx, name: bookFiles.name })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .all();
  return files.flatMap((f) => {
    const part = parts[f.location];
    if (!part) return [];
    const where = { fileLocation: f.location, fileIndex: f.idx, fileName: f.name };
    return [{ ...where, fileCount: files.length, ...part }];
  });
}

/**
 * Merges synced per-file state into this device's, file by file: the newer change wins, so marks
 * made on two devices both stay.
 */
export function mergeSyncedParts(
  db: Db,
  bookId: string,
  local: PartStates | null,
  incoming: unknown,
): PartStates | null {
  if (!Array.isArray(incoming)) return local;
  const files = db
    .select({ location: bookFiles.location, idx: bookFiles.idx, name: bookFiles.name })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .all();
  const merged: PartStates = { ...(local ?? {}) };
  for (const item of incoming as Partial<SyncedPart>[]) {
    if (typeof item?.at !== 'number' || typeof item.positionMs !== 'number') continue;
    if (item.played !== null && typeof item.played !== 'number') continue;
    const location = fileFor(files, item);
    if (!location) continue;
    const mine = merged[location];
    if (mine && mine.at >= item.at) continue;
    merged[location] = {
      played: item.played ?? null,
      positionMs: Math.max(0, Math.round(item.positionMs)),
      at: item.at,
    };
  }
  return merged;
}

/** This device's file for a synced one; null when none is surely the same. */
function fileFor(
  files: { location: string; idx: number; name: string }[],
  item: Partial<SyncedPart>,
): string | null {
  const byLocation = files.find((f) => f.location === item.fileLocation);
  if (byLocation) return byLocation.location;
  if (typeof item.fileName === 'string') {
    const byName = files.filter((f) => f.name === item.fileName);
    if (byName.length === 1) return byName[0]?.location ?? null;
  }
  // An M157 device sends neither name nor count; its index is taken as before.
  if (typeof item.fileCount === 'number' && item.fileCount !== files.length) return null;
  return files.find((f) => f.idx === item.fileIndex)?.location ?? null;
}

/** A file named for sync the way marks name it: one episode queued in Up Next (M158). */
export type SyncedFile = Pick<SyncedPart, 'fileLocation' | 'fileIndex' | 'fileName' | 'fileCount'>;

const bookFileRows = (db: Db, bookId: string) =>
  db
    .select({ location: bookFiles.location, idx: bookFiles.idx, name: bookFiles.name })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .all();

export function fileForSync(db: Db, bookId: string, location: string): SyncedFile | null {
  const files = bookFileRows(db, bookId);
  const file = files.find((f) => f.location === location);
  if (!file) return null;
  return {
    fileLocation: file.location,
    fileIndex: file.idx,
    fileName: file.name,
    fileCount: files.length,
  };
}

/** This device's file for one named by sync; null when none is surely the same. */
export function fileFromSync(db: Db, bookId: string, synced: unknown): string | null {
  if (typeof synced !== 'object' || synced === null) return null;
  return fileFor(bookFileRows(db, bookId), synced as Partial<SyncedFile>);
}
