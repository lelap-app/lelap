import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { resumePoint, saveProgress } from '../progress';
import { libraryEntries } from '../schema';
import { applyOps, collectOps } from '../sync/ops';
import { finishFromPlayer } from '../upNext';
import {
  bookSwitch,
  listFolderEpisodes,
  setEpisodesPlayed,
  showAsBook,
  showAsPodcast,
  skipPlayedEpisode,
  startEpisode,
} from './folderPodcast';
import { setFinished } from './queries';

const MIN = 60_000;
const FILES = ['e1', 'e2', 'e3', 'e4', 'e5'].map((location) => ({
  location,
  durationMs: 40 * MIN,
}));

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

  it('does not mark a file played when the listener jumped away from its middle', () => {
    showAsPodcast(db, ME, bookId, 5);
    place(db, bookId, 'e1', 10 * MIN, 10);
    place(db, bookId, 'e2', 2_000, 20);
    expect(listFolderEpisodes(db, ME, bookId)[0]).toMatchObject({
      status: 'started',
      positionMs: 10 * MIN,
    });
  });

  it('counts the files the service passed with the app closed', () => {
    showAsPodcast(db, ME, bookId, 5);
    place(db, bookId, 'e1', MIN, 10);
    saveProgress(
      db,
      ME,
      { bookId, fileLocation: 'e3', filePositionMs: MIN, savedAt: 20 },
      'journal',
    );
    expect(statuses(db, bookId)).toEqual(['played', 'played', 'started', 'none', 'none']);
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
