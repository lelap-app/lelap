import { describe, expect, it } from 'vitest';

import { parseTime, scrubRate, snapTo, zoomWindow } from './seek';

describe('zoomWindow', () => {
  const min = 60_000;
  it('covers five minutes either side of the playhead', () => {
    expect(zoomWindow(30 * min, 60 * min)).toEqual({ startMs: 25 * min, endMs: 35 * min });
  });
  it('stays inside the range at its start and end', () => {
    expect(zoomWindow(2 * min, 60 * min)).toEqual({ startMs: 0, endMs: 10 * min });
    expect(zoomWindow(59 * min, 60 * min)).toEqual({ startMs: 50 * min, endMs: 60 * min });
  });
  it('has nothing to zoom in a range of ten minutes or less', () => {
    expect(zoomWindow(3 * min, 10 * min)).toBeNull();
  });
});

describe('parseTime', () => {
  it('reads clocks, minutes and units', () => {
    expect(parseTime('2:14:30')).toBe((2 * 3600 + 14 * 60 + 30) * 1000);
    expect(parseTime('14:30')).toBe((14 * 60 + 30) * 1000);
    expect(parseTime('90')).toBe(90 * 60_000);
    expect(parseTime('1h 5m')).toBe(65 * 60_000);
    expect(parseTime('45s')).toBe(45_000);
    expect(parseTime(' 0:05 ')).toBe(5_000);
  });

  it('refuses what is not a time', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('1:75')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('1:2:3:4')).toBeNull();
  });
});

describe('scrubRate', () => {
  it('slows down the further the finger is from the bar', () => {
    expect([0, 60, 130, 300, -300].map(scrubRate)).toEqual([1, 0.5, 0.25, 0.1, 0.1]);
  });
});

describe('snapTo', () => {
  it('snaps to the closest mark within reach', () => {
    expect(snapTo(1000, [0, 980, 1100], 50)).toBe(980);
    expect(snapTo(1000, [0, 2000], 50)).toBeNull();
  });
});
