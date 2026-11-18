package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Media3's count of frames skip silence left out starts again at every flush (a seek, a new
 * part). Looked at before each flush and with every buffer, this keeps nothing it counted from
 * being lost. Runs on the playback thread only.
 */
class SkippedFrames {
  private var last = 0L

  /** Frames skipped since the last look, given the counter now. */
  fun observe(counter: Long): Long {
    // A counter below the last look started again without a flush seen here.
    val delta = if (counter >= last) counter - last else counter
    last = counter
    return delta
  }

  /** The counter is about to start again: what it reached since the last look. */
  fun flush(counter: Long): Long {
    val delta = observe(counter)
    last = 0L
    return delta
  }
}

/**
 * Listening time skip silence saved (M84), per book, kept on this phone like the listening log.
 * Media time left out counts at the speed it would have played at: a second of silence skipped
 * at 2× saves half a second. The newest [max] books are kept.
 */
class SilenceSavings(private val max: Int = MAX_BOOKS) {
  // In microseconds of listening, so many small additions don't round away.
  private val byBook = LinkedHashMap<String, Long>()

  fun add(bookId: String, skippedMediaUs: Long, speed: Float) {
    if (skippedMediaUs <= 0L) return
    val saved = (skippedMediaUs / speed.coerceIn(0.5f, 3f).toDouble()).toLong()
    // The book saved to last moves to the end, so the oldest one goes first.
    val total = (byBook.remove(bookId) ?: 0L) + saved
    byBook[bookId] = total
    while (byBook.size > max) byBook.remove(byBook.keys.first())
  }

  fun savedMs(bookId: String): Long = (byBook[bookId] ?: 0L) / 1000L

  /** Oldest first, so the order survives a restart. */
  fun encode(): String =
    JSONArray(byBook.map { (book, us) -> JSONObject().put("book", book).put("us", us) }).toString()

  companion object {
    const val MAX_BOOKS = 300

    fun decode(json: String?, max: Int = MAX_BOOKS): SilenceSavings {
      val savings = SilenceSavings(max)
      if (json == null) return savings
      try {
        val array = JSONArray(json)
        for (i in 0 until array.length()) {
          val o = array.getJSONObject(i)
          savings.byBook[o.getString("book")] = o.getLong("us").coerceAtLeast(0L)
        }
      } catch (e: JSONException) {
        // An unreadable record starts again from nothing.
      }
      return savings
    }
  }
}
