import { describe, expect, it } from 'vitest';

import {
  fadeVolume,
  shouldRefreshLink,
  sleepBoundaryMs,
  sleepFileTarget,
  sleepStopChoices,
  sleepRemainingMs,
} from './sleep';

// Three files of 10 minutes; chapters at 0, 4 and 25 minutes.
const durations = [600_000, 600_000, 600_000];
const chapters = [0, 240_000, 1_500_000];

describe('sleep boundary', () => {
  it('ends a chapter at the next mark', () => {
    expect(sleepBoundaryMs('chapter', 10_000, chapters, durations)).toBe(240_000);
    expect(sleepBoundaryMs('chapter', 240_000, chapters, durations)).toBe(1_500_000);
  });

  it('ends the last chapter and the episode with the book', () => {
    expect(sleepBoundaryMs('chapter', 1_600_000, chapters, durations)).toBe(1_800_000);
    expect(sleepBoundaryMs('episode', 10_000, chapters, durations)).toBe(1_800_000);
  });

  it('uses file ends without chapter marks', () => {
    expect(sleepBoundaryMs('chapter', 700_000, [], durations)).toBe(1_200_000);
    expect(sleepBoundaryMs('chapter', 0, [0], durations)).toBe(600_000);
  });

  it('maps a boundary to its file', () => {
    expect(sleepFileTarget(240_000, durations)).toEqual({
      index: 0,
      positionMs: 240_000,
      atFileEnd: false,
    });
    expect(sleepFileTarget(1_200_000, durations)).toEqual({
      index: 1,
      positionMs: 600_000,
      atFileEnd: true,
    });
    expect(sleepFileTarget(1_800_000, durations)).toEqual({
      index: 2,
      positionMs: 600_000,
      atFileEnd: true,
    });
  });

  it('counts listening time at the playback speed', () => {
    expect(sleepRemainingMs(240_000, 180_000, 1)).toBe(60_000);
    expect(sleepRemainingMs(240_000, 180_000, 2)).toBe(30_000);
    expect(sleepRemainingMs(240_000, 242_000, 1)).toBe(-2_000);
  });

  it('fades over the last minute', () => {
    expect(fadeVolume(120_000)).toBe(1);
    expect(fadeVolume(30_000)).toBe(0.5);
    expect(fadeVolume(-1)).toBe(0);
  });
});

describe('expiring links', () => {
  it('asks a stream again once after a network or source error', () => {
    expect(shouldRefreshLink(2, 'https://addon.example/resolve/abc', false)).toBe(true);
    expect(shouldRefreshLink(4, 'https://addon.example/resolve/abc', false)).toBe(true);
    expect(shouldRefreshLink(4, 'https://addon.example/resolve/abc', true)).toBe(false);
  });

  it('leaves local files and decode errors alone', () => {
    expect(shouldRefreshLink(2, 'file://books/a.mp3', false)).toBe(false);
    expect(shouldRefreshLink(3, 'https://addon.example/a.mp3', false)).toBe(false);
  });
});

describe('sleep stop choices', () => {
  const min = 60_000;
  const night = 1_000_000_000;
  // Stopped 90 min into the book; last used 18 min before, at minute 72.
  const stop = {
    bookId: 'b',
    stoppedMs: 90 * min,
    stoppedAt: night,
    usedMs: 72 * min,
    usedAt: night - 18 * min,
  };

  it('offers the last touch and a few minutes back, about where the timer stopped', () => {
    expect(sleepStopChoices(stop, 'b', 90 * min, night + 8 * 60 * min)).toEqual({
      lastUsed: { positionMs: 72 * min, at: night - 18 * min, beforeStopMs: 18 * min },
      back: [
        { minutes: 5, positionMs: 85 * min },
        { minutes: 10, positionMs: 80 * min },
        { minutes: 15, positionMs: 75 * min },
      ],
    });
    // Smart rewind moved back a few seconds.
    expect(sleepStopChoices(stop, 'b', 90 * min - 10_000, night + min)).not.toBeNull();
  });

  it('offers only the minutes back without a touch worth naming', () => {
    const untouched = { ...stop, usedMs: null, usedAt: null };
    expect(sleepStopChoices(untouched, 'b', 90 * min, night)?.lastUsed).toBeNull();
    const justBefore = { ...stop, usedMs: 89.5 * min, usedAt: night - 30_000 };
    expect(sleepStopChoices(justBefore, 'b', 90 * min, night)?.lastUsed).toBeNull();
  });

  it('leaves out choices before the start of the book', () => {
    const early = { ...stop, stoppedMs: 7 * min, usedMs: null, usedAt: null };
    expect(sleepStopChoices(early, 'b', 7 * min, night)?.back).toEqual([
      { minutes: 5, positionMs: 2 * min },
    ]);
    const start = { ...early, stoppedMs: 3 * min };
    expect(sleepStopChoices(start, 'b', 3 * min, night)).toBeNull();
  });

  it('stops offering once the listener plays on, in another book, or a day later', () => {
    expect(sleepStopChoices(stop, 'b', 93 * min, night)).toBeNull();
    expect(sleepStopChoices(stop, 'other', 90 * min, night)).toBeNull();
    expect(sleepStopChoices(stop, 'b', 90 * min, night + 25 * 60 * min)).toBeNull();
    expect(sleepStopChoices(null, 'b', 90 * min, night)).toBeNull();
  });
});
