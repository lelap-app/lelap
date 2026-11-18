package app.lelap.audio

import org.json.JSONObject

/** A place in a book at a moment: [atMs] is wall-clock time, [bookPositionMs] the whole-book place. */
data class PlaceMark(val bookId: String, val atMs: Long, val bookPositionMs: Long)

/**
 * After the sleep timer stopped playback (M86): where and when it stopped, and where and when the
 * listener last used the player before that, kept until the app offers to go back. Lelap can't
 * know when someone fell asleep, only the last moment they surely were awake: their last touch.
 */
data class SleepPlace(
  val bookId: String,
  val stoppedMs: Long,
  val stoppedAt: Long,
  /** Null when the listener didn't touch the player in this book before the stop. */
  val usedMs: Long?,
  val usedAt: Long?,
) {
  fun encode(): String = JSONObject()
    .put("bookId", bookId)
    .put("stoppedMs", stoppedMs)
    .put("stoppedAt", stoppedAt)
    .apply {
      if (usedMs != null && usedAt != null) {
        put("usedMs", usedMs)
        put("usedAt", usedAt)
      }
    }
    .toString()

  companion object {
    /**
     * The place to keep when the timer stops at [stopped]. [lastInteraction] counts when it was
     * in the same book, before the stop and earlier in the book.
     */
    fun at(stopped: PlaceMark, lastInteraction: PlaceMark?): SleepPlace {
      val used = lastInteraction?.takeIf {
        it.bookId == stopped.bookId && it.atMs <= stopped.atMs && it.bookPositionMs < stopped.bookPositionMs
      }
      return SleepPlace(
        bookId = stopped.bookId,
        stoppedMs = stopped.bookPositionMs,
        stoppedAt = stopped.atMs,
        usedMs = used?.bookPositionMs?.coerceAtLeast(0L),
        usedAt = used?.atMs,
      )
    }

    fun decode(json: String?): SleepPlace? = try {
      json?.let(::JSONObject)?.let {
        val used = it.has("usedMs") && it.has("usedAt")
        SleepPlace(
          bookId = it.getString("bookId"),
          stoppedMs = it.getLong("stoppedMs"),
          stoppedAt = it.getLong("stoppedAt"),
          usedMs = if (used) it.getLong("usedMs") else null,
          usedAt = if (used) it.getLong("usedAt") else null,
        )
      }
    } catch (e: Exception) {
      null
    }
  }
}
