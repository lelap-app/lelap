/**
 * Intro and outro skipping for a podcast (M45). The same rules run in the Android service
 * (`SeekRules` in modules/audio) and in the web player; keep them in step.
 */

/** Seconds a listener can pick for a show's intro or outro. */
export const TRIM_STEPS_S = [0, 15, 30, 45, 60, 90] as const;

/**
 * Where an episode starts: past the intro from the episode's start (a new episode, or one started
 * again), otherwise the place minus smart rewind, which never goes back into the intro once the
 * place is past it. A place inside the intro stays there: the listener went back to hear it. Only
 * the first file has an intro.
 */
export function trimmedStart(
  index: number,
  positionMs: number,
  rewindMs: number,
  introMs: number,
): number {
  const intro = index === 0 ? Math.max(0, introMs) : 0;
  if (positionMs <= 0) return intro;
  const floor = positionMs >= intro ? intro : 0;
  return Math.max(floor, positionMs - Math.max(0, rewindMs));
}

/**
 * Where in the last file the episode counts as played to its end, or null to play it all. An
 * outro that would leave less than a minute after the intro is not applied: the feed's duration
 * may be wrong, and a short episode is kept whole.
 */
export function outroStartMs(
  durationMs: number,
  outroMs: number,
  introMs: number,
  singleFile: boolean,
): number | null {
  if (outroMs <= 0 || durationMs <= 0) return null;
  const at = durationMs - outroMs;
  const floor = (singleFile ? Math.max(0, introMs) : 0) + 60_000;
  return at >= floor ? at : null;
}
