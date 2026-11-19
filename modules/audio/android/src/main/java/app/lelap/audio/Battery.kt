package app.lelap.audio

import androidx.media3.common.C

/**
 * How often the playback service and the app's bridge wake up while a book plays (M106). Each
 * timer here used to run at a fixed short interval for the whole time it was on.
 */
object Battery {
  /** The sleep timer's tick while the volume fades, and in the moments before the fade starts. */
  const val TIMER_FADE_TICK_MS = 250L

  /** The sleep timer's tick before the fade: the shake window and the app's countdown need no more. */
  const val TIMER_SLOW_TICK_MS = 5_000L

  /** The longest wait between two looks at the chapter title, in case a seek or speed change was missed. */
  const val CHAPTER_TICK_MAX_MS = 30_000L

  /** The shortest wait, so a chapter mark a moment away doesn't spin the main thread. */
  const val CHAPTER_TICK_MIN_MS = 250L

  /** The state the app hears while it is on screen: the position moves every second. */
  const val STATE_TICK_MS = 1_000L

  /** The state the app hears in the background, enough for its saves every 10 s. */
  const val STATE_BACKGROUND_TICK_MS = 10_000L

  /**
   * The wait until the sleep timer's next tick, with [remainingMs] left: slow until the fade, then
   * a quarter second so the volume steps stay small. Null (no time known) ticks slowly.
   */
  fun sleepTickMs(remainingMs: Long?): Long {
    val untilFade = (remainingMs ?: return TIMER_SLOW_TICK_MS) - SLEEP_TIMER_FADE_MS
    return when {
      untilFade <= TIMER_FADE_TICK_MS -> TIMER_FADE_TICK_MS
      else -> minOf(TIMER_SLOW_TICK_MS, untilFade)
    }
  }

  /**
   * The wait until the title or picture on the lock screen can change: the next chapter or
   * chapter picture after [positionMs] in file [index], in real time at [speed]. Between
   * [CHAPTER_TICK_MIN_MS] and [CHAPTER_TICK_MAX_MS]; a file's end is a media item change, which
   * updates the title by itself.
   */
  fun chapterTickMs(playlist: BookPlaylist, index: Int, positionMs: Long, speed: Float): Long {
    val fileStart = playlist.files.take(index).sumOf { it.durationMs.coerceAtLeast(0L) }
    val bookPosition = fileStart + positionMs
    val next = (playlist.chapters.map { it.startMs } + playlist.artworks.map { it.startMs })
      .filter { it > bookPosition }
      .minOrNull() ?: return CHAPTER_TICK_MAX_MS
    val realMs = ((next - bookPosition) / speed.coerceAtLeast(0.1f)).toLong()
    // A moment after the mark, so the position read then is past it.
    return (realMs + 50L).coerceIn(CHAPTER_TICK_MIN_MS, CHAPTER_TICK_MAX_MS)
  }

  /** How often the app hears the player's state while it plays. */
  fun stateTickMs(inBackground: Boolean): Long = if (inBackground) STATE_BACKGROUND_TICK_MS else STATE_TICK_MS

  /**
   * ExoPlayer's wake mode for a book: files on the phone keep only the CPU awake; anything else
   * also holds a Wi-Fi lock so the stream doesn't stall with the screen off.
   */
  fun wakeModeFor(uris: List<String>): Int =
    if (uris.isNotEmpty() && uris.all(::isOnPhone)) C.WAKE_MODE_LOCAL else C.WAKE_MODE_NETWORK

  private fun isOnPhone(uri: String): Boolean {
    // A bare path has no scheme and is a file too.
    val scheme = if (uri.startsWith("/")) "file" else uri.substringBefore(':', "").lowercase()
    return scheme == "file" || scheme == "content"
  }
}
