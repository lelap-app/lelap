import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { bookFiles, books, libraryEntries, type PartStates, progress } from '../schema';
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
    const files = presentFiles(tx, bookId);
    const index = files.findIndex((f) => f.location === location);
    const file = files[index];
    if (!file) return null;
    const entry = readEntry(tx, profileId, bookId);
    const place = readPlace(tx, profileId, bookId);
    if (place && place.fileLocation !== location && !isPlayed(entry.parts, place.fileLocation)) {
      entry.parts[place.fileLocation] = {
        played: null,
        positionMs: place.filePositionMs,
        at: now,
      };
    }
    const part = entry.parts[location];
    const saved = place?.fileLocation === location ? place.filePositionMs : (part?.positionMs ?? 0);
    const nearEnd = file.durationMs > 0 && saved >= file.durationMs - NEAR_END_MS;
    const positionMs = isPlayed(entry.parts, location) || nearEnd ? 0 : saved;
    if (isPlayed(entry.parts, location)) {
      entry.parts[location] = { played: null, positionMs: 0, at: now };
    }
    writePlace(tx, profileId, bookId, files, { location, positionMs }, now);
    writeEntry(
      tx,
      profileId,
      bookId,
      { parts: entry.parts, finishedAt: finishedOf(files, entry.parts, entry.finishedAt, now) },
      now,
    );
    return { index, location, positionMs };
  });
}

/**
 * A book's place moved to another file (from `saveProgress`). Shown as a podcast, the file left
 * counts as played when it was left near its end on the way to a later file; from the service's
 * journal, which only knows the newest place, the files passed on the way count too. Otherwise
 * it keeps where it was left. Shown as a book after being a podcast, every file the place moves
 * past counts as played, so the marks stay true for a switch back.
 */
export function noteFileChange(
  db: Db,
  profileId: string,
  bookId: string,
  from: Place,
  toLocation: string,
  fromJournal: boolean,
  now: number,
): void {
  const row = db
    .select({ parts: libraryEntries.parts })
    .from(libraryEntries)
    .where(entryKey(profileId, bookId))
    .get();
  if (!row?.parts) return;
  const entry = readEntry(db, profileId, bookId);
  const files = presentFiles(db, bookId);
  const fromIndex = files.findIndex((f) => f.location === from.fileLocation);
  const toIndex = files.findIndex((f) => f.location === toLocation);
  const left = files[fromIndex];
  if (!left || toIndex < 0) return;
  const nearEnd = left.durationMs > 0 && from.filePositionMs >= left.durationMs - NEAR_END_MS;
  const markPlayed = (passed: typeof files) => {
    for (const file of passed) {
      if (!isPlayed(entry.parts, file.location)) {
        entry.parts[file.location] = { played: now, positionMs: 0, at: now };
      }
    }
  };
  if (!entry.asPodcast) {
    if (toIndex <= fromIndex) return;
    markPlayed(files.slice(fromIndex, toIndex));
  } else if (toIndex > fromIndex && (nearEnd || fromJournal)) {
    markPlayed(fromJournal ? files.slice(fromIndex, toIndex) : [left]);
  } else if (!isPlayed(entry.parts, left.location)) {
    entry.parts[left.location] = { played: null, positionMs: from.filePositionMs, at: now };
  } else {
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
 * A podcast book played to its end: the last file is played, and the place moves to the first
 * episode not played, if any, so the book only counts as finished once all are. False for a book
 * shown as a book, which the caller finishes as usual.
 */
export function endOfPodcastBook(db: Db, profileId: string, bookId: string, at: number): boolean {
  if (!showsAsPodcast(db, profileId, bookId)) return false;
  db.transaction((tx) => {
    const files = presentFiles(tx, bookId);
    const entry = readEntry(tx, profileId, bookId);
    const last = files.at(-1);
    if (last && !isPlayed(entry.parts, last.location)) {
      entry.parts[last.location] = { played: at, positionMs: 0, at };
    }
    const next = files.find((f) => !isPlayed(entry.parts, f.location));
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
      { parts: entry.parts, finishedAt: finishedOf(files, entry.parts, entry.finishedAt, at) },
      at,
    );
  });
  return true;
}

/** Per-file state for sync: by location and index, since another device may name files apart. */
export type SyncedPart = {
  fileLocation: string;
  fileIndex: number;
  played: number | null;
  positionMs: number;
  at: number;
};

export function partsForSync(db: Db, bookId: string, parts: PartStates | null): SyncedPart[] {
  if (!parts) return [];
  const files = db
    .select({ location: bookFiles.location, idx: bookFiles.idx })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .all();
  return files.flatMap((f) => {
    const part = parts[f.location];
    return part ? [{ fileLocation: f.location, fileIndex: f.idx, ...part }] : [];
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
    .select({ location: bookFiles.location, idx: bookFiles.idx })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .all();
  const merged: PartStates = { ...(local ?? {}) };
  for (const item of incoming as Partial<SyncedPart>[]) {
    if (typeof item?.at !== 'number' || typeof item.positionMs !== 'number') continue;
    if (item.played !== null && typeof item.played !== 'number') continue;
    const location =
      files.find((f) => f.location === item.fileLocation)?.location ??
      files.find((f) => f.idx === item.fileIndex)?.location;
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
