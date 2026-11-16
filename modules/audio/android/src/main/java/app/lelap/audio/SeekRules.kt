package app.lelap.audio

/** Pure seek arithmetic for skip buttons and smart rewind. */
object SeekRules {
  /** How far to rewind on Play after a pause of [pausedForMs]. */
  fun rewindOnResume(pausedForMs: Long): Long = when {
    pausedForMs < 60_000L -> 0L
    pausedForMs <= 3_600_000L -> 5_000L
    else -> 15_000L
  }

  /** Where a book loaded to play right away starts: the saved place, minus smart rewind. */
  fun resumePosition(positionMs: Long, pausedAt: Long?, now: Long, smartRewind: Boolean): Long {
    if (!smartRewind || pausedAt == null) return positionMs
    return (positionMs - rewindOnResume(now - pausedAt)).coerceAtLeast(0L)
  }

  /**
   * Where a skip of [deltaMs] from ([index], [positionMs]) lands across the book's files. Stops at
   * the book's start and end, and stays in the file when a neighbour's duration is unknown (≤ 0).
   */
  fun skip(index: Int, positionMs: Long, deltaMs: Long, durations: List<Long>): Pair<Int, Long> {
    var i = index
    var target = positionMs + deltaMs
    while (target < 0) {
      if (i == 0) return 0 to 0L
      val previous = durations.getOrElse(i - 1) { 0L }
      if (previous <= 0) return i to 0L
      i--
      target += previous
    }
    while (true) {
      val duration = durations.getOrElse(i) { 0L }
      if (duration <= 0 || target < duration) return i to target
      if (i == durations.lastIndex) return i to duration
      target -= duration
      i++
    }
  }
}
