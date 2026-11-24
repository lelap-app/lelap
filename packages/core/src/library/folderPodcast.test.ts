import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { resumePoint, saveProgress } from '../progress';
import { bookFiles, libraryEntries } from '../schema';
import { applyOps, collectOps } from '../sync/ops';
import { addToUpNext, finishFromPlayer, listUpNext, queuedEpisode } from '../upNext';
import {
  bookSwitch,
  episodeMarks,
  episodesBefore,
  listFolderEpisodes,
  markFilesPlayed,
  undoEpisodes,
  setEpisodesPlayed,
  showAsBook,
  showAsPodcast,
  skipPlayedEpisode,
  startEpisode,
} from './folderPodcast';
import { bookFraction, listBooks, setFinished } from './queries';

const MIN = 60_000;
const FILES = ['e1', 'e2', 'e3', 'e4', 'e5'].map((location) => ({
  location,
  durationMs: 40 * MIN,
}));

const must = (): never => {
  throw new Error('missing test data');
};
const statuses = (db: Db, bookId: string) =>
  listFolderEpisodes(db, ME, bookId).map((e) => e.status);
const finishedAt = (db: Db) => db.select().from(libraryEntries).get()?.finishedAt ?? null;
const place = (db: Db, bookId: string, location: string, ms: number, at: number) =>
  saveProgress(db, ME, { bookId, fileLocation: location, filePositionMs: ms, savedAt: at }, 'app');

describe('folders as podcasts', () => {
  let db: Db;
  let bookId: string;

  beforeEach(() => {
    db = createTestDb();
    bookId = seedBook(db, 'Bandeland', FILES);
  });

  it('turns the place in the book into marks: before it played, in it started', () => {
    place(db, bookId, 'e3', 10 * MIN, 10);
    showAsPodcast(db, ME, bookId, 20);
    expect(statuses(db, bookId)).toEqual(['played', 'played', 'started', 'none', 'none']);
    expect(listFolderEpisodes(db, ME, bookId)[2]).toMatchObject({
      positionMs: 10 * MIN,
      current: true,
    });
  });

  it('marks every episode of a finished book played', () => {
    setFinished(db, ME, bookId, true, 5);
    showAsPodcast(db, ME, bookId, 20);
    expect(statuses(db, bookId)).toEqual(Array(5).fill('played'));
  });

  it('plays an episode out of order and keeps where the last one was left', () => {
    place(db, bookId, 'e2', 5 * MIN, 10);
    showAsPodcast(db, ME, bookId, 20);
    expect(startEpisode(db, ME, bookId, 'e5', 30)).toEqual({
      index: 4,
      location: 'e5',
      positionMs: 0,
    });
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 4, location: 'e5', positionMs: 0 });
    expect(listFolderEpisodes(db, ME, bookId)[1]).toMatchObject({
      status: 'started',
      positionMs: 5 * MIN,
    });
    // Back to the second one: it starts where it was left.
    expect(startEpisode(db, ME, bookId, 'e2', 40)?.positionMs).toBe(5 * MIN);
  });

  it('marks a file played when it was left near its end for the next one', () => {
    showAsPodcast(db, ME, bookId, 5);
    place(db, bookId, 'e1', 39.8 * MIN, 10);
    place(db, bookId, 'e2', 2_000, 20);
    expect(statuses(db, bookId).slice(0, 2)).toEqual(['played', 'started']);
  });

  it('allows for the speed when telling the end of a file', () => {
    showAsPodcast(db, ME, bookId, 5);
    db.update(libraryEntries).set({ speed: 3 }).run();
    place(db, bookId, 'e1', 39 * MIN, 10);
    place(db, bookId, 'e2', 2_000, 20);
    expect(statuses(db, bookId)[0]).toBe('played');
  });

  it('does not mark a file played when the listener jumped away from its middle', () => {
    showAsPodcast(db, ME, bookId, 5);
    place(db, bookId, 'e1', 10 * MIN, 10);
    place(db, bookId, 'e2', 2_000, 20);
    expect(listFolderEpisodes(db, ME, bookId)[0]).toMatchObject({
      status: 'started',
      positionMs: 10 * MIN,
    });
  });

  it('marks the files the service played to their end with the app closed', () => {
    showAsPodcast(db, ME, bookId, 5);
    place(db, bookId, 'e1', MIN, 10);
    const played = (fileLocation: string, at: number) => ({ bookId, fileLocation, at });
    expect(markFilesPlayed(db, ME, [played('e1', 15), played('e2', 18)], 30)).toEqual([bookId]);
    // Sent with the next sync, though it played before it.
    expect(db.select().from(libraryEntries).get()?.updatedAt).toBe(30);
    saveProgress(
      db,
      ME,
      { bookId, fileLocation: 'e3', filePositionMs: MIN, savedAt: 20 },
      'journal',
    );
    expect(statuses(db, bookId)).toEqual(['played', 'played', 'started', 'none', 'none']);
  });

  it('keeps a newer change by the listener over the service log', () => {
    showAsPodcast(db, ME, bookId, 5);
    setEpisodesPlayed(db, ME, bookId, ['e2'], false, 50);
    markFilesPlayed(db, ME, [{ bookId, fileLocation: 'e2', at: 40 }], 60);
    expect(statuses(db, bookId)[1]).toBe('none');
  });

  it('does not mark the file a journal place left from its middle', () => {
    showAsPodcast(db, ME, bookId, 5);
    place(db, bookId, 'e1', 2 * MIN, 10);
    saveProgress(db, ME, { bookId, fileLocation: 'e2', filePositionMs: 0, savedAt: 20 }, 'journal');
    expect(listFolderEpisodes(db, ME, bookId)[0]).toMatchObject({
      status: 'started',
      positionMs: 2 * MIN,
    });
  });

  it('leaves a book shown as a book alone', () => {
    place(db, bookId, 'e1', 39.8 * MIN, 10);
    place(db, bookId, 'e2', 2_000, 20);
    expect(db.select().from(libraryEntries).get()?.parts).toBeNull();
  });

  it('skips a played episode the player went on to, to the next one not played', () => {
    showAsPodcast(db, ME, bookId, 5);
    setEpisodesPlayed(db, ME, bookId, ['e2', 'e3'], true, 10);
    expect(skipPlayedEpisode(db, ME, bookId, 'e1', 'e2')).toEqual({
      index: 3,
      location: 'e4',
      positionMs: 0,
    });
    expect(skipPlayedEpisode(db, ME, bookId, 'e3', 'e4')).toBeNull();
    // Chosen by the listener, not reached by playing on: no skip.
    expect(skipPlayedEpisode(db, ME, bookId, 'e5', 'e2')).toBeNull();
  });

  it('replays a played episode from the start, unmarked', () => {
    showAsPodcast(db, ME, bookId, 5);
    setEpisodesPlayed(db, ME, bookId, ['e3'], true, 10);
    expect(startEpisode(db, ME, bookId, 'e3', 20)?.positionMs).toBe(0);
    expect(statuses(db, bookId)[2]).toBe('none');
  });

  it('moves the place on when the episode being heard is marked played', () => {
    place(db, bookId, 'e2', MIN, 10);
    showAsPodcast(db, ME, bookId, 20);
    setEpisodesPlayed(db, ME, bookId, ['e4'], true, 25);
    setEpisodesPlayed(db, ME, bookId, ['e2'], true, 30);
    expect(resumePoint(db, ME, bookId)?.location).toBe('e3');
  });

  it('is finished only once every episode is played', () => {
    showAsPodcast(db, ME, bookId, 5);
    setEpisodesPlayed(db, ME, bookId, ['e1', 'e2', 'e3', 'e4'], true, 10);
    expect(finishedAt(db)).toBeNull();
    setEpisodesPlayed(db, ME, bookId, ['e5'], true, 20);
    expect(finishedAt(db)).toBe(20);
  });

  it('at the end of the book goes on to the first episode not played', () => {
    showAsPodcast(db, ME, bookId, 5);
    setEpisodesPlayed(db, ME, bookId, ['e1', 'e3', 'e4'], true, 10);
    place(db, bookId, 'e5', 39 * MIN, 20);
    finishFromPlayer(db, ME, bookId, 30);
    expect(statuses(db, bookId)).toEqual(['played', 'none', 'played', 'played', 'played']);
    expect(resumePoint(db, ME, bookId)?.location).toBe('e2');
    expect(finishedAt(db)).toBeNull();
  });

  it('marks one episode Up Next played alone and goes on after it', () => {
    showAsPodcast(db, ME, bookId, 5);
    setEpisodesPlayed(db, ME, bookId, ['e3'], true, 10);
    place(db, bookId, 'e2', 39 * MIN, 20);
    finishFromPlayer(db, ME, bookId, 30, 'e2');
    expect(statuses(db, bookId)).toEqual(['none', 'played', 'played', 'none', 'none']);
    expect(resumePoint(db, ME, bookId)?.location).toBe('e4');
    expect(finishedAt(db)).toBeNull();
  });

  it('never finishes a book with marks because one of its files played alone', () => {
    showAsPodcast(db, ME, bookId, 5);
    showAsBook(db, ME, bookId, 6);
    place(db, bookId, 'e2', 39 * MIN, 20);
    finishFromPlayer(db, ME, bookId, 30, 'e2');
    expect(finishedAt(db)).toBeNull();
    expect(statuses(db, bookId)[1]).toBe('played');
    finishFromPlayer(db, ME, bookId, 40, 'e5');
    expect(finishedAt(db)).toBe(40);
  });

  it('finishes a plain book that ended before a file added since', () => {
    place(db, bookId, 'e4', 39 * MIN, 20);
    finishFromPlayer(db, ME, bookId, 30, 'e4');
    expect(finishedAt(db)).toBe(30);
  });

  it('tells the player which episodes are played and where the others were left', () => {
    expect(episodeMarks(db, ME, bookId)).toBeNull();
    place(db, bookId, 'e2', 5 * MIN, 10);
    showAsPodcast(db, ME, bookId, 20);
    startEpisode(db, ME, bookId, 'e4', 30);
    const marks = episodeMarks(db, ME, bookId);
    expect(marks?.skipsPlayed).toBe(true);
    expect(marks?.files.get('e1')).toEqual({ played: true, leftAtMs: 0 });
    expect(marks?.files.get('e2')).toEqual({ played: false, leftAtMs: 5 * MIN });
    showAsBook(db, ME, bookId, 40);
    expect(episodeMarks(db, ME, bookId)?.skipsPlayed).toBe(false);
  });

  it('undoes a mark and the move of the place it made', () => {
    place(db, bookId, 'e2', 5 * MIN, 10);
    showAsPodcast(db, ME, bookId, 20);
    const before = episodesBefore(db, ME, bookId, ['e2']);
    setEpisodesPlayed(db, ME, bookId, ['e2'], true, 30);
    expect(resumePoint(db, ME, bookId)?.location).toBe('e3');
    undoEpisodes(db, ME, before, 40);
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 1, location: 'e2', positionMs: 5 * MIN });
    expect(listFolderEpisodes(db, ME, bookId)[1]).toMatchObject({
      status: 'started',
      positionMs: 5 * MIN,
    });
  });

  it('marks every episode with Mark as played on the whole book', () => {
    showAsPodcast(db, ME, bookId, 5);
    setFinished(db, ME, bookId, true, 10);
    expect(statuses(db, bookId)).toEqual(Array(5).fill('played'));
    setFinished(db, ME, bookId, false, 20);
    expect(statuses(db, bookId)).toEqual(Array(5).fill('none'));
  });

  describe('back to a book', () => {
    it('continues from the episode being heard and counts the played ones after it', () => {
      place(db, bookId, 'e1', MIN, 10);
      showAsPodcast(db, ME, bookId, 20);
      setEpisodesPlayed(db, ME, bookId, ['e3', 'e5'], true, 30);
      expect(bookSwitch(db, ME, bookId)).toMatchObject({
        location: 'e1',
        positionMs: MIN,
        laterPlayed: 2,
      });
    });

    it('continues from the first episode not played when the current one is played', () => {
      showAsPodcast(db, ME, bookId, 5);
      setEpisodesPlayed(db, ME, bookId, ['e1', 'e2', 'e4'], true, 10);
      place(db, bookId, 'e4', 0, 15);
      expect(bookSwitch(db, ME, bookId)).toMatchObject({ location: 'e3', laterPlayed: 1 });
    });

    it('keeps the marks true while it is a book: passed files are played', () => {
      showAsPodcast(db, ME, bookId, 5);
      setEpisodesPlayed(db, ME, bookId, ['e4'], true, 10);
      showAsBook(db, ME, bookId, 20);
      place(db, bookId, 'e1', 10 * MIN, 30);
      place(db, bookId, 'e3', MIN, 40);
      showAsPodcast(db, ME, bookId, 50);
      expect(statuses(db, bookId)).toEqual(['played', 'played', 'started', 'played', 'none']);
    });

    it('loses nothing on the way there and back', () => {
      place(db, bookId, 'e2', 3 * MIN, 10);
      showAsPodcast(db, ME, bookId, 20);
      setEpisodesPlayed(db, ME, bookId, ['e4'], true, 30);
      startEpisode(db, ME, bookId, 'e5', 35);
      place(db, bookId, 'e5', 7 * MIN, 40);
      const before = listFolderEpisodes(db, ME, bookId).map((e) => [e.status, e.positionMs]);
      showAsBook(db, ME, bookId, 50);
      expect(resumePoint(db, ME, bookId)).toEqual({
        index: 4,
        location: 'e5',
        positionMs: 7 * MIN,
      });
      showAsPodcast(db, ME, bookId, 60);
      expect(listFolderEpisodes(db, ME, bookId).map((e) => [e.status, e.positionMs])).toEqual(
        before,
      );
    });
  });

  it('keeps the marks true in book view when it is marked finished or not', () => {
    showAsPodcast(db, ME, bookId, 5);
    showAsBook(db, ME, bookId, 10);
    setFinished(db, ME, bookId, true, 20);
    setFinished(db, ME, bookId, false, 30);
    showAsPodcast(db, ME, bookId, 40);
    expect(statuses(db, bookId)).toEqual(Array(5).fill('none'));
    expect(finishedAt(db)).toBeNull();
  });

  describe('Up Next and the Library', () => {
    it('queues one episode, which takes the place of another of the same book', () => {
      showAsPodcast(db, ME, bookId, 5);
      addToUpNext(db, ME, bookId, 'last', 10, 'e2');
      addToUpNext(db, ME, bookId, 'next', 20, 'e4');
      expect(listUpNext(db, ME)).toHaveLength(1);
      expect(listUpNext(db, ME)[0]?.episode?.location).toBe('e4');
      expect(queuedEpisode(db, ME, bookId)).toBe('e4');
      addToUpNext(db, ME, bookId, 'last', 30);
      expect(listUpNext(db, ME)[0]?.episode).toBeNull();
    });

    it('says how many episodes are left in the Library', () => {
      place(db, bookId, 'e3', MIN, 10);
      const row = () => listBooks(db, ME, 'recent')[0];
      expect(row()?.episodes).toBeNull();
      showAsPodcast(db, ME, bookId, 20);
      expect(row()?.episodes).toEqual({ total: 5, left: 3 });
      expect(bookFraction(row() ?? must())).toBeCloseTo(0.4);
    });
  });

  describe('sync', () => {
    it('merges marks from two devices file by file', () => {
      showAsPodcast(db, ME, bookId, 5);
      setEpisodesPlayed(db, ME, bookId, ['e2'], true, 10);
      const ops = collectOps(db, 0);

      const other = createTestDb();
      const otherBook = seedBook(other, 'Bandeland', FILES);
      showAsPodcast(other, ME, otherBook, 6);
      // Newer than the first device's entry, with a mark of its own.
      setEpisodesPlayed(other, ME, otherBook, ['e4'], true, 50);
      applyOps(other, ops, 100, () => 'x');
      expect(statuses(other, otherBook)).toEqual(['none', 'played', 'none', 'played', 'none']);
    });

    it('finishes the book when synced marks complete it', () => {
      showAsPodcast(db, ME, bookId, 5);
      setEpisodesPlayed(db, ME, bookId, ['e1', 'e2'], true, 10);
      const ops = collectOps(db, 0);
      const other = createTestDb();
      const otherBook = seedBook(other, 'Bandeland', FILES);
      showAsPodcast(other, ME, otherBook, 6);
      setEpisodesPlayed(other, ME, otherBook, ['e3', 'e4', 'e5'], true, 50);
      applyOps(other, ops, 100, () => 'x');
      expect(other.select().from(libraryEntries).get()?.finishedAt).not.toBeNull();
    });

    it('matches marks by file name when the other device has other files', () => {
      showAsPodcast(db, ME, bookId, 5);
      setEpisodesPlayed(db, ME, bookId, ['e3'], true, 10);
      const ops = collectOps(db, 0);
      const other = createTestDb();
      // Named apart, and one file fewer: index 2 here is another episode.
      const otherBook = seedBook(
        other,
        'Bandeland',
        ['x/e1', 'x/e2', 'x/e4', 'x/e5'].map((location) => ({ location, durationMs: 40 * MIN })),
      );
      applyOps(other, ops, 100, () => 'x');
      expect(statuses(other, otherBook)).toEqual(['none', 'none', 'none', 'none']);
    });

    it('matches marks by file name when the other device names the folder apart', () => {
      showAsPodcast(db, ME, bookId, 5);
      setEpisodesPlayed(db, ME, bookId, ['e3'], true, 10);
      const ops = collectOps(db, 0);
      const other = createTestDb();
      const otherBook = seedBook(
        other,
        'Bandeland',
        ['y/e2', 'y/e3'].map((location) => ({ location, durationMs: 40 * MIN })),
      );
      other
        .update(bookFiles)
        .set({ name: sql`substr(${bookFiles.location}, 3)` })
        .run();
      applyOps(other, ops, 100, () => 'x');
      expect(statuses(other, otherBook)).toEqual(['none', 'played']);
    });

    it('queues one episode in Up Next on another device too', () => {
      showAsPodcast(db, ME, bookId, 5);
      addToUpNext(db, ME, bookId, 'last', 10, 'e3');
      const other = createTestDb();
      const otherBook = seedBook(other, 'Bandeland', FILES);
      applyOps(other, collectOps(db, 0), 100, () => 'x');
      expect(listUpNext(other, ME)[0]).toMatchObject({
        bookId: otherBook,
        durationMs: 40 * MIN,
        episode: { location: 'e3', title: 'e3' },
      });
    });

    it('marks the files a synced place passed in book view', () => {
      showAsPodcast(db, ME, bookId, 5);
      showAsBook(db, ME, bookId, 6);
      const other = createTestDb();
      const otherBook = seedBook(other, 'Bandeland', FILES);
      saveProgress(other, ME, {
        bookId: otherBook,
        fileLocation: 'e1',
        filePositionMs: MIN,
        savedAt: 1,
      });
      saveProgress(other, ME, {
        bookId: otherBook,
        fileLocation: 'e4',
        filePositionMs: MIN,
        savedAt: 2,
      });
      place(db, bookId, 'e1', MIN, 7);
      const ops = collectOps(other, 0).filter((op) => op.type === 'progress');
      applyOps(
        db,
        ops.map((op) => ({ ...op, at: 50 })),
        100,
        () => 'x',
      );
      showAsPodcast(db, ME, bookId, 60);
      expect(statuses(db, bookId)).toEqual(['played', 'played', 'played', 'started', 'none']);
    });

    it('brings the podcast view to a device that had the book as a book', () => {
      place(db, bookId, 'e3', MIN, 10);
      showAsPodcast(db, ME, bookId, 20);
      const ops = collectOps(db, 0);
      const other = createTestDb();
      const otherBook = seedBook(other, 'Bandeland', FILES);
      applyOps(other, ops, 100, () => 'x');
      expect(statuses(other, otherBook).slice(0, 3)).toEqual(['played', 'played', 'started']);
    });
  });
});
