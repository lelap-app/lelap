import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { setFinished } from '../library/queries';
import { saveProgress } from '../progress';
import { bookFiles, libraryEntries, progress } from '../schema';
import { type JavaValue, readJavaObject } from './javaSerial';
import { ImportError, type ImportSummary } from './summary';

// Smart AudioBook Player keeps a `position.sabp.dat` in each book's folder: a serialized
// BookDataBackup with the current file, the place in it (seconds), the last play (epoch ms) and
// whether the book is started or finished. The app finds these files in the library folder.

export const SABP_POSITION_FILE = 'position.sabp.dat';

export type SabpBook = {
  /** The file playing, by name, in the same folder. */
  fileName: string;
  filePositionMs: number;
  bookPositionMs: number;
  durationMs: number;
  lastPlayedAt: number | null;
  /** `New`, `Started` or `Finished`, as the app names them. */
  state: string;
};

const CLASS = 'ak.alizandro.smartaudiobookplayer.BookDataBackup';

const asNumber = (value: JavaValue | undefined) =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0;

export function parseSabpPosition(bytes: Uint8Array): SabpBook {
  const object = readJavaObject(bytes);
  if (object.className !== CLASS) {
    throw new ImportError('This is not a Smart AudioBook Player position file.');
  }
  const field = (name: string) => object.fields.get(name);
  const state = field('mBookState');
  const fileName = field('mFileName');
  return {
    fileName: typeof fileName === 'string' ? fileName : '',
    filePositionMs: Math.max(0, asNumber(field('mFilePosition'))) * 1000,
    bookPositionMs: Math.max(0, asNumber(field('mCurrentPlaybackTimeCache'))) * 1000,
    durationMs: Math.max(0, asNumber(field('mTotalPlaybackTimeCache'))) * 1000,
    lastPlayedAt: asNumber(field('mLastPlaybackTime')) || null,
    state: state && typeof state === 'object' && 'constant' in state ? state.constant : 'New',
  };
}

/** A position file found in the library folder, by its volume path. */
export type SabpFound = { location: string; book: SabpBook };

const folderOf = (location: string) => location.slice(0, location.lastIndexOf('/'));
const folderName = (location: string) => folderOf(location).split(/[/:]/).pop() ?? location;

/**
 * Carries places and finished marks over to the library books in the same folders. A place Lelap
 * saved after Smart AudioBook Player last played the book stays.
 */
export function applySmartAudiobook(
  db: Db,
  profileId: string,
  found: SabpFound[],
  now: number,
): ImportSummary {
  const summary: ImportSummary = { matched: 0, skipped: [] };
  for (const { location, book } of found) {
    const name = folderName(location);
    if (book.state === 'New' || (book.state !== 'Finished' && book.filePositionMs === 0)) {
      continue;
    }
    const fileLocation = `${folderOf(location)}/${book.fileName}`;
    const file = db
      .select({ bookId: bookFiles.bookId, missingSince: bookFiles.missingSince })
      .from(bookFiles)
      .where(eq(bookFiles.location, fileLocation))
      .get();
    if (!file?.bookId || file.missingSince !== null) {
      summary.skipped.push({ item: name, reason: 'Not in your library; look for new files first' });
      continue;
    }
    const bookId = file.bookId;
    const key = <T extends typeof progress | typeof libraryEntries>(table: T) =>
      and(eq(table.profileId, profileId), eq(table.bookId, bookId));

    if (book.state === 'Finished') {
      const entry = db
        .select({ finishedAt: libraryEntries.finishedAt })
        .from(libraryEntries)
        .where(key(libraryEntries))
        .get();
      if (entry?.finishedAt) continue;
      setFinished(db, profileId, bookId, true, now, book.lastPlayedAt ?? now);
      summary.matched++;
      continue;
    }
    const stored = db
      .select({ updatedAt: progress.updatedAt })
      .from(progress)
      .where(key(progress))
      .get();
    if (stored && stored.updatedAt >= (book.lastPlayedAt ?? 0)) continue;
    // Saved as now, so sync sends it on; the check above already kept newer places.
    const saved = saveProgress(
      db,
      profileId,
      { bookId, fileLocation, filePositionMs: book.filePositionMs, savedAt: now },
      'app',
    );
    if (saved) summary.matched++;
  }
  return summary;
}
