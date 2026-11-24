package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * [name] is the file's own name, for its type where the address has no extension (Subsonic).
 * [auto]: an episode streamed on its show's automatic file (M121), see [EpisodeFiles].
 */
data class BookFile(
  val uri: String,
  val location: String,
  val title: String,
  val durationMs: Long,
  val name: String? = null,
  val auto: AutoFile? = null,
  /** The stream's MIME type, for an HLS playlist without `.m3u8` (M154). */
  val mime: String? = null,
  /** An episode of a book shown as a podcast that is played (M158): playing on skips it. */
  val played: Boolean = false,
  /** Where that episode was left, for when playing on skips to it (M158). */
  val leftAtMs: Long = 0L,
)

/** The feed's own file and the smallest one, for mobile data (M121). */
data class AutoFile(val unmetered: String, val metered: String)

data class ChapterMark(val title: String, val startMs: Long)

/** Where a chapters file's picture takes over (M103), on the whole-book timeline; null is the cover. */
data class ArtworkMark(val startMs: Long, val uri: String?)

/** What the service needs to play a book, and to resume it without the app. */
data class BookPlaylist(
  val bookId: String,
  val title: String,
  val author: String?,
  val coverUri: String?,
  val files: List<BookFile>,
  val chapters: List<ChapterMark>,
  val speed: Float,
  /** Sent with every request for this book's files: the login of a WebDAV server. */
  val headers: Map<String, String> = emptyMap(),
  /** A podcast's intro and outro to skip (M45), at the first file's start and the last's end. */
  val introMs: Long = 0L,
  val outroMs: Long = 0L,
  /**
   * The files' addresses carry a login (a Subsonic token, M58): a cast receiver gets them through
   * the phone's file server, never the address itself.
   */
  val privateUris: Boolean = false,
  /** The book's or show's own sound (M84), laid over the listener's defaults. */
  val sound: SoundOverrides = SoundOverrides(),
  /** An episode's chapter pictures (M103), for the lock screen and the car. */
  val artworks: List<ArtworkMark> = emptyList(),
  /** The book's server keeps places (M123): a pause asks the app to send it, also when closed. */
  val serverPlaces: Boolean = false,
  /**
   * The book's add-on server says where its files stream from now (M123): a book the service
   * starts by itself asks the app, also when closed.
   */
  val locate: Boolean = false,
  /** A live stream (M154): no seeking, speed, smart rewind or end; Play rejoins what is on air. */
  val live: Boolean = false,
  /** A book shown as a podcast (M158): playing on into a played file goes on to one not played. */
  val skipsPlayed: Boolean = false,
  /** The book keeps a mark per file (M157): each file played to its end is logged for the app. */
  val marksFiles: Boolean = false,
)

/**
 * The last known place. Mirrors `JournalEntry` in `@lelap/core`; [pausedAt], the service's own
 * extra, is when playback last paused (null while it plays), so smart rewind measures the pause
 * itself rather than the time the place last moved.
 */
data class JournalEntry(
  val bookId: String,
  val fileLocation: String,
  val filePositionMs: Long,
  val savedAt: Long,
  val pausedAt: Long? = null,
) {
  /** Where the pause before resuming from this entry began, for smart rewind. */
  val pauseStartedAt: Long
    get() = pausedAt ?: savedAt
}

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
  /** Only an update of the book already loaded (M84): any other book is left playing. */
  val onlyIfLoaded: Boolean = false,
)

/**
 * The service's own record of the place, written while the app may not be running and folded
 * into the app's database when it next starts.
 */
object PositionJournal {
  enum class Event { TICK, PAUSE, ITEM_CHANGE, SEEK, SPEED, TASK_REMOVED, DESTROY }

  const val TICK_INTERVAL_MS = 10_000L

  /**
   * The entry for the item that is playing, or null when the player no longer holds [playlist]'s
   * file at [index] (another controller replaced the items), so no wrong place is recorded.
   */
  fun entryFor(
    playlist: BookPlaylist?,
    index: Int,
    mediaId: String?,
    positionMs: Long,
    now: Long,
    pausedAt: Long? = null,
  ): JournalEntry? {
    val file = playlist?.files?.getOrNull(index) ?: return null
    if (file.location != mediaId) return null
    return JournalEntry(playlist.bookId, file.location, positionMs.coerceAtLeast(0L), now, pausedAt)
  }

  /** Whether [load] is the book the player already holds, which must keep its live position. */
  fun isSameBook(current: BookPlaylist?, mediaItemCount: Int, load: BookLoad): Boolean =
    current != null && mediaItemCount > 0 && current.bookId == load.playlist.bookId

  /**
   * Whether the same book comes with other files (a download finished, was removed or moved), so
   * the player must switch to them at its live place. An episode's automatic file compares as the
   * file [EpisodeFiles] picks on this connection, so the app's own pick of it switches nothing.
   */
  fun filesChanged(current: BookPlaylist, next: BookPlaylist, mobileData: Boolean): Boolean =
    current.files.map { EpisodeFiles.uriFor(it, mobileData) } != next.files.map { EpisodeFiles.uriFor(it, mobileData) } ||
      current.headers != next.headers

  /** [playlist] at the speed the player plays now, which any controller may have changed. */
  fun withSpeed(playlist: BookPlaylist, speed: Float): BookPlaylist {
    val live = speed.coerceIn(0.5f, 3f)
    return if (playlist.speed == live) playlist else playlist.copy(speed = live)
  }

  /** The place alone; the playlist has its own key and is written only when it changes. */
  fun encodeEntry(entry: JournalEntry): String = entryJson(entry).toString()

  fun encodePlaylist(playlist: BookPlaylist): String = playlistJson(playlist).toString()

  /** The place in [json], also in the older form that carried the playlist inside. */
  fun decodeEntry(json: String?): JournalEntry? = try {
    val root = JSONObject(json ?: throw JSONException("No journal"))
    decodeEntryJson(root.optJSONObject("entry") ?: root)
  } catch (e: JSONException) {
    null
  }

  /**
   * The place and the book it belongs to; null when either is missing or they name different
   * books. The older form carries its playlist inside [entryJson].
   */
  fun decode(entryJson: String?, playlistJson: String?): Pair<JournalEntry, BookPlaylist>? = try {
    val root = JSONObject(entryJson ?: throw JSONException("No journal"))
    val entry = decodeEntryJson(root.optJSONObject("entry") ?: root)
    val playlist = decodePlaylist(
      root.optJSONObject("playlist") ?: JSONObject(playlistJson ?: throw JSONException("No playlist")),
    )
    if (playlist.bookId == entry.bookId) entry to playlist else null
  } catch (e: JSONException) {
    null
  }

  private fun entryJson(entry: JournalEntry): JSONObject = JSONObject()
    .put("bookId", entry.bookId)
    .put("fileLocation", entry.fileLocation)
    .put("filePositionMs", entry.filePositionMs)
    .put("savedAt", entry.savedAt)
    .put("pausedAt", entry.pausedAt ?: JSONObject.NULL)

  private fun decodeEntryJson(e: JSONObject) = JournalEntry(
    e.getString("bookId"),
    e.getString("fileLocation"),
    e.getLong("filePositionMs"),
    e.getLong("savedAt"),
    if (!e.has("pausedAt") || e.isNull("pausedAt")) null else e.getLong("pausedAt"),
  )

  /** Keeps the last [max] places, so the app can fold each in when it next starts. */
  fun appendEarlier(json: String?, entry: JournalEntry, max: Int = 20): String =
    encodeEntries((decodeEntries(json).filter { it.bookId != entry.bookId } + entry).takeLast(max))

  fun encodeEntries(list: List<JournalEntry>): String = JSONArray(list.map(::entryJson)).toString()

  fun decodeEntries(json: String?): List<JournalEntry> = try {
    val array = JSONArray(json ?: "[]")
    List(array.length()) { decodeEntryJson(array.getJSONObject(it)) }
  } catch (e: JSONException) {
    emptyList()
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
      root.optBoolean("onlyIfLoaded", false),
    )
  } catch (e: JSONException) {
    null
  }

  /** The inverse of [decodeLoad], for keeping the queue across a restart of the service. */
  fun encodeLoad(load: BookLoad): String = playlistJson(load.playlist)
    .put("startIndex", load.startIndex)
    .put("startPositionMs", load.startPositionMs)
    .put("pausedAt", load.pausedAt ?: JSONObject.NULL)
    .put("handsOver", load.handsOver)
    .toString()

  private fun playlistJson(p: BookPlaylist): JSONObject = JSONObject()
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
            .apply { it.name?.let { name -> put("name", name) } }
            .apply { it.auto?.let { a -> put("auto", JSONObject().put("unmetered", a.unmetered).put("metered", a.metered)) } }
            .apply { it.mime?.let { mime -> put("mime", mime) } }
            .apply { if (it.played) put("played", true) }
            .apply { if (it.leftAtMs > 0) put("leftAtMs", it.leftAtMs) }
        },
      ),
    )
    .put("chapters", JSONArray(p.chapters.map { JSONObject().put("title", it.title).put("startMs", it.startMs) }))
    .put("headers", JSONObject(p.headers))
    .put("skipIntroMs", p.introMs)
    .put("skipOutroMs", p.outroMs)
    .put("privateUris", p.privateUris)
    .put("sound", p.sound.toJson())
    .put("artworks", JSONArray(p.artworks.map { JSONObject().put("startMs", it.startMs).put("uri", it.uri ?: JSONObject.NULL) }))
    .put("serverPlaces", p.serverPlaces)
    .put("locate", p.locate)
    .put("live", p.live)
    .put("skipsPlayed", p.skipsPlayed)
    .put("marksFiles", p.marksFiles)

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
        BookFile(
          f.getString("uri"),
          f.getString("location"),
          f.getString("title"),
          f.getLong("durationMs"),
          f.optStringOrNull("name"),
          f.optJSONObject("auto")?.let { a -> AutoFile(a.getString("unmetered"), a.getString("metered")) },
          f.optStringOrNull("mime"),
          f.optBoolean("played", false),
          f.optLong("leftAtMs", 0L).coerceAtLeast(0L),
        )
      },
      chapters = List(chapters.length()) {
        val c = chapters.getJSONObject(it)
        ChapterMark(c.getString("title"), c.getLong("startMs"))
      },
      speed = o.getDouble("speed").toFloat(),
      headers = o.optJSONObject("headers")?.let { h -> h.keys().asSequence().associateWith { h.getString(it) } }
        ?: emptyMap(),
      introMs = o.optLong("skipIntroMs", 0L).coerceAtLeast(0L),
      outroMs = o.optLong("skipOutroMs", 0L).coerceAtLeast(0L),
      privateUris = o.optBoolean("privateUris", false),
      sound = SoundOverrides.fromJson(o.optJSONObject("sound")),
      artworks = o.optJSONArray("artworks")?.let { a ->
        List(a.length()) {
          val m = a.getJSONObject(it)
          ArtworkMark(m.getLong("startMs"), m.optStringOrNull("uri"))
        }
      } ?: emptyList(),
      serverPlaces = o.optBoolean("serverPlaces", false),
      locate = o.optBoolean("locate", false),
      live = o.optBoolean("live", false),
      skipsPlayed = o.optBoolean("skipsPlayed", false),
      marksFiles = o.optBoolean("marksFiles", false),
    )
  }

  private fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key)) null else getString(key)
}
