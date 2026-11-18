import { describe, expect, it } from 'vitest';

import { groupByProgress, listeningStatus } from './byProgress';
import type { LibraryBook } from './queries';

const book = (id: string, over: Partial<LibraryBook> = {}): LibraryBook => ({
  id,
  title: id,
  author: null,
  coverPath: null,
  coverUrl: null,
  source: 'local',
  downloaded: false,
  durationMs: 3_600_000,
  bookPositionMs: 0,
  addedAt: 0,
  finishedAt: null,
  lastPlayedAt: null,
  missing: false,
  ...over,
});

const ids = (list: LibraryBook[]) => list.map((b) => b.id);

describe('listeningStatus', () => {
  it('calls a book with no place and no play time not started', () => {
    expect(listeningStatus(book('a'))).toBe('notStarted');
  });

  it('calls a book started from a place or from a play time', () => {
    expect(listeningStatus(book('a', { bookPositionMs: 1 }))).toBe('inProgress');
    // Played for a moment and back at 0:00, as Continue listening sees it.
    expect(listeningStatus(book('a', { lastPlayedAt: 5 }))).toBe('inProgress');
  });

  it('keeps a finished book finished when it is played again', () => {
    expect(
      listeningStatus(book('a', { finishedAt: 10, lastPlayedAt: 20, bookPositionMs: 500 })),
    ).toBe('finished');
  });

  it('reads episodes the same way as books', () => {
    expect(listeningStatus(book('e', { source: 'feed' }))).toBe('notStarted');
    expect(listeningStatus(book('e', { source: 'feed', bookPositionMs: 9 }))).toBe('inProgress');
    expect(listeningStatus(book('e', { source: 'feed', finishedAt: 1 }))).toBe('finished');
  });
});

describe('groupByProgress', () => {
  it('splits books and episodes into the three groups', () => {
    const groups = groupByProgress([
      book('new'),
      book('started', { bookPositionMs: 10, lastPlayedAt: 1 }),
      book('done', { finishedAt: 1 }),
      book('episode', { source: 'feed', lastPlayedAt: 2 }),
    ]);
    expect(ids(groups.inProgress)).toEqual(['episode', 'started']);
    expect(ids(groups.notStarted)).toEqual(['new']);
    expect(ids(groups.finished)).toEqual(['done']);
  });

  it('orders In progress by last played, newest first', () => {
    const groups = groupByProgress([
      book('old', { lastPlayedAt: 10, addedAt: 99 }),
      book('newest', { lastPlayedAt: 30 }),
      book('middle', { lastPlayedAt: 20 }),
    ]);
    expect(ids(groups.inProgress)).toEqual(['newest', 'middle', 'old']);
  });

  it('puts started books without a play time after the played ones, newest added first', () => {
    const groups = groupByProgress([
      book('imported old', { bookPositionMs: 5, addedAt: 1 }),
      book('played', { bookPositionMs: 5, lastPlayedAt: 1 }),
      book('imported new', { bookPositionMs: 5, addedAt: 2 }),
    ]);
    expect(ids(groups.inProgress)).toEqual(['played', 'imported new', 'imported old']);
  });

  it('orders Not started by last added, newest first', () => {
    const groups = groupByProgress([
      book('first', { addedAt: 1 }),
      book('third', { addedAt: 3 }),
      book('second', { addedAt: 2 }),
    ]);
    expect(ids(groups.notStarted)).toEqual(['third', 'second', 'first']);
  });

  it('orders Finished by when it was finished, not when it was last played', () => {
    const groups = groupByProgress([
      book('finished long ago, played again', { finishedAt: 1, lastPlayedAt: 100 }),
      book('finished last', { finishedAt: 50, lastPlayedAt: 50 }),
    ]);
    expect(ids(groups.finished)).toEqual(['finished last', 'finished long ago, played again']);
    expect(groups.inProgress).toEqual([]);
  });

  it('breaks ties by title in natural order', () => {
    const groups = groupByProgress([
      book('Part 10', { lastPlayedAt: 5 }),
      book('Part 9', { lastPlayedAt: 5 }),
      book('B', { addedAt: 1 }),
      book('A', { addedAt: 1 }),
      book('Y', { finishedAt: 3, lastPlayedAt: 3 }),
      book('X', { finishedAt: 3, lastPlayedAt: 3 }),
    ]);
    expect(ids(groups.inProgress)).toEqual(['Part 9', 'Part 10']);
    expect(ids(groups.notStarted)).toEqual(['A', 'B']);
    expect(ids(groups.finished)).toEqual(['X', 'Y']);
  });

  it('gives empty groups for an empty library and leaves the input alone', () => {
    expect(groupByProgress([])).toEqual({ inProgress: [], notStarted: [], finished: [] });
    const list = [book('b', { addedAt: 1 }), book('a', { addedAt: 2 })];
    groupByProgress(list);
    expect(ids(list)).toEqual(['b', 'a']);
  });
});
