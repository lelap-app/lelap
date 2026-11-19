package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * The list the service follows (M112, M119), beside the queue, whose tail from `listNext` is the
 * list's next items. The app sends it with the queue; a list picked in Android Auto starts it here.
 */
data class ListPlay(
  val id: String,
  val title: String,
  /** The list's item playing, or null while Up Next plays between two of its items. */
  val at: String?,
  /** The list's items before [at], nearest first, for Previous in list. */
  val before: List<BookLoad>,
  /** Finished items play again (from their start), so one that ends can be gone back to. */
  val keepsFinished: Boolean,
) {
  fun encode(): String = JSONObject()
    .put("id", id)
    .put("title", title)
    .put("at", at ?: JSONObject.NULL)
    .put("before", JSONArray(before.map { JSONObject(PositionJournal.encodeLoad(it)) }))
    .put("keepsFinished", keepsFinished)
    .toString()

  companion object {
    fun decode(json: String?): ListPlay? = try {
      if (json.isNullOrBlank()) {
        null
      } else {
        val o = JSONObject(json)
        ListPlay(
          id = o.getString("id"),
          title = o.optString("title"),
          at = if (o.isNull("at")) null else o.optString("at").takeIf { it.isNotEmpty() },
          before = UpNext.decodeQueue(o.optJSONArray("before")?.toString()),
          keepsFinished = o.optBoolean("keepsFinished", false),
        )
      }
    } catch (e: JSONException) {
      null
    }
  }
}

/** One step through a list: what plays now, and the queue and list after it. */
data class ListStep(val play: BookLoad, val queue: List<BookLoad>, val listNext: Int, val list: ListPlay)

/** Moving through the followed list with the app closed (M119); pure, so it is tested on the JVM. */
object ListSteps {
  /** Enough to step back a while away from the phone; the app sends a fresh list when it wakes. */
  const val BEFORE_LIMIT = 25

  /** Previous in list is offered on the list's own item, with something before it. */
  fun offersPrevious(list: ListPlay?, playing: String?): Boolean =
    list != null && playing != null && list.at == playing && list.before.isNotEmpty()

  /**
   * The list moves on from what plays to [nextId]. [left] is the load to come back to with
   * Previous, kept only when it was the list's own item; [nextInList] says whether [nextId] is.
   */
  fun moved(list: ListPlay, left: BookLoad?, nextId: String, nextInList: Boolean): ListPlay {
    val keep = left != null && left.playlist.bookId == list.at
    return list.copy(
      at = if (nextInList) nextId else null,
      before = if (keep) (listOf(left!!) + list.before).take(BEFORE_LIMIT) else list.before,
    )
  }

  /**
   * Previous in list: the item before plays, and [current] (the list's item playing, at its live
   * place) becomes the list's next again, after Up Next.
   */
  fun previous(list: ListPlay, queue: List<BookLoad>, listNext: Int, current: BookLoad): ListStep? {
    if (!offersPrevious(list, current.playlist.bookId)) return null
    val target = list.before.first()
    val at = if (listNext in queue.indices) listNext else queue.size
    val rest = queue.toMutableList().apply { add(at, current) }
    return ListStep(target, rest, at, list.copy(at = target.playlist.bookId, before = list.before.drop(1)))
  }

  /**
   * A list picked in the car: Up Next that was queued plays first, as in the app, then the list's
   * items after the picked one. Up Next items hand over too, so the list goes on after them.
   */
  fun startQueue(upNext: List<BookLoad>, pickedId: String, after: List<BookLoad>): Pair<List<BookLoad>, Int> {
    val listed = after.map { it.playlist.bookId }.toSet() + pickedId
    val first = upNext.filter { it.playlist.bookId !in listed }.map { it.copy(handsOver = true) }
    return (first + after) to (if (after.isEmpty()) -1 else first.size)
  }

  /** What the app reads when it wakes: the list picked in the car, which it then follows. */
  fun encodeStarted(listId: String, bookId: String, order: List<String>?): String = JSONObject()
    .put("listId", listId)
    .put("bookId", bookId)
    .put("order", order?.let { JSONArray(it) } ?: JSONObject.NULL)
    .toString()
}
