import { describe, expect, it } from 'vitest';

import {
  ASSUMED_DRAIN_PER_HOUR,
  batteryLeftMs,
  drainPerHour,
  headphoneWarning,
} from './headphones';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('headphone battery', () => {
  it('assumes a drain until it can measure one', () => {
    expect(drainPerHour([])).toBe(ASSUMED_DRAIN_PER_HOUR);
    expect(
      drainPerHour([
        { at: 0, level: 60 },
        { at: 5 * MIN, level: 50 },
      ]),
    ).toBe(ASSUMED_DRAIN_PER_HOUR);
  });

  it('uses a faster measured drain, never a slower one', () => {
    const fast = [
      { at: 0, level: 80 },
      { at: 30 * MIN, level: 60 },
    ];
    expect(drainPerHour(fast)).toBe(40);
    const slow = [
      { at: 0, level: 80 },
      { at: 2 * HOUR, level: 70 },
    ];
    expect(drainPerHour(slow)).toBe(ASSUMED_DRAIN_PER_HOUR);
  });

  it('measures again after the level rises', () => {
    const charged = [
      { at: 0, level: 90 },
      { at: HOUR, level: 30 },
      { at: 2 * HOUR, level: 80 },
      { at: 2 * HOUR + 10 * MIN, level: 70 },
    ];
    expect(drainPerHour(charged)).toBe(ASSUMED_DRAIN_PER_HOUR);
  });

  it('estimates the time left', () => {
    expect(batteryLeftMs(50, [])).toBe(2.5 * HOUR);
  });

  it('warns when the battery won’t last the timer or chapter', () => {
    // 30 % lasts 90 minutes at the assumed drain.
    expect(headphoneWarning(30, [], 60 * MIN)).toBe(false);
    expect(headphoneWarning(30, [], 80 * MIN)).toBe(true);
  });

  it('falls back to a threshold with nothing to measure against', () => {
    expect(headphoneWarning(25, [], null)).toBe(false);
    expect(headphoneWarning(20, [], null)).toBe(true);
  });

  it('says nothing for a device that reports no level', () => {
    expect(headphoneWarning(null, [], 10 * HOUR)).toBe(false);
    expect(headphoneWarning(-1, [], null)).toBe(false);
  });
});
