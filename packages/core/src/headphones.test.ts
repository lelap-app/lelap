import { describe, expect, it } from 'vitest';

import {
  ASSUMED_DRAIN_PER_HOUR,
  batteryLeftMs,
  drainPerHour,
  headphoneWarning,
  isCar,
  learnDrain,
  markCar,
  measuredDrain,
  MIN_DRAIN_PER_HOUR,
  parseMarkedCars,
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

  // Earbuds that last ten hours: connected at 95 % (reported 90), then a step every hour.
  const tenHours = [
    { at: 0, level: 90 },
    { at: 30 * MIN, level: 80 },
    { at: 90 * MIN, level: 70 },
    { at: 150 * MIN, level: 60 },
  ];

  it('measures between drops, slower than assumed when the earbuds show it', () => {
    expect(measuredDrain(tenHours)).toBe(10);
    expect(drainPerHour(tenHours)).toBe(10);
    // One drop alone, or two close together, can't tell yet.
    expect(measuredDrain(tenHours.slice(0, 2))).toBeNull();
    expect(
      measuredDrain([
        { at: 0, level: 50 },
        { at: 10 * MIN, level: 40 },
        { at: 20 * MIN, level: 30 },
      ]),
    ).toBeNull();
  });

  it('never trusts a drain slower than the floor', () => {
    const slow = [
      { at: 0, level: 90 },
      { at: HOUR, level: 80 },
      { at: 5 * HOUR, level: 70 },
    ];
    expect(measuredDrain(slow)).toBe(2.5);
    expect(drainPerHour(slow)).toBe(MIN_DRAIN_PER_HOUR);
  });

  it('uses what a device showed before until it can measure again', () => {
    expect(drainPerHour([], 8)).toBe(8);
    expect(drainPerHour([{ at: 0, level: 70 }], 2)).toBe(MIN_DRAIN_PER_HOUR);
    // A faster rough measure since connection still wins, to stay on the safe side.
    expect(
      drainPerHour(
        [
          { at: 0, level: 80 },
          { at: 30 * MIN, level: 60 },
        ],
        8,
      ),
    ).toBe(40);
    // 30 % lasts three hours at 10 % per hour, so a two-hour timer gets no warning.
    expect(batteryLeftMs(30, [], 10)).toBe(3 * HOUR);
    expect(headphoneWarning(30, [], 2 * HOUR, 10)).toBe(false);
    expect(headphoneWarning(30, [], 2 * HOUR)).toBe(true);
  });

  it('learns a device’s drain halfway from each session', () => {
    expect(learnDrain(null, [])).toBeNull();
    expect(learnDrain(12, [])).toBe(12);
    expect(learnDrain(null, tenHours)).toBe(10);
    expect(learnDrain(20, tenHours)).toBe(15);
  });
});

describe('marked cars', () => {
  const kia = { id: 'AA:BB', name: 'Kia' };

  it('reads what was stored and ignores anything else', () => {
    expect(parseMarkedCars(null)).toEqual([]);
    expect(parseMarkedCars('not json')).toEqual([]);
    expect(parseMarkedCars('{"id":"x"}')).toEqual([]);
    expect(parseMarkedCars(JSON.stringify([kia, { id: 1 }, null]))).toEqual([kia]);
  });

  it('marks and unmarks a device, keeping its latest name', () => {
    const marked = markCar([], kia, true);
    expect(marked).toEqual([kia]);
    expect(markCar(marked, { id: 'AA:BB', name: 'My Kia' }, true)).toEqual([
      { id: 'AA:BB', name: 'My Kia' },
    ]);
    expect(markCar(marked, kia, false)).toEqual([]);
  });

  it('counts a car by its class or by the mark', () => {
    expect(isCar({ id: 'x', car: true }, [])).toBe(true);
    expect(isCar({ id: 'AA:BB', car: false }, [kia])).toBe(true);
    expect(isCar({ id: 'CC:DD', car: false }, [kia])).toBe(false);
  });
});
