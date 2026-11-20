package app.lelap.download

/** What to do with a response to a (possibly ranged) request for a part. */
enum class Resume {
  /** 206 from where the partial file ends: append the body. */
  APPEND,
  /** 200: the server sent the whole file; write it from the start. */
  RESTART,
  /** 416 and the partial file already has every byte. */
  COMPLETE,
  /** The partial file can't be continued: delete it and ask again from the start. */
  DISCARD,
  /** A temporary failure; WorkManager retries with backoff. */
  RETRY,
  /**
   * 503 with Retry-After (M152): the source is still making the file. Wait as long as it says and
   * ask again, without counting it as a failure.
   */
  PREPARING,
  /**
   * 403 or 410: the link may have expired. Ask the original URL again now, once; a `/resolve/…`
   * URL redirects to a fresh link, and the partial file continues where it stopped.
   */
  REFRESH,
  /** The server refuses for good (404, 403, …). */
  FAIL,
}

object DownloadRules {
  private val CONTENT_RANGE = Regex("""^bytes\s+(\d+)-(\d+)/(\d+|\*)$""")
  private val UNSATISFIED_RANGE = Regex("""^bytes\s+\*/(\d+)$""")

  /**
   * A JSON or XML answer is a server's message, not the file: Subsonic servers send their errors
   * (downloads turned off, no permission) with HTTP 200.
   */
  fun isMessage(contentType: String?): Boolean {
    val type = contentType?.substringBefore(';')?.trim()?.lowercase() ?: return false
    return type == "application/json" || type == "application/xml" || type == "text/xml"
  }

  /** How long a preparing source may make us wait at least and at most, in seconds. */
  const val RETRY_AFTER_MIN_S = 5L
  const val RETRY_AFTER_MAX_S = 3600L
  /** The longest answer body shown as the reason a download ended. */
  const val END_MESSAGE_MAX = 200

  /**
   * Seconds from a Retry-After header, as seconds or an HTTP date, held between 5 seconds and an
   * hour; null when there is none or it can't be read. [nowMs] is the clock, for tests.
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
   * The server's own words for why a file won't come (M152): a plain-text body of at most 200
   * characters, else null and the app says it in its own words.
   */
  fun endMessage(contentType: String?, body: String?): String? {
    val type = contentType?.substringBefore(';')?.trim()?.lowercase()
    if (type != "text/plain") return null
    val text = body?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return if (text.length <= END_MESSAGE_MAX && text.none { it.isISOControl() && it != '\n' }) text else null
  }

  fun contentRangeStart(header: String?): Long? =
    header?.trim()?.let { CONTENT_RANGE.matchEntire(it) }?.groupValues?.get(1)?.toLongOrNull()

  // The full length, from a 416's `bytes */123` or from `bytes 0-9/123`.
  fun contentRangeTotal(header: String?): Long? {
    val h = header?.trim() ?: return null
    UNSATISFIED_RANGE.matchEntire(h)?.let { return it.groupValues[1].toLongOrNull() }
    return CONTENT_RANGE.matchEntire(h)?.groupValues?.get(3)?.toLongOrNull()
  }

  /**
   * [existing] is the length of the partial file the request asked to continue (0: no Range
   * header was sent); [expectedSize] is the add-on's size for the part, 0 when unknown.
   * [refreshed]: this run already asked again after a 403 or 410.
   */
  fun decide(
    code: Int,
    existing: Long,
    contentRange: String?,
    expectedSize: Long,
    refreshed: Boolean = false,
    retryAfter: String? = null,
    nowMs: Long = System.currentTimeMillis(),
  ): Resume = when {
    code == 200 -> Resume.RESTART
    // An unreadable Retry-After is an ordinary 503, as the app's player takes it.
    code == 503 && retryAfterSeconds(retryAfter, nowMs) != null -> Resume.PREPARING
    code == 206 -> if (existing > 0 && contentRangeStart(contentRange) == existing) Resume.APPEND else Resume.DISCARD
    code == 416 -> {
      val total = contentRangeTotal(contentRange) ?: expectedSize
      if (existing > 0 && total == existing) Resume.COMPLETE else Resume.DISCARD
    }
    code == 408 || code == 429 || code in 500..599 -> Resume.RETRY
    (code == 403 || code == 410) && !refreshed -> Resume.REFRESH
    else -> Resume.FAIL
  }

  /** The state JavaScript sees, from the files on disk and WorkManager's state for the work. */
  fun state(partsDone: Boolean, work: WorkState, hasError: Boolean): String = when {
    work == WorkState.RUNNING -> "running"
    work == WorkState.ENQUEUED || work == WorkState.BLOCKED -> "waiting"
    partsDone -> "done"
    work == WorkState.FAILED || hasError -> "failed"
    else -> "stopped"
  }
}

/** WorkManager's states, without depending on WorkManager in JVM tests. */
enum class WorkState { NONE, ENQUEUED, BLOCKED, RUNNING, SUCCEEDED, FAILED, CANCELLED }
