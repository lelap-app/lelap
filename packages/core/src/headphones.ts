// The low headphone battery banner (M33). Android reports a Bluetooth device's level in steps of
// ten when it changes; the estimate stays on the safe side, so the warning comes early, not late.

/** A level reported by the device, in percent, and when it arrived. */
export type BatterySample = { at: number; level: number };

/** Percent per hour assumed when the device has not reported long enough to measure its drain. */
export const ASSUMED_DRAIN_PER_HOUR = 20;
/** Earbuds rarely last past 12 hours of listening; a slower measure is a fluke. */
export const MIN_DRAIN_PER_HOUR = 8;
/** With nothing coming that needs a length of time, warn at this level or below. */
export const LOW_BATTERY_PERCENT = 20;
// Measured over less than this, a drop of one step says little.
const MIN_MEASURE_MS = 15 * 60_000;
// Between two drops a measure is exact to the step; over less than this it is still too rough.
const MIN_STEP_MEASURE_MS = 30 * 60_000;
// The battery should last this much longer than what is coming.
const SAFETY = 1.25;

/** The samples since the level last rose (charging, another earbud), in the order they arrived. */
function sinceLastRise(samples: BatterySample[]): BatterySample[] {
  let start = 0;
  samples.forEach((s, i) => {
    const before = samples[i - 1];
    if (before && s.level > before.level) start = i;
  });
  return samples.slice(start);
}

/**
 * The drain the device really shows, in percent per hour, or null when it can't tell yet. Only
 * the reports where the level fell count: each comes the moment a step is crossed, so the time
 * between the first and the last of them is exact, while the first report at connection is not.
 */
export function measuredDrain(samples: BatterySample[]): number | null {
  const run = sinceLastRise(samples);
  const drops = run.filter((s, i) => {
    const before = run[i - 1];
    return before !== undefined && s.level < before.level;
  });
  const first = drops[0];
  const last = drops.at(-1);
  if (!first || !last || last.at - first.at < MIN_STEP_MEASURE_MS) return null;
  return ((first.level - last.level) / (last.at - first.at)) * 3_600_000;
}

/**
 * What to remember for a device after listening: the drain measured now, averaged with what was
 * learned before, so one odd session moves it only halfway. Null while nothing is known.
 */
export function learnDrain(learned: number | null, samples: BatterySample[]): number | null {
  const measured = measuredDrain(samples);
  if (measured === null) return learned;
  const next = learned === null ? measured : (learned + measured) / 2;
  return Math.round(next * 10) / 10;
}

/**
 * Percent per hour: what the samples show between drops (or most of what this device showed
 * before, if that is faster), else what it showed before
 * ([learned]), else the rough measure since connection but never less than
 * [ASSUMED_DRAIN_PER_HOUR]. Samples are in the order they arrived; a rise starts the measure again.
 */
export function drainPerHour(samples: BatterySample[], learned: number | null = null): number {
  const measured = measuredDrain(samples);
  // One slow stretch now can't undo much of what earlier sessions showed.
  if (measured !== null) return Math.max(MIN_DRAIN_PER_HOUR, measured, (learned ?? 0) * 0.75);
  const run = sinceLastRise(samples);
  const from = run[0];
  const last = run.at(-1);
  const rough =
    from && last && last.at - from.at >= MIN_MEASURE_MS
      ? ((from.level - last.level) / (last.at - from.at)) * 3_600_000
      : null;
  if (learned !== null) return Math.max(MIN_DRAIN_PER_HOUR, learned, rough ?? 0);
  return Math.max(ASSUMED_DRAIN_PER_HOUR, rough ?? 0);
}

/** Listening time the battery likely has left, in milliseconds. */
export function batteryLeftMs(
  level: number,
  samples: BatterySample[],
  learned: number | null = null,
): number {
  return (Math.max(0, level) / drainPerHour(samples, learned)) * 3_600_000;
}

/**
 * Whether to warn: when the battery likely won't last [needMs] (the sleep timer, else the rest of
 * the chapter), or, with nothing to measure against, at [LOW_BATTERY_PERCENT] or below.
 */
export function headphoneWarning(
  level: number | null,
  samples: BatterySample[],
  needMs: number | null,
  learned: number | null = null,
): boolean {
  if (level === null || level < 0) return false;
  if (needMs === null || needMs <= 0) return level <= LOW_BATTERY_PERCENT;
  return batteryLeftMs(level, samples, learned) < needMs * SAFETY;
}

/** A Bluetooth device the listener marked as their car, since some cars report as headphones. */
export type MarkedCar = { id: string; name: string };

/** The marked cars as stored on this device; anything unreadable counts as none. */
export function parseMarkedCars(json: string | null): MarkedCar[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (c): c is MarkedCar =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as MarkedCar).id === 'string' &&
        typeof (c as MarkedCar).name === 'string',
    );
  } catch {
    return [];
  }
}

/** The list with [device] marked as a car or not; the latest name wins. */
export function markCar(cars: MarkedCar[], device: MarkedCar, car: boolean): MarkedCar[] {
  const others = cars.filter((c) => c.id !== device.id);
  return car ? [...others, { id: device.id, name: device.name }] : others;
}

/** A car by its Bluetooth class (car audio, hands-free) or because the listener said so. */
export function isCar(device: { id: string; car: boolean }, cars: MarkedCar[]): boolean {
  return device.car || cars.some((c) => c.id === device.id);
}
