// A clip (M88): a soundbite or a shared stretch that plays from its start and stops at its end.
// The player knows nothing of it; the app pauses it when the end comes.

export type Clip = { bookId: string; startMs: number; endMs: number };

export type ClipStep =
  /** Still inside: check again after this many milliseconds of wall time. */
  | { kind: 'wait'; ms: number }
  /** The end is reached: pause, and the clip is over. */
  | { kind: 'stop' }
  /** The listener went elsewhere (another book, or seeked out of it): the clip is over. */
  | { kind: 'leave' }
  /** The clip's own seek has not shown yet: do nothing until the next place. */
  | { kind: 'hold' };

// A position this far before the start, or past the end, means the listener moved away.
const BEFORE_MS = 2_000;
const PAST_MS = 10_000;
// Close enough to the end to stop now rather than wait a few more milliseconds.
const NEAR_MS = 100;

/**
 * What to do about a clip at the player's place. `settled` is false while a fresh clip's seek may
 * still be on its way, when an old position must not end it.
 */
export function clipStep(
  clip: Clip,
  bookId: string | null,
  positionMs: number,
  speed: number,
  settled = true,
): ClipStep {
  // Until the seek shows, only a place at the clip's start is surely the clip's own.
  const atStart = bookId === clip.bookId && Math.abs(positionMs - clip.startMs) <= BEFORE_MS;
  if (!settled && !atStart) return { kind: 'hold' };
  if (bookId !== clip.bookId) return { kind: 'leave' };
  const outside = positionMs < clip.startMs - BEFORE_MS || positionMs > clip.endMs + PAST_MS;
  if (outside) return { kind: 'leave' };
  if (positionMs >= clip.endMs - NEAR_MS) return { kind: 'stop' };
  const rate = speed > 0 ? speed : 1;
  return { kind: 'wait', ms: Math.ceil((clip.endMs - positionMs) / rate) };
}
