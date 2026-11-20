package app.lelap.audio

/**
 * Audio a source is still making (M155), such as an Internet Archive item still being derived or
 * a NAS waking up: it answers `503` with `Retry-After`, also when the add-on didn't mark the stream
 * preparing and for a part in the middle of a book. The player asks again when told, for up to
 * 10 minutes from the first answer, as the item page does (M152), then shows an error.
 */
object PreparingAudio {
  const val WAIT_MS = 10 * 60 * 1000L
  private const val RETRY_AFTER_MIN_S = 5L
  private const val RETRY_AFTER_MAX_S = 3600L

  /**
   * Seconds from a Retry-After header, as seconds or an HTTP date, held between 5 seconds and an
   * hour; null when there is none or it can't be read. Mirrors `retryAfterSeconds` in `@lelap/core`.
   */
  fun retryAfterSeconds(header: String?, nowMs: Long): Long? {
    val value = header?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val seconds = value.toLongOrNull() ?: runCatching {
      val format = java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US)
      format.timeZone = java.util.TimeZone.getTimeZone("GMT")
      val at = format.parse(value)?.time ?: return null
      (at - nowMs + 999) / 1000
    }.getOrNull() ?: return null
    return seconds.coerceIn(RETRY_AFTER_MIN_S, RETRY_AFTER_MAX_S)
  }

  /**
   * The wait before asking again, or null when this isn't preparing audio or the wait would end
   * more than [WAIT_MS] after [sinceMs], the first such answer for this load.
   */
  fun delayMs(code: Int?, retryAfter: String?, sinceMs: Long, nowMs: Long): Long? {
    if (code != 503) return null
    val seconds = retryAfterSeconds(retryAfter, nowMs) ?: return null
    val delay = seconds * 1000
    return if (nowMs + delay - sinceMs > WAIT_MS) null else delay
  }

  /**
   * This load's failures that weren't preparing answers, at least 1: the count other rules (an
   * expired link, M98) read, since Media3 counts every answer while the audio was preparing.
   */
  fun errorsBesides(errorCount: Int, preparingAnswers: Int): Int = (errorCount - preparingAnswers).coerceAtLeast(1)
}
