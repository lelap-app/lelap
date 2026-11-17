// Sleep timer rules shared by the web player; the Android service has the same in
// `SleepBoundary.kt` and `SleepTimer.kt`.

export const SLEEP_FADE_MS = 60_000;

/** Volume for the fade: full until the last minute, then linear down to silence. */
export function fadeVolume(remainingMs: number, fadeMs = SLEEP_FADE_MS): number {
  if (remainingMs >= fadeMs) return 1;
  if (remainingMs <= 0) return 0;
  return remainingMs / fadeMs;
}

/**
 * The whole-book position where a timer for the end of the chapter (or episode) stops. The rule:
 * it ends at the end of whatever chapter is playing. Playback never crosses that end, so it only
 * moves when the listener seeks or skips into another chapter. Without chapter marks the files
 * act as chapters.
 */
export function sleepBoundaryMs(
  mode: 'chapter' | 'episode',
  bookPositionMs: number,
  chapterStarts: number[],
  durations: number[],
): number {
  const total = durations.reduce((sum, d) => sum + Math.max(0, d), 0);
  if (mode === 'episode') return total;
  const marks = chapterStarts.filter((s) => s > 0);
  let ends: number[];
  if (marks.length > 0) ends = [...marks, total];
  else {
    let sum = 0;
    ends = durations.map((d) => (sum += Math.max(0, d)));
  }
  return ends.sort((a, b) => a - b).find((end) => end > bookPositionMs) ?? total;
}

/** The file and offset of a boundary; one on a file's end belongs to that file. */
export function sleepFileTarget(
  boundaryMs: number,
  durations: number[],
): { index: number; positionMs: number; atFileEnd: boolean } {
  let offset = 0;
  for (const [index, d] of durations.entries()) {
    const length = Math.max(0, d);
    if (boundaryMs < offset + length) {
      return { index, positionMs: boundaryMs - offset, atFileEnd: false };
    }
    if (boundaryMs === offset + length) return { index, positionMs: length, atFileEnd: true };
    offset += length;
  }
  const last = Math.max(0, durations.length - 1);
  return { index: last, positionMs: Math.max(0, durations[last] ?? 0), atFileEnd: true };
}

/** Listening time left at [speed]; negative once playback has passed the boundary. */
export function sleepRemainingMs(
  boundaryMs: number,
  bookPositionMs: number,
  speed: number,
): number {
  return (boundaryMs - bookPositionMs) / Math.min(3, Math.max(0.5, speed));
}

/**
 * Whether a media error on a stream is worth one more request: add-ons with expiring links hand
 * out a `/resolve/…` URL that redirects to a fresh one, and an `<audio>` element can't see the
 * 403 or 410 itself, only a network or source error. Local files never expire.
 */
export function shouldRefreshLink(
  mediaErrorCode: number,
  uri: string,
  refreshed: boolean,
): boolean {
  if (refreshed || !/^https?:\/\//i.test(uri)) return false;
  // MEDIA_ERR_NETWORK and MEDIA_ERR_SRC_NOT_SUPPORTED; aborts and decode errors are not links.
  return mediaErrorCode === 2 || mediaErrorCode === 4;
}
