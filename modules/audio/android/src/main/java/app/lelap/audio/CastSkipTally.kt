package app.lelap.audio

import app.lelap.cast.RenderClock

/**
 * Skip silence's time saved while the phone renders a part for a receiver (M150): the media time
 * left out of what the receiver has played, from the stream's [RenderClock], each moment counted
 * once. What was rendered but not yet played counts only when it plays.
 */
class CastSkipTally {
  private var clock: RenderClock? = null
  private var speed = 1f
  private var counted = 0L

  /** A new stream, or a file (null): counting starts again. */
  fun start(clock: RenderClock?, speed: Float) {
    this.clock = clock
    this.speed = speed
    counted = 0L
  }

  /** The receiver reached [streamMs] into the stream: media ms left out since the last call. */
  fun played(streamMs: Long): Long {
    val c = clock ?: return 0L
    val skipped = c.skippedMs(streamMs, speed)
    // A receiver that went back plays skipped time it already counted.
    if (skipped <= counted) return 0L
    return (skipped - counted).also { counted = skipped }
  }
}
