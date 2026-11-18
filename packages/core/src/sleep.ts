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

/**
 * Where and when the sleep timer stopped playback, and where and when the listener last used the
 * player before that (M86). Lelap can't know when someone fell asleep; the last touch is the last
 * moment they surely were awake.
 */
export type SleepStop = {
  bookId: string;
  stoppedMs: number;
  stoppedAt: number;
  usedMs: number | null;
  usedAt: number | null;
};

/** The choices after a stop, as whole-book places; the listener picks, nothing jumps by itself. */
export type SleepStopChoices = {
  /** Back to the last touch, with how long before the stop it was; null without one worth offering. */
  lastUsed: { positionMs: number; at: number; beforeStopMs: number } | null;
  /** A few minutes back from the stop. */
  back: { minutes: number; positionMs: number }[];
};

/** The offer stands while the place is this close to where the timer stopped. */
export const SLEEP_STOP_RANGE_MS = 2 * 60_000;
/** A night's stop is offered for this long: the next morning, not next week. */
export const SLEEP_STOP_KEEP_MS = 24 * 60 * 60_000;
export const SLEEP_STOP_BACK_MINUTES = [5, 10, 15];
/** A touch this close to the stop says nothing the quick choices don't. */
const LAST_USED_MIN_MS = 60_000;

/**
 * What to offer for the book in the player after the timer stopped it: only for the same book,
 * still about where it stopped (smart rewind moves back a few seconds; listening on moves past),
 * and within a day. Null when there is nothing to offer.
 */
export function sleepStopChoices(
  stop: SleepStop | null,
  bookId: string,
  bookPositionMs: number,
  now: number,
): SleepStopChoices | null {
  if (!stop || stop.bookId !== bookId) return null;
  if (now < stop.stoppedAt || now - stop.stoppedAt > SLEEP_STOP_KEEP_MS) return null;
  if (Math.abs(bookPositionMs - stop.stoppedMs) > SLEEP_STOP_RANGE_MS) return null;
  const used =
    stop.usedMs !== null &&
    stop.usedAt !== null &&
    stop.usedMs < stop.stoppedMs &&
    stop.stoppedAt - stop.usedAt >= LAST_USED_MIN_MS
      ? { positionMs: stop.usedMs, at: stop.usedAt, beforeStopMs: stop.stoppedAt - stop.usedAt }
      : null;
  const back = SLEEP_STOP_BACK_MINUTES.filter((m) => stop.stoppedMs - m * 60_000 > 0).map(
    (minutes) => ({ minutes, positionMs: stop.stoppedMs - minutes * 60_000 }),
  );
  if (!used && back.length === 0) return null;
  return { lastUsed: used, back };
}
