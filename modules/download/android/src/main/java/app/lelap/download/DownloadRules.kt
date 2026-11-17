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
  ): Resume = when {
    code == 200 -> Resume.RESTART
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
