// The low headphone battery banner (M33). Android reports a Bluetooth device's level in steps of
// ten when it changes; the estimate stays on the safe side, so the warning comes early, not late.

/** A level reported by the device, in percent, and when it arrived. */
export type BatterySample = { at: number; level: number };

/** Percent per hour assumed when the device has not reported long enough to measure its drain. */
export const ASSUMED_DRAIN_PER_HOUR = 20;
/** With nothing coming that needs a length of time, warn at this level or below. */
export const LOW_BATTERY_PERCENT = 20;
// Measured over less than this, a drop of one step says little.
const MIN_MEASURE_MS = 15 * 60_000;
// The battery should last this much longer than what is coming.
const SAFETY = 1.25;

/**
 * Percent per hour: what the samples show, but never less than [ASSUMED_DRAIN_PER_HOUR]. Samples
 * are in the order they arrived; a rise (charging, another earbud) starts the measure again.
 */
export function drainPerHour(samples: BatterySample[]): number {
  let from: BatterySample | undefined;
  for (const sample of samples) {
    if (!from || sample.level > from.level) from = sample;
  }
  const last = samples.at(-1);
  if (!from || !last || last.at - from.at < MIN_MEASURE_MS) return ASSUMED_DRAIN_PER_HOUR;
  const measured = ((from.level - last.level) / (last.at - from.at)) * 3_600_000;
  return Math.max(ASSUMED_DRAIN_PER_HOUR, measured);
}

/** Listening time the battery likely has left, in milliseconds. */
export function batteryLeftMs(level: number, samples: BatterySample[]): number {
  return (Math.max(0, level) / drainPerHour(samples)) * 3_600_000;
}

/**
 * Whether to warn: when the battery likely won't last [needMs] (the sleep timer, else the rest of
 * the chapter), or, with nothing to measure against, at [LOW_BATTERY_PERCENT] or below.
 */
export function headphoneWarning(
  level: number | null,
  samples: BatterySample[],
  needMs: number | null,
): boolean {
  if (level === null || level < 0) return false;
  if (needMs === null || needMs <= 0) return level <= LOW_BATTERY_PERCENT;
  return batteryLeftMs(level, samples) < needMs * SAFETY;
}
