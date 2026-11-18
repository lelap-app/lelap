import { describe, expect, it } from 'vitest';

import { chapterAt, chapterJump, mediaSpan, toBookPosition, toFilePosition } from './timeline';

const files = [
  { location: 'a', durationMs: 1000 },
  { location: 'b', durationMs: 2000 },
  { location: 'c', durationMs: 500 },
];

describe('toBookPosition', () => {
  it('adds the earlier files’ durations', () => {
    expect(toBookPosition(files, 'c', 100)).toBe(3100);
  });

  it('is 0 for an unknown file', () => {
    expect(toBookPosition(files, 'x', 100)).toBe(0);
  });

  it('never goes negative', () => {
    expect(toBookPosition(files, 'a', -50)).toBe(0);
  });
});

describe('toFilePosition', () => {
  it('finds the file and the offset in it', () => {
    expect(toFilePosition(files, 1500)).toEqual({ index: 1, location: 'b', positionMs: 500 });
  });

  it('puts a file boundary at the start of the next file', () => {
    expect(toFilePosition(files, 1000)).toEqual({ index: 1, location: 'b', positionMs: 0 });
  });

  it('clamps past the end to the end of the last file', () => {
    expect(toFilePosition(files, 99_999)).toEqual({ index: 2, location: 'c', positionMs: 500 });
  });

  it('round-trips through a file of unknown duration', () => {
    const unknown = [
      { location: 'a', durationMs: 1000 },
      { location: 'b', durationMs: 0 },
      { location: 'c', durationMs: 0 },
    ];
    const book = toBookPosition(unknown, 'b', 7000);
    expect(book).toBe(8000);
    expect(toFilePosition(unknown, book)).toEqual({ index: 1, location: 'b', positionMs: 7000 });
  });

  it('starts an empty book at zero', () => {
    expect(toFilePosition([], 500)).toEqual({ index: 0, location: '', positionMs: 0 });
  });
});

describe('chapterAt', () => {
  const chapters = [{ startMs: 0 }, { startMs: 100 }, { startMs: 200 }];

  it('returns the chapter that starts exactly there', () => {
    expect(chapterAt(chapters, 100)).toBe(1);
  });

  it('returns the last chapter that started before', () => {
    expect(chapterAt(chapters, 199)).toBe(1);
    expect(chapterAt(chapters, 5000)).toBe(2);
  });

  it('is -1 without chapters', () => {
    expect(chapterAt([], 50)).toBe(-1);
  });
});

describe('mediaSpan', () => {
  const chapters = [{ startMs: 0 }, { startMs: 60_000 }, { startMs: 150_000 }];

  it('is the chapter playing', () => {
    expect(mediaSpan(chapters, 200_000, 0)).toEqual({ startMs: 0, lengthMs: 60_000 });
    expect(mediaSpan(chapters, 200_000, 90_000)).toEqual({ startMs: 60_000, lengthMs: 90_000 });
    expect(mediaSpan(chapters, 200_000, 199_000)).toEqual({ startMs: 150_000, lengthMs: 50_000 });
  });

  it('is the whole book without chapters', () => {
    expect(mediaSpan([], 200_000, 90_000)).toEqual({ startMs: 0, lengthMs: 200_000 });
  });

  it('runs up to the first chapter before it starts', () => {
    expect(mediaSpan([{ startMs: 5_000 }], 20_000, 1_000)).toEqual({ startMs: 0, lengthMs: 5_000 });
  });

  it('is the whole book when the chapters run past the files', () => {
    expect(mediaSpan(chapters, 100_000, 160_000)).toEqual({ startMs: 0, lengthMs: 100_000 });
  });
});

describe('chapterJump', () => {
  const chapters = [{ startMs: 0 }, { startMs: 60_000 }, { startMs: 120_000 }];

  it('goes to the next chapter, or nowhere from the last', () => {
    expect(chapterJump(chapters, 70_000, true)).toBe(120_000);
    expect(chapterJump(chapters, 130_000, true)).toBeNull();
    expect(chapterJump([], 5_000, true)).toBeNull();
  });

  it('restarts the chapter playing, or goes to the one before near its start', () => {
    expect(chapterJump(chapters, 70_000, false)).toBe(60_000);
    expect(chapterJump(chapters, 61_000, false)).toBe(0);
    expect(chapterJump(chapters, 1_000, false)).toBe(0);
    expect(chapterJump([], 50_000, false)).toBe(0);
  });
});
