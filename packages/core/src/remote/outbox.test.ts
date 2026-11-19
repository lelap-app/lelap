import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { addRemoteRoot, applyScan, removeRemoteRoot } from '../library/scan';
import { listBooks } from '../library/queries';
import { createProfile, DEFAULT_PROFILE_ID as ME, deleteProfile } from '../profiles';
import { saveProgress } from '../progress';
import {
  duePlaces,
  nextPlaceDue,
  type PendingPlace,
  placeDone,
  placeFailed,
  placeOwner,
  placeToSend,
  queuePlace,
  queueSavedPlace,
  startsBeforePlace,
} from './outbox';

const ROOT = 'audiobookshelf:abs.example';
const DAY = 24 * 60 * 60 * 1000;

function library() {
  const db = createTestDb();
  let n = 0;
  const newId = () => `id-${++n}`;
  const rootId = addRemoteRoot(
    db,
    {
      type: 'audiobookshelf',
      url: 'https://abs.example',
      username: 'me',
      userId: 'u1',
      token: 'key',
      libraryIds: ['lib'],
      profileId: ME,
    },
    1,
    newId,
  );
  applyScan(db, {
    rootId,
    rootLocation: ROOT,
    listed: [
      {
        location: `${ROOT}/li_1/1`,
        relPath: 'li_1/01.mp3',
        name: '01.mp3',
        size: 1,
        modifiedAt: 1,
        uri: 'https://abs.example/1',
      },
    ],
    tags: new Map([
      [
        `${ROOT}/li_1/1`,
        {
          durationMs: 600_000,
          title: null,
          album: 'Dune',
          artist: null,
          albumArtist: null,
          coverPath: null,
          chapters: [],
        },
      ],
    ]),
    folderCovers: new Map(),
    now: 2,
    newId,
  });
  const bookId = listBooks(db, ME, 'title')[0]?.id ?? '';
  return { db, rootId, bookId, newId };
}

function first(rows: PendingPlace[]): PendingPlace {
  const [row] = rows;
  if (!row) throw new Error('Nothing waits.');
  return row;
}

describe('the place outbox', () => {
  it('keeps the latest place of a book until the server takes it', () => {
    const { db, rootId, bookId } = library();
    queuePlace(db, rootId, { event: 'start', bookId, at: 1_000, positionMs: 5_000 });
    queuePlace(db, rootId, { event: 'pause', bookId, at: 2_000, positionMs: 9_000 });
    const row = first(duePlaces(db, 2_000));
    expect(row).toMatchObject({ event: 'pause', positionMs: 9_000, attempts: 0 });
    expect(duePlaces(db, 2_000)).toHaveLength(1);

    placeFailed(db, row, 3_000);
    expect(duePlaces(db, 3_000)).toEqual([]);
    expect(nextPlaceDue(db)).toBe(33_000);
    // The app coming to the front sends what waits, backoff or not.
    expect(duePlaces(db, 3_000, true)).toHaveLength(1);

    const again = first(duePlaces(db, 33_000));
    expect(again.attempts).toBe(1);
    placeDone(db, again);
    expect(nextPlaceDue(db)).toBeNull();
  });

  it('keeps a newer place that came in while an older one was being sent', () => {
    const { db, rootId, bookId } = library();
    queuePlace(db, rootId, { event: 'pause', bookId, at: 1_000, positionMs: 5_000 });
    const sending = first(duePlaces(db, 1_000));
    queuePlace(db, rootId, { event: 'pause', bookId, at: 2_000, positionMs: 8_000 });
    placeDone(db, sending);
    expect(duePlaces(db, 2_000)).toMatchObject([{ positionMs: 8_000 }]);
  });

  it('queues a place saved with the app closed as a pause, never over a newer one', () => {
    const { db, rootId, bookId } = library();
    queueSavedPlace(db, rootId, { bookId, positionMs: 7_000.4, at: 1_000 });
    expect(duePlaces(db, 1_000)).toMatchObject([{ event: 'pause', positionMs: 7_000 }]);
    queuePlace(db, rootId, { event: 'progress', bookId, at: 3_000, positionMs: 9_000 });
    queueSavedPlace(db, rootId, { bookId, positionMs: 8_000, at: 2_000 });
    expect(duePlaces(db, 3_000)).toMatchObject([{ event: 'progress', positionMs: 9_000 }]);
    queueSavedPlace(db, rootId, { bookId, positionMs: 12_000, at: 4_000 });
    expect(duePlaces(db, 4_000)).toMatchObject([{ event: 'pause', positionMs: 12_000 }]);
  });

  it('drops places a month old, and those of a removed server', () => {
    const { db, rootId, bookId } = library();
    queuePlace(db, rootId, { event: 'pause', bookId, at: 1_000, positionMs: 5_000 });
    expect(duePlaces(db, 31 * DAY)).toEqual([]);
    queuePlace(db, rootId, { event: 'pause', bookId, at: 1_000, positionMs: 5_000 });
    removeRemoteRoot(db, rootId);
    expect(nextPlaceDue(db)).toBeNull();
  });

  it("sends the profile's own place when it is clearly newer", () => {
    const { db, rootId, bookId } = library();
    queuePlace(db, rootId, { event: 'pause', bookId, at: 1_000, positionMs: 7_000 });
    const row = first(duePlaces(db, 1_000));
    expect(placeToSend(db, ME, row)).toEqual({ event: 'pause', positionMs: 7_000 });
    saveProgress(
      db,
      ME,
      { bookId, fileLocation: `${ROOT}/li_1/1`, filePositionMs: 42_000, savedAt: 60_000 },
      'app',
    );
    expect(placeToSend(db, ME, row)).toEqual({ event: 'pause', positionMs: 42_000 });
    // A finish stays a finish, whatever was saved after it.
    queuePlace(db, rootId, { event: 'finish', bookId, at: 1_000, positionMs: 0 });
    const finish = first(duePlaces(db, 1_000));
    expect(placeToSend(db, ME, finish)).toEqual({ event: 'finish', positionMs: 0 });
  });

  it("goes to the first profile once the server's own is deleted", () => {
    const { db, newId } = library();
    const kid = createProfile(db, { name: 'Kid', avatar: null, kids: false }, 1, newId);
    expect(placeOwner(db, kid)).toBe(kid);
    deleteProfile(db, kid, 2);
    expect(placeOwner(db, kid)).toBe(ME);
    expect(placeOwner(db, undefined)).toBe(ME);
  });

  it('skips a start at 0 before the player moved to the saved place', () => {
    const start = { event: 'start' as const, bookId: 'b', at: 1, positionMs: 0 };
    expect(startsBeforePlace(start, 120_000)).toBe(true);
    expect(startsBeforePlace(start, 0)).toBe(false);
    expect(startsBeforePlace({ ...start, positionMs: 120_000 }, 120_000)).toBe(false);
    expect(startsBeforePlace({ ...start, event: 'pause' }, 120_000)).toBe(false);
  });
});
