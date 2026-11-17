import { describe, expect, it } from 'vitest';

import { outroStartMs, trimmedStart } from './trim';

describe('trimmedStart', () => {
  it('starts a new episode after its intro', () => {
    expect(trimmedStart(0, 0, 0, 30_000)).toBe(30_000);
  });

  it('keeps a place past the intro, and smart rewind stops at the intro', () => {
    expect(trimmedStart(0, 600_000, 15_000, 30_000)).toBe(585_000);
    expect(trimmedStart(0, 35_000, 15_000, 30_000)).toBe(30_000);
  });

  it('has no intro after the first file, or without one', () => {
    expect(trimmedStart(1, 0, 0, 30_000)).toBe(0);
    expect(trimmedStart(0, 10_000, 5_000, 0)).toBe(5_000);
  });
});

describe('outroStartMs', () => {
  it('ends the episode the outro before its end', () => {
    expect(outroStartMs(1_800_000, 60_000, 30_000, true)).toBe(1_740_000);
  });

  it('plays it all without an outro, a duration, or when little would be left', () => {
    expect(outroStartMs(1_800_000, 0, 0, true)).toBeNull();
    expect(outroStartMs(0, 60_000, 0, true)).toBeNull();
    expect(outroStartMs(150_000, 60_000, 60_000, true)).toBeNull();
    expect(outroStartMs(150_000, 60_000, 60_000, false)).toBe(90_000);
  });
});
