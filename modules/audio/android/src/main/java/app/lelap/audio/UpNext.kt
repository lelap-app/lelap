package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * A book or episode that played to its end, for the app to mark finished. [startLocation] and
 * [startPositionMs]: where the listening session that reached the end began, for the `finish`
 * scrobble's `sessionStartMs` (M102); null when no session was seen.
 */
data class Finished(
  val bookId: String,
  val at: Long,
  val startLocation: String? = null,
  val startPositionMs: Long? = null,
  /** The file it ended in (M158): the last one loaded, which for one episode isn't the book's. */
  val fileLocation: String? = null,
)

/**
 * Up Next as the service sees it: the books to play after the current one, in order. The app sends
 * it whenever the queue or the loaded book changes, so a podcast episode that ends hands over to
 * the next one also with the app closed.
 */
object UpNext {
  /** What to play when the current book ends, and the queue left after it. */
  fun afterEnd(handsOver: Boolean, queue: List<BookLoad>): Pair<BookLoad?, List<BookLoad>> =
    if (handsOver && queue.isNotEmpty()) queue.first() to queue.drop(1) else null to queue

  /**
   * Where the followed list's next item is once the head of the queue played (M112): the queue is
   * Up Next, then the list, so after a list item the next list item is the new head.
   */
  fun listNextAfterHead(listNext: Int, rest: List<BookLoad>): Int = when {
    listNext > 0 -> listNext - 1
    listNext == 0 && rest.isNotEmpty() -> 0
    else -> -1
  }

  /**
   * Next in list: the list's next item plays now, ahead of Up Next, which stays queued. Returns it,
   * the queue without it and where the list's next item is then.
   */
  fun skipToListNext(listNext: Int, queue: List<BookLoad>): Triple<BookLoad?, List<BookLoad>, Int> {
    val next = queue.getOrNull(listNext) ?: return Triple(null, queue, -1)
    val rest = queue.filterIndexed { i, _ -> i != listNext }
    return Triple(next, rest, if (listNext < rest.size) listNext else -1)
  }

  /** The app's queue: a JSON array of `BookLoad`s. Unreadable entries are left out. */
  fun decodeQueue(json: String?): List<BookLoad> = try {
    val array = JSONArray(json ?: "[]")
    (0 until array.length()).mapNotNull { PositionJournal.decodeLoad(array.getJSONObject(it).toString()) }
  } catch (e: JSONException) {
    emptyList()
  }

  fun encodeFinished(list: List<Finished>): String =
    JSONArray(
      list.map {
        val o = JSONObject().put("bookId", it.bookId).put("at", it.at)
        if (it.startLocation != null && it.startPositionMs != null) {
          o.put("startLocation", it.startLocation).put("startPositionMs", it.startPositionMs)
        }
        it.fileLocation?.let { location -> o.put("fileLocation", location) }
        o
      },
    ).toString()

  fun decodeFinished(json: String?): List<Finished> = try {
    val array = JSONArray(json ?: "[]")
    List(array.length()) {
      val o = array.getJSONObject(it)
      // Logs from before M102 have no session start.
      val started = o.has("startLocation") && o.has("startPositionMs")
      Finished(
        o.getString("bookId"),
        o.getLong("at"),
        if (started) o.getString("startLocation") else null,
        if (started) o.getLong("startPositionMs") else null,
        if (o.isNull("fileLocation")) null else o.getString("fileLocation"),
      )
    }
  } catch (e: JSONException) {
    emptyList()
  }
}
