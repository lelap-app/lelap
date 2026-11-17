package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

data class BookFile(val uri: String, val location: String, val title: String, val durationMs: Long)

data class ChapterMark(val title: String, val startMs: Long)

/** What the service needs to play a book, and to resume it without the app. */
data class BookPlaylist(
  val bookId: String,
  val title: String,
  val author: String?,
  val coverUri: String?,
  val files: List<BookFile>,
  val chapters: List<ChapterMark>,
  val speed: Float,
)

/** The last known place. Mirrors `JournalEntry` in `@lelap/core`. */
data class JournalEntry(val bookId: String, val fileLocation: String, val filePositionMs: Long, val savedAt: Long)

/**
 * [pausedAt] is when the place was saved, for smart rewind on the first Play after loading.
 * [handsOver]: when this book ends, the next item in Up Next plays (podcast episodes do; books
 * stop at their end).
 */
data class BookLoad(
  val playlist: BookPlaylist,
  val startIndex: Int,
  val startPositionMs: Long,
  val pausedAt: Long? = null,
  val handsOver: Boolean = false,
)

/**
 * The service's own record of the place, written while the app may not be running and folded
 * into the app's database when it next starts.
 */
object PositionJournal {
  enum class Event { TICK, PAUSE, ITEM_CHANGE, SEEK, TASK_REMOVED, DESTROY }

  const val TICK_INTERVAL_MS = 10_000L

  /**
   * The entry for the item that is playing, or null when the player no longer holds [playlist]'s
   * file at [index] (another controller replaced the items), so no wrong place is recorded.
   */
  fun entryFor(playlist: BookPlaylist?, index: Int, mediaId: String?, positionMs: Long, now: Long): JournalEntry? {
    val file = playlist?.files?.getOrNull(index) ?: return null
    if (file.location != mediaId) return null
    return JournalEntry(playlist.bookId, file.location, positionMs.coerceAtLeast(0L), now)
  }

  /** Whether [load] is the book the player already holds, which must keep its live position. */
  fun isSameBook(current: BookPlaylist?, mediaItemCount: Int, load: BookLoad): Boolean =
    current != null && mediaItemCount > 0 && current.bookId == load.playlist.bookId

  fun encode(entry: JournalEntry, playlist: BookPlaylist): String = JSONObject()
    .put(
      "entry",
      JSONObject()
        .put("bookId", entry.bookId)
        .put("fileLocation", entry.fileLocation)
        .put("filePositionMs", entry.filePositionMs)
        .put("savedAt", entry.savedAt),
    )
    .put("playlist", encodePlaylist(playlist))
    .toString()

  fun decode(json: String): Pair<JournalEntry, BookPlaylist>? = try {
    val root = JSONObject(json)
    val e = root.getJSONObject("entry")
    JournalEntry(e.getString("bookId"), e.getString("fileLocation"), e.getLong("filePositionMs"), e.getLong("savedAt")) to
      decodePlaylist(root.getJSONObject("playlist"))
  } catch (e: JSONException) {
    null
  }

  /** The app's `BookLoad`, as JSON. */
  fun decodeLoad(json: String): BookLoad? = try {
    val root = JSONObject(json)
    if (root.getJSONArray("files").length() == 0) throw JSONException("A book needs at least one file")
    BookLoad(
      decodePlaylist(root),
      root.getInt("startIndex"),
      root.getLong("startPositionMs"),
      if (root.isNull("pausedAt")) null else root.getLong("pausedAt"),
      root.optBoolean("handsOver", false),
    )
  } catch (e: JSONException) {
    null
  }

  /** The inverse of [decodeLoad], for keeping the queue across a restart of the service. */
  fun encodeLoad(load: BookLoad): String = encodePlaylist(load.playlist)
    .put("startIndex", load.startIndex)
    .put("startPositionMs", load.startPositionMs)
    .put("pausedAt", load.pausedAt ?: JSONObject.NULL)
    .put("handsOver", load.handsOver)
    .toString()

  private fun encodePlaylist(p: BookPlaylist): JSONObject = JSONObject()
    .put("bookId", p.bookId)
    .put("title", p.title)
    .put("author", p.author ?: JSONObject.NULL)
    .put("coverUri", p.coverUri ?: JSONObject.NULL)
    .put("speed", p.speed.toDouble())
    .put(
      "files",
      JSONArray(
        p.files.map {
          JSONObject().put("uri", it.uri).put("location", it.location).put("title", it.title).put("durationMs", it.durationMs)
        },
      ),
    )
    .put("chapters", JSONArray(p.chapters.map { JSONObject().put("title", it.title).put("startMs", it.startMs) }))

  private fun decodePlaylist(o: JSONObject): BookPlaylist {
    val files = o.getJSONArray("files")
    val chapters = o.getJSONArray("chapters")
    return BookPlaylist(
      bookId = o.getString("bookId"),
      title = o.getString("title"),
      author = o.optStringOrNull("author"),
      coverUri = o.optStringOrNull("coverUri"),
      files = List(files.length()) {
        val f = files.getJSONObject(it)
        BookFile(f.getString("uri"), f.getString("location"), f.getString("title"), f.getLong("durationMs"))
      },
      chapters = List(chapters.length()) {
        val c = chapters.getJSONObject(it)
        ChapterMark(c.getString("title"), c.getLong("startMs"))
      },
      speed = o.getDouble("speed").toFloat(),
    )
  }

  private fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key)) null else getString(key)
}
