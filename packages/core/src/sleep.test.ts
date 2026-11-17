import { describe, expect, it } from 'vitest';

import {
  fadeVolume,
  shouldRefreshLink,
  sleepBoundaryMs,
  sleepFileTarget,
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
