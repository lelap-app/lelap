package app.lelap.audio

/** What a sleep timer counts down to. */
enum class SleepMode(val wire: String) {
  MINUTES("minutes"),
  /** The end of the chapter that is playing; of the file when the book has no chapters. */
  CHAPTER("chapter"),
  /** The end of the book or episode. */
  EPISODE("episode");

  companion object {
    fun fromWire(value: String?): SleepMode? = entries.firstOrNull { it.wire == value }
  }
}

/** Where in a file the timer stops: [atFileEnd] means the end of file [index], however long. */
data class FileTarget(val index: Int, val positionMs: Long, val atFileEnd: Boolean)

/**
 * Sleep at the end of a chapter or episode. The rule: the timer ends at the end of whatever chapter
 * is playing. Playback never crosses that end (the timer stops it there), so it only moves when the
 * listener seeks or skips into another chapter, and then it ends at the end of that one.
 */
object SleepBoundary {
  /** The whole-book position where the timer stops, from the place on the book timeline. */
  fun boundaryMs(mode: SleepMode, bookPositionMs: Long, chapterStarts: List<Long>, durations: List<Long>): Long {
    val total = durations.sumOf { it.coerceAtLeast(0L) }
    if (mode != SleepMode.CHAPTER) return total
    // Chapter marks if there are any, else the file ends act as chapters.
    val ends = if (chapterStarts.any { it > 0 }) {
      chapterStarts.filter { it > 0 } + total
    } else {
      durations.runningFold(0L) { sum, d -> sum + d.coerceAtLeast(0L) }.drop(1)
    }
    return ends.sorted().firstOrNull { it > bookPositionMs } ?: total
  }

  /** The file and offset of a book position; a position on a file's end belongs to that file. */
  fun fileTarget(boundaryMs: Long, durations: List<Long>): FileTarget {
    var offset = 0L
    for ((index, d) in durations.withIndex()) {
      val length = d.coerceAtLeast(0L)
      if (boundaryMs < offset + length) return FileTarget(index, boundaryMs - offset, false)
      if (boundaryMs == offset + length) return FileTarget(index, length, true)
      offset += length
    }
    return FileTarget(durations.lastIndex.coerceAtLeast(0), durations.lastOrNull()?.coerceAtLeast(0L) ?: 0L, true)
  }

  fun bookPosition(index: Int, positionMs: Long, durations: List<Long>): Long =
    durations.take(index).sumOf { it.coerceAtLeast(0L) } + positionMs.coerceAtLeast(0L)

  /** Listening time left at [speed]; negative once playback has passed the boundary. */
  fun remainingMs(boundaryMs: Long, bookPositionMs: Long, speed: Float): Long =
    ((boundaryMs - bookPositionMs) / speed.coerceIn(0.5f, 3f).toDouble()).toLong()
}
