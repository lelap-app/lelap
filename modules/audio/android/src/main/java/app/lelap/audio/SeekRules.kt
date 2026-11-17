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
   * Where a podcast episode starts (M45): past the intro while the place is still inside it,
   * else the place less [rewindMs], never back into the intro. Mirrors `trimmedStart` in
   * `@lelap/core`. Only the first file has an intro.
   */
  fun trimmedStart(index: Int, positionMs: Long, rewindMs: Long, introMs: Long): Long {
    val intro = if (index == 0) introMs.coerceAtLeast(0L) else 0L
    if (positionMs < intro) return intro
    return (positionMs - rewindMs.coerceAtLeast(0L)).coerceAtLeast(intro)
  }

  /** [resumePosition], then past a podcast's intro. */
  fun startPosition(index: Int, positionMs: Long, pausedAt: Long?, now: Long, smartRewind: Boolean, introMs: Long): Long {
    val rewind = if (!smartRewind || pausedAt == null) 0L else rewindOnResume(now - pausedAt)
    return trimmedStart(index, positionMs, rewind, introMs)
  }

  /**
   * Where in the last file an episode counts as played to its end, or null to play it all.
   * Mirrors `outroStartMs` in `@lelap/core`: at least a minute after the intro must be left.
   */
  fun outroStart(durationMs: Long, outroMs: Long, introMs: Long, singleFile: Boolean): Long? {
    if (outroMs <= 0 || durationMs <= 0) return null
    val at = durationMs - outroMs
    val floor = (if (singleFile) introMs.coerceAtLeast(0L) else 0L) + 60_000L
    return if (at >= floor) at else null
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
